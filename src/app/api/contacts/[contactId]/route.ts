import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireRole } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { CONTACT_SELECT, serializeContact } from '@/lib/contacts/queries';
import { normaliseEmail, normalisePhone } from '@/lib/contacts/normalize';

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
  const { session, error } = await requireRole('developer', 'super_admin', 'admin', 'client');
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

  const existing = await prisma.contact.findFirst({
    where: { id: contactId, accountKey },
    select: { id: true },
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

  // Email / phone get the same normalisation as imports.
  if ('email' in body) {
    if (body.email === null) data.email = null;
    else if (typeof body.email === 'string') {
      const next = normaliseEmail(body.email);
      data.email = next || null;
    }
  }
  if ('phone' in body) {
    if (body.phone === null) data.phone = null;
    else if (typeof body.phone === 'string') {
      const next = normalisePhone(body.phone);
      data.phone = next || null;
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

  if ('dnd' in body) {
    if (body.dnd === null) {
      data.dnd = Prisma.DbNull;
    } else if (body.dnd && typeof body.dnd === 'object' && !Array.isArray(body.dnd)) {
      const row = body.dnd as Record<string, unknown>;
      const next: { email?: boolean; sms?: boolean } = {};
      if (typeof row.email === 'boolean') next.email = row.email;
      if (typeof row.sms === 'boolean') next.sms = row.sms;
      data.dnd = Object.keys(next).length > 0 ? next : Prisma.DbNull;
    }
  }

  try {
    const updated = await prisma.contact.update({
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

  const result = await prisma.contact.deleteMany({
    where: { id: contactId, accountKey },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
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
