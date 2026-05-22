import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireRole } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { listContactsForAccount, CONTACT_SELECT, serializeContact } from '@/lib/contacts/queries';
import { normaliseEmail, normalisePhone } from '@/lib/contacts/normalize';

// GET /api/contacts?accountKey=&search=&limit=&all=true&includeMessaging=true
//   List contacts for a sub-account. Response matches the existing
//   /api/esp/contacts shape so Phase C consumers just swap the URL:
//     { contacts: Contact[], meta: { total, accountKey, provider } }
//
// POST /api/contacts
//   Body: { accountKey, ...contactFields }. Creates a single contact.
//   Used by the future "Add contact" toolbar action; safe to ship
//   now because Phase A introduced no DB consumers yet.

export async function GET(req: NextRequest) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin', 'client');
  if (error) return error;

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

  const fetchAll = req.nextUrl.searchParams.get('all') === 'true';
  const includeMessaging =
    req.nextUrl.searchParams.get('includeMessaging') === 'true';
  const limitRaw = Number(req.nextUrl.searchParams.get('limit') || '25');
  const limit = Number.isFinite(limitRaw) ? limitRaw : 25;
  const search = (req.nextUrl.searchParams.get('search') || '').trim();

  try {
    const result = await listContactsForAccount({
      accountKey,
      search,
      limit,
      all: fetchAll,
      includeMessagingSummary: includeMessaging,
    });

    return NextResponse.json({
      contacts: result.contacts,
      meta: {
        total: result.total,
        accountKey,
        // Provider is fixed now that contacts are Loomi-native. Kept
        // in the response for compatibility with the existing UI's
        // "Create Campaign in <provider>" branch — Phase D removes
        // that branch entirely.
        provider: 'loomi',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch contacts';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }

  const accountKey = typeof body.accountKey === 'string' ? body.accountKey.trim() : '';
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }

  if (session!.user.role === 'admin') {
    const assigned = session!.user.accountKeys ?? [];
    if (assigned.length > 0 && !assigned.includes(accountKey)) {
      return NextResponse.json({ error: 'Forbidden for this account' }, { status: 403 });
    }
  }

  const email = stringField(body.email);
  const phone = stringField(body.phone);
  const normalisedEmail = email ? normaliseEmail(email) : null;
  const normalisedPhone = phone ? normalisePhone(phone) : null;

  if (!normalisedEmail && !normalisedPhone) {
    return NextResponse.json(
      { error: 'Contact needs at least one of email or phone' },
      { status: 400 },
    );
  }

  const data: Prisma.ContactCreateInput = {
    account: { connect: { key: accountKey } },
    email: normalisedEmail,
    phone: normalisedPhone,
    firstName: stringField(body.firstName),
    lastName: stringField(body.lastName),
    fullName: stringField(body.fullName),
    address1: stringField(body.address1),
    city: stringField(body.city),
    state: stringField(body.state),
    postalCode: stringField(body.postalCode),
    country: stringField(body.country),
    source: stringField(body.source),
    tags: tagsField(body.tags) ?? [],
    dateAdded: dateField(body.dateAdded),
    vehicleYear: stringField(body.vehicleYear),
    vehicleMake: stringField(body.vehicleMake),
    vehicleModel: stringField(body.vehicleModel),
    vehicleVin: stringField(body.vehicleVin),
    vehicleMileage: stringField(body.vehicleMileage),
    lastServiceDate: dateField(body.lastServiceDate),
    nextServiceDate: dateField(body.nextServiceDate),
    leaseEndDate: dateField(body.leaseEndDate),
    warrantyEndDate: dateField(body.warrantyEndDate),
    purchaseDate: dateField(body.purchaseDate),
    customFields: customFieldsField(body.customFields) ?? Prisma.DbNull,
    dnd: dndField(body.dnd) ?? Prisma.DbNull,
  };

  try {
    const row = await prisma.contact.create({ data, select: CONTACT_SELECT });
    return NextResponse.json({ contact: serializeContact(row) }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Unique-constraint hit on (accountKey, email) or (accountKey, phone).
      return NextResponse.json(
        { error: 'A contact with that email or phone already exists for this account' },
        { status: 409 },
      );
    }
    const message = err instanceof Error ? err.message : 'Failed to create contact';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── Body coercion helpers ──

function stringField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function dateField(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function tagsField(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const cleaned = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
  return cleaned;
}

function customFieldsField(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    out[key] = trimmed;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function dndField(value: unknown): { email?: boolean; sms?: boolean } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const out: { email?: boolean; sms?: boolean } = {};
  if (typeof row.email === 'boolean') out.email = row.email;
  if (typeof row.sms === 'boolean') out.sms = row.sms;
  return Object.keys(out).length > 0 ? out : null;
}
