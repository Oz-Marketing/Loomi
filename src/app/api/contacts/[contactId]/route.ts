import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';
import { CONTACT_SELECT, serializeContact } from '@/lib/contacts/queries';
import { normaliseEmail, normalisePhone } from '@/lib/contacts/normalize';
import {
  applyContactOptOutChange,
  dndAfterChange,
  readDndFlags,
  type DndFlags,
} from '@/lib/sending/opt-outs';
import { getRelatedAccountKeys } from '@/lib/services/accounts';

type RouteContext = { params: Promise<{ contactId: string }> };

// GET    /api/contacts/:id?accountKey=  — single contact + account summary
// PATCH  /api/contacts/:id?accountKey=  — partial update
// DELETE /api/contacts/:id?accountKey=  — remove the row
//
// Response shape matches /api/esp/contacts/:id (contact, account,
// provider, capabilities) so the contact detail page can be flipped
// in Phase C with no client-side reshaping. Capabilities are now
// Loomi-fixed: dnd is { email, sms } only (Phase C drops the 7-channel
// grid), conversations + messaging come from EmailEvent / SmsEvent +
// the Twilio direct engine.

const LOOMI_CAPABILITIES = {
  dnd: true,
  conversations: true,
  messaging: true,
} as const;

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { session, error } = await requirePermission(['studio.contacts.view', 'reporting.report.view']);
  if (error) return error;

  const { contactId } = await params;
  const accountKey = req.nextUrl.searchParams.get('accountKey')?.trim() ?? '';
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }

  if (session!.user.role === 'client') {
    const assigned = session!.user.accountKeys ?? [];
    if (!assigned.includes(accountKey)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const row = await prisma.contact.findFirst({
    where: { id: contactId, accountKey },
    select: CONTACT_SELECT,
  });
  if (!row) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: {
      key: true,
      dealer: true,
      address: true,
      city: true,
      state: true,
      postalCode: true,
      logos: true,
    },
  });

  return NextResponse.json({
    contact: serializeContact(row),
    account: account
      ? {
          key: account.key,
          dealer: account.dealer,
          address: account.address ?? '',
          city: account.city ?? '',
          state: account.state ?? '',
          postalCode: account.postalCode ?? '',
          logos: parseLogos(account.logos),
        }
      : null,
    provider: 'loomi',
    capabilities: LOOMI_CAPABILITIES,
  });
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { session, error } = await requirePermission('studio.contacts.edit');
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

  const existing = await prisma.contact.findFirst({
    where: { id: contactId, accountKey },
    // The name columns come back because `fullName` has to be re-derived
    // when either half of the name changes — see below. The address and dnd
    // columns, because an opt-out is written against the address.
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, dnd: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  const data: Prisma.ContactUpdateInput = {};

  // Strings: present-and-string → trimmed value; explicit null → clear.
  for (const key of STRING_FIELDS) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value === null) {
      (data as Record<string, unknown>)[key] = null;
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      (data as Record<string, unknown>)[key] = trimmed === '' ? null : trimmed;
    }
  }

  // Email / phone get the same normalisation as imports. The resulting
  // addresses are tracked too: an opt-out applies to the address the contact
  // has AFTER this update.
  let nextEmail = existing.email;
  let nextPhone = existing.phone;
  if ('email' in body) {
    if (body.email === null) data.email = nextEmail = null;
    else if (typeof body.email === 'string') {
      const next = normaliseEmail(body.email);
      data.email = nextEmail = next || null;
    }
  }
  if ('phone' in body) {
    if (body.phone === null) data.phone = nextPhone = null;
    else if (typeof body.phone === 'string') {
      const next = normalisePhone(body.phone);
      data.phone = nextPhone = next || null;
    }
  }

  // Dates: string → Date; null → clear.
  for (const key of DATE_FIELDS) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value === null) {
      (data as Record<string, unknown>)[key] = null;
    } else if (typeof value === 'string' && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        (data as Record<string, unknown>)[key] = parsed;
      }
    }
  }

  // `fullName` is a STORED column, not a computed one: the contacts list
  // searches it (`c."fullName" ILIKE`), sorts on it, and renders it in
  // preference to firstName + lastName. So renaming a contact without
  // re-deriving it leaves them listed, searchable and sortable under the
  // OLD name while the detail page shows the new one — with nothing
  // reporting a failure.
  //
  // Import already derives it the same way (see lib/contacts/normalize).
  // An explicit `fullName` in the body still wins, so a caller that wants
  // a display name unlike "first last" can still set one.
  const renamingFirst = 'firstName' in body;
  const renamingLast = 'lastName' in body;
  if ((renamingFirst || renamingLast) && !('fullName' in body)) {
    const nextFirst = renamingFirst
      ? ((data as Record<string, unknown>).firstName as string | null)
      : existing.firstName;
    const nextLast = renamingLast
      ? ((data as Record<string, unknown>).lastName as string | null)
      : existing.lastName;
    const derived = [nextFirst, nextLast].filter(Boolean).join(' ').trim();
    data.fullName = derived || null;
  }

  if ('tags' in body && Array.isArray(body.tags)) {
    data.tags = body.tags
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean);
  }

  if ('customFields' in body) {
    if (body.customFields === null) {
      data.customFields = Prisma.DbNull;
    } else if (body.customFields && typeof body.customFields === 'object' && !Array.isArray(body.customFields)) {
      const sanitised: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.customFields as Record<string, unknown>)) {
        if (typeof v === 'string' && v.trim()) sanitised[k] = v.trim();
      }
      data.customFields = Object.keys(sanitised).length > 0 ? sanitised : Prisma.DbNull;
    }
  }

  // dnd follows the contact toggle's rules (applyContactOptOutChange): turning
  // a channel on writes the suppression rows for the whole group; turning it
  // off clears only what staff may clear, and a channel held by the person's
  // own unsubscribe, a bounce or an import stays on. Per channel — a channel
  // the body leaves out is left alone, where this used to replace the whole
  // cell and drop it. `dnd: null` turns both off.
  const dndPatch = parseDndPatch(body);

  // An opted-out contact whose email or phone changes keeps its opt-out on
  // the new address too — the flag says this PERSON opted out, and the send
  // path looks up suppression rows by address.
  const flags = readDndFlags(existing.dnd);
  const carried: DndFlags = {};
  if (nextEmail !== existing.email && flags.email === true && dndPatch?.email === undefined) {
    carried.email = true;
  }
  if (nextPhone !== existing.phone && flags.sms === true && dndPatch?.sms === undefined) {
    carried.sms = true;
  }
  const optOutPatch: DndFlags | null =
    dndPatch || Object.keys(carried).length > 0 ? { ...carried, ...dndPatch } : null;

  try {
    // Resolved outside the transaction, so it doesn't hold a second
    // connection open while the first waits on it.
    const relatedAccountKeys = optOutPatch ? await getRelatedAccountKeys(accountKey) : [];
    const updated = optOutPatch
      ? await prisma.$transaction(async (tx) => {
          const change = await applyContactOptOutChange({
            accountKey,
            email: nextEmail,
            phone: nextPhone,
            patch: optOutPatch,
            tx,
            relatedAccountKeys,
          });
          const next = dndAfterChange(existing.dnd, optOutPatch, change, accountKey);
          data.dnd = Object.keys(next).length > 0 ? { ...next } : Prisma.DbNull;
          return tx.contact.update({ where: { id: contactId }, data, select: CONTACT_SELECT });
        })
      : await prisma.contact.update({
          where: { id: contactId },
          data,
          select: CONTACT_SELECT,
        });
    return NextResponse.json({
      contact: serializeContact(updated),
      provider: 'loomi',
      capabilities: LOOMI_CAPABILITIES,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json(
        { error: 'Another contact in this account already has that email or phone' },
        { status: 409 },
      );
    }
    const message = err instanceof Error ? err.message : 'Failed to update contact';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { session, error } = await requirePermission('studio.contacts.edit');
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

  const result = await prisma.contact.deleteMany({
    where: { id: contactId, accountKey },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}

/** The dnd channels a PATCH body asks to change, or null when it doesn't touch dnd. */
function parseDndPatch(body: Record<string, unknown>): DndFlags | null {
  if (!('dnd' in body)) return null;
  if (body.dnd === null) return { email: false, sms: false };
  if (!body.dnd || typeof body.dnd !== 'object' || Array.isArray(body.dnd)) return null;
  const row = body.dnd as Record<string, unknown>;
  const patch: DndFlags = {};
  if (typeof row.email === 'boolean') patch.email = row.email;
  if (typeof row.sms === 'boolean') patch.sms = row.sms;
  return Object.keys(patch).length > 0 ? patch : null;
}

// ── Field lists ──

const STRING_FIELDS = [
  'firstName',
  'lastName',
  'fullName',
  'address1',
  'city',
  'state',
  'postalCode',
  'country',
  'source',
  'vehicleYear',
  'vehicleMake',
  'vehicleModel',
  'vehicleVin',
  'vehicleMileage',
] as const;

const DATE_FIELDS = [
  'dateAdded',
  'lastServiceDate',
  'nextServiceDate',
  'leaseEndDate',
  'warrantyEndDate',
  'purchaseDate',
] as const;

function parseLogos(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
