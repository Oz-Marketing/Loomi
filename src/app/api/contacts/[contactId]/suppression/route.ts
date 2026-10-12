import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import type { Session } from 'next-auth';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';
import { CONTACT_SELECT, serializeContact } from '@/lib/contacts/queries';
import { getRelatedAccountKeys } from '@/lib/services/accounts';
import {
  applyContactOptOutChange,
  dndAfterChange,
  loadContactOptOutState,
  normalizeOptOutEmail,
  normalizeOptOutPhone,
  readDndFlags,
  type ContactOptOutState,
  type DndFlags,
} from '@/lib/sending/opt-outs';

// GET   /api/contacts/:id/suppression?accountKey=
// PATCH /api/contacts/:id/suppression?accountKey=
//
// The contact's Email / SMS opt-out. Email and SMS are the only channels
// Loomi sends on.
//
// An opt-out lives in two places:
//   1. EmailSuppression / SmsSuppression rows — what every send path checks,
//      cascaded to every account in the group.
//   2. `dnd` Json on the Contact row — the UI's copy, and a second check for
//      this one contact.
//
// GET reports what the toggle should SHOW, which is either of them: a
// webhook unsubscribe or a bounce writes a row and never touches the flag,
// and the toggle used to read the flag alone — so a person who had
// unsubscribed showed as mailable.
//
// PATCH body: { email?: boolean, sms?: boolean }. Missing keys are left
// unchanged. `true` records a 'manual' opt-out across the group. `false`
// clears only what staff may clear (see isStaffClearable in
// lib/sending/opt-outs): a person who unsubscribed, reported spam or texted
// STOP can't be resubscribed by staff, a bounced address stays suppressed,
// and an imported opt-out stays until someone removes it in Settings →
// Suppressions. When something like that is left, the channel stays on and
// the response's `optOuts.<channel>.lockedBy` says why, so the page can
// explain it.

type RouteContext = { params: Promise<{ contactId: string }> };

/** Serialize flags for the Contact.dnd JSON column (DbNull when empty). */
function dndWriteValue(state: DndFlags): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (state.email === undefined && state.sms === undefined) return Prisma.DbNull;
  return {
    ...(state.email !== undefined ? { email: state.email } : {}),
    ...(state.sms !== undefined ? { sms: state.sms } : {}),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** What the toggle shows per channel: opted out by the flag OR by a suppression row. */
function displayedDnd(state: ContactOptOutState): { email: boolean; sms: boolean } {
  return { email: state.email.optedOut, sms: state.sms.optedOut };
}

/**
 * Admins with explicit assignments only reach their own accounts; clients
 * only theirs. Developers / super_admins have unrestricted reach.
 */
function outOfScope(session: Session, accountKey: string): NextResponse | null {
  const assigned = session.user.accountKeys ?? [];
  if (session.user.role === 'admin' && assigned.length > 0 && !assigned.includes(accountKey)) {
    return NextResponse.json({ error: 'Forbidden for this account' }, { status: 403 });
  }
  if (session.user.role === 'client' && !assigned.includes(accountKey)) {
    return NextResponse.json({ error: 'Forbidden for this account' }, { status: 403 });
  }
  return null;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  // Same gate as reading the contact itself.
  const { session, error } = await requirePermission(['studio.contacts.view', 'reporting.report.view']);
  if (error) return error;

  const { contactId } = await params;
  const accountKey = req.nextUrl.searchParams.get('accountKey')?.trim() ?? '';
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }
  const forbidden = outOfScope(session!, accountKey);
  if (forbidden) return forbidden;

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, accountKey },
    select: { accountKey: true, email: true, phone: true, dnd: true },
  });
  if (!contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  const optOuts = await loadContactOptOutState(contact);
  return NextResponse.json({ dnd: displayedDnd(optOuts), optOuts });
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { session, error } = await requirePermission('studio.contacts.edit');
  if (error) return error;

  const { contactId } = await params;
  const accountKey = req.nextUrl.searchParams.get('accountKey')?.trim() ?? '';
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }
  const forbidden = outOfScope(session!, accountKey);
  if (forbidden) return forbidden;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }

  const patch: DndFlags = {};
  if (typeof body.email === 'boolean') patch.email = body.email;
  if (typeof body.sms === 'boolean') patch.sms = body.sms;
  if (patch.email === undefined && patch.sms === undefined) {
    return NextResponse.json(
      { error: 'Body must include an email or sms boolean' },
      { status: 400 },
    );
  }

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, accountKey },
    select: { id: true, accountKey: true, email: true, phone: true, dnd: true },
  });
  if (!contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  // Read outside the transaction, so the hierarchy lookup doesn't hold a
  // second connection while the transaction's waits on it.
  const relatedAccountKeys = await getRelatedAccountKeys(accountKey);

  // Suppression rows and dnd flags change together, so the UI and the send
  // path can't disagree.
  await prisma.$transaction(async (tx) => {
    const change = await applyContactOptOutChange({
      accountKey,
      email: contact.email,
      phone: contact.phone,
      patch,
      tx,
      relatedAccountKeys,
    });

    await tx.contact.update({
      where: { id: contact.id },
      data: { dnd: dndWriteValue(dndAfterChange(contact.dnd, patch, change, accountKey)) },
    });

    // Mirror the change onto contacts elsewhere in the group that share this
    // email/phone, so their pages and the contacts table agree with the rows
    // just written. Contact has @@unique([accountKey,email]) and
    // @@unique([accountKey,phone]), so at most one contact matches per
    // account per channel. Each keeps its flag on while something it can't
    // clear still holds the address at ITS account.
    if (relatedAccountKeys.length === 0) return;
    const emailMatch = patch.email !== undefined ? normalizeOptOutEmail(contact.email) : null;
    const phoneMatch = patch.sms !== undefined ? normalizeOptOutPhone(contact.phone) : null;
    // Both spellings, so a sibling stored before addresses were normalized
    // still matches — and each stays an exact, indexed lookup.
    const orFilters: Prisma.ContactWhereInput[] = [];
    if (emailMatch) orFilters.push({ email: { in: unique([emailMatch, contact.email ?? '']) } });
    if (phoneMatch) orFilters.push({ phone: { in: unique([phoneMatch, contact.phone ?? '']) } });
    if (orFilters.length === 0) return;

    const siblings = await tx.contact.findMany({
      where: { accountKey: { in: relatedAccountKeys }, OR: orFilters },
      select: { id: true, accountKey: true, email: true, phone: true, dnd: true },
    });
    for (const sibling of siblings) {
      const siblingPatch: DndFlags = {};
      if (emailMatch && normalizeOptOutEmail(sibling.email) === emailMatch) {
        siblingPatch.email = patch.email;
      }
      if (phoneMatch && normalizeOptOutPhone(sibling.phone) === phoneMatch) {
        siblingPatch.sms = patch.sms;
      }
      if (siblingPatch.email === undefined && siblingPatch.sms === undefined) continue;
      const next = dndAfterChange(sibling.dnd, siblingPatch, change, sibling.accountKey);
      const current = readDndFlags(sibling.dnd);
      if (next.email === current.email && next.sms === current.sms) continue;
      await tx.contact.update({ where: { id: sibling.id }, data: { dnd: dndWriteValue(next) } });
    }
  });

  const updated = await prisma.contact.findUniqueOrThrow({
    where: { id: contact.id },
    select: CONTACT_SELECT,
  });
  const optOuts = await loadContactOptOutState({ ...contact, dnd: updated.dnd });

  return NextResponse.json({
    contact: serializeContact(updated),
    // What the toggle should show. A channel turned off that is still held
    // stays true here, with `optOuts.<channel>.lockedBy` saying why.
    dnd: displayedDnd(optOuts),
    optOuts,
  });
}
