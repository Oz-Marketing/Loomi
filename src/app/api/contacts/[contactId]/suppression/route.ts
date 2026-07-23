import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireRole } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { CONTACT_SELECT, serializeContact } from '@/lib/contacts/queries';
import { getOrgSiblingAccountKeys } from '@/lib/services/organizations';

// PATCH /api/contacts/:id/suppression?accountKey=
//
// Toggle the contact's Email / SMS opt-out. Email and SMS are the
// only channels Loomi sends on.
//
// We persist suppression two ways:
//   1. EmailSuppression / SmsSuppression rows — that's what the send
//      worker checks before queueing a send (reason='manual' so it's
//      distinguishable from bounce / STOP-driven suppressions).
//   2. `dnd` Json on the Contact row — gives the UI a fast read
//      without joining the suppression table for every contact.
//
// Body shape: { email?: boolean, sms?: boolean }. Missing keys are
// left unchanged. `true` means "suppress" (i.e. user opted out);
// `false` clears the suppression.

type RouteContext = { params: Promise<{ contactId: string }> };

interface DndState {
  email?: boolean;
  sms?: boolean;
}

function parseDndJson(value: Prisma.JsonValue | null): DndState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  const out: DndState = {};
  if (typeof row.email === 'boolean') out.email = row.email;
  if (typeof row.sms === 'boolean') out.sms = row.sms;
  return out;
}

/** Serialize a DndState for the Contact.dnd JSON column (DbNull when empty). */
function dndWriteValue(state: DndState): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (state.email === undefined && state.sms === undefined) return Prisma.DbNull;
  return {
    ...(state.email !== undefined ? { email: state.email } : {}),
    ...(state.sms !== undefined ? { sms: state.sms } : {}),
  };
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { contactId } = await params;
  const accountKey = req.nextUrl.searchParams.get('accountKey')?.trim() ?? '';
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }

  if (session!.user.role === 'admin') {
    const assigned = session!.user.accountKeys ?? [];
    if (assigned.length > 0 && !assigned.includes(accountKey)) {
      return NextResponse.json({ error: 'Forbidden for this account' }, { status: 403 });
    }
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }

  const requestEmail = typeof body.email === 'boolean' ? body.email : undefined;
  const requestSms = typeof body.sms === 'boolean' ? body.sms : undefined;
  if (requestEmail === undefined && requestSms === undefined) {
    return NextResponse.json(
      { error: 'Body must include an email or sms boolean' },
      { status: 400 },
    );
  }

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, accountKey },
    select: { id: true, email: true, phone: true, dnd: true },
  });
  if (!contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  const current = parseDndJson(contact.dnd);
  const next: DndState = {
    email: requestEmail !== undefined ? requestEmail : current.email,
    sms: requestSms !== undefined ? requestSms : current.sms,
  };

  // Org-wide suppression cascade: a manual opt-out is a compliance signal that
  // must apply across every rooftop in the same organization, not just the one
  // the toggle was flipped in. When the account belongs to an org we mirror the
  // authoritative suppression rows onto all sibling rooftops (and reflect the
  // dnd flag on any sibling contact sharing this email/phone so the UI agrees).
  // Standalone accounts (no org) get siblingKeys = [] and behave as before.
  const siblingKeys = await getOrgSiblingAccountKeys(accountKey);
  const suppressionKeys = [accountKey, ...siblingKeys];

  // Suppression table writes happen in transaction with the contact
  // dnd update so the UI and the send worker can't disagree.
  await prisma.$transaction(async (tx) => {
    for (const key of suppressionKeys) {
      if (requestEmail !== undefined && contact.email) {
        if (requestEmail) {
          await tx.emailSuppression.upsert({
            where: { accountKey_email: { accountKey: key, email: contact.email } },
            update: { reason: 'manual', source: 'manual' },
            create: {
              accountKey: key,
              email: contact.email,
              reason: 'manual',
              source: 'manual',
            },
          });
        } else {
          await tx.emailSuppression.deleteMany({
            where: { accountKey: key, email: contact.email },
          });
        }
      }

      if (requestSms !== undefined && contact.phone) {
        if (requestSms) {
          await tx.smsSuppression.upsert({
            where: { accountKey_phone: { accountKey: key, phone: contact.phone } },
            update: { reason: 'manual', source: 'manual' },
            create: {
              accountKey: key,
              phone: contact.phone,
              reason: 'manual',
              source: 'manual',
            },
          });
        } else {
          await tx.smsSuppression.deleteMany({
            where: { accountKey: key, phone: contact.phone },
          });
        }
      }
    }

    await tx.contact.update({
      where: { id: contact.id },
      data: { dnd: dndWriteValue(next) },
    });

    // Mirror the flipped channel(s) onto sibling contacts that share this
    // email/phone. Contact has @@unique([accountKey,email]) and
    // @@unique([accountKey,phone]), so at most one sibling contact matches per
    // rooftop per channel.
    if (siblingKeys.length > 0) {
      const orFilters: Prisma.ContactWhereInput[] = [];
      if (requestEmail !== undefined && contact.email) orFilters.push({ email: contact.email });
      if (requestSms !== undefined && contact.phone) orFilters.push({ phone: contact.phone });

      if (orFilters.length > 0) {
        const siblingContacts = await tx.contact.findMany({
          where: { accountKey: { in: siblingKeys }, OR: orFilters },
          select: { id: true, email: true, phone: true, dnd: true },
        });
        for (const sc of siblingContacts) {
          const scNext = parseDndJson(sc.dnd);
          if (requestEmail !== undefined && contact.email && sc.email === contact.email) {
            scNext.email = requestEmail;
          }
          if (requestSms !== undefined && contact.phone && sc.phone === contact.phone) {
            scNext.sms = requestSms;
          }
          await tx.contact.update({
            where: { id: sc.id },
            data: { dnd: dndWriteValue(scNext) },
          });
        }
      }
    }
  });

  const updated = await prisma.contact.findUniqueOrThrow({
    where: { id: contact.id },
    select: CONTACT_SELECT,
  });

  return NextResponse.json({
    contact: serializeContact(updated),
    dnd: next,
  });
}
