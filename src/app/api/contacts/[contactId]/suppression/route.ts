import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireRole } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { CONTACT_SELECT, serializeContact } from '@/lib/contacts/queries';

// PATCH /api/contacts/:id/suppression?accountKey=
//
// Toggle the contact's Email / SMS opt-out. The 7-channel GHL DND
// grid is gone — only Email and SMS survive the migration because
// those are the only channels Loomi sends on.
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

  // Suppression table writes happen in transaction with the contact
  // dnd update so the UI and the send worker can't disagree.
  await prisma.$transaction(async (tx) => {
    if (requestEmail !== undefined && contact.email) {
      if (requestEmail) {
        await tx.emailSuppression.upsert({
          where: { accountKey_email: { accountKey, email: contact.email } },
          update: { reason: 'manual', source: 'manual' },
          create: {
            accountKey,
            email: contact.email,
            reason: 'manual',
            source: 'manual',
          },
        });
      } else {
        await tx.emailSuppression.deleteMany({
          where: { accountKey, email: contact.email },
        });
      }
    }

    if (requestSms !== undefined && contact.phone) {
      if (requestSms) {
        await tx.smsSuppression.upsert({
          where: { accountKey_phone: { accountKey, phone: contact.phone } },
          update: { reason: 'manual', source: 'manual' },
          create: {
            accountKey,
            phone: contact.phone,
            reason: 'manual',
            source: 'manual',
          },
        });
      } else {
        await tx.smsSuppression.deleteMany({
          where: { accountKey, phone: contact.phone },
        });
      }
    }

    await tx.contact.update({
      where: { id: contact.id },
      data: {
        dnd:
          next.email === undefined && next.sms === undefined
            ? Prisma.DbNull
            : {
                ...(next.email !== undefined ? { email: next.email } : {}),
                ...(next.sms !== undefined ? { sms: next.sms } : {}),
              },
      },
    });
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
