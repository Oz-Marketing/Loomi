import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope, canAccessAccount, forbidden } from '@/lib/api-auth';
import { requireAllPermissions } from '@/lib/permissions/require';
import { recordCapabilityUse } from '@/lib/permissions/audit';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/contacts/export — CSV for the given contacts.
 *
 * This endpoint exists to give `contacts.pii.export` something to guard.
 *
 * Export used to be built entirely in the browser (`buildCsv` in
 * contacts-table.tsx) from rows already fetched by `GET /api/contacts`, so
 * there was no server-side moment where "this person is taking names, emails
 * and phone numbers out of Loomi" could be checked or recorded. Gating the
 * bulk read instead was not an option: the Reporting Contacts page uses the
 * same endpoint, so it would have locked dealers out of their own contacts.
 *
 * Doing it here also gives the audit trail a real entry — who exported, how
 * many rows, from which account.
 */

const COLUMNS: { key: string; label: string }[] = [
  { key: 'fullName', label: 'Full Name' },
  { key: 'firstName', label: 'First Name' },
  { key: 'lastName', label: 'Last Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'address1', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'postalCode', label: 'Postal Code' },
  { key: 'country', label: 'Country' },
  { key: 'source', label: 'Source' },
  { key: 'tags', label: 'Tags' },
  { key: 'dateAdded', label: 'Date Added' },
  { key: 'vehicleYear', label: 'Vehicle Year' },
  { key: 'vehicleMake', label: 'Vehicle Make' },
  { key: 'vehicleModel', label: 'Vehicle Model' },
];

/** Cap one request; the UI exports a selection, not the whole database. */
const MAX_ROWS = 50_000;

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatCell(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAllPermissions([
    'studio.contacts.view',
    'contacts.pii.export',
  ]);
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const contactIds: string[] = Array.isArray(body?.contactIds)
    ? [...new Set((body.contactIds as unknown[]).map((v) => String(v)).filter(Boolean))]
    : [];
  const accountKey =
    typeof body?.accountKey === 'string' && body.accountKey.trim()
      ? body.accountKey.trim()
      : null;

  if (contactIds.length === 0) {
    return NextResponse.json({ error: 'contactIds[] is required' }, { status: 400 });
  }
  if (contactIds.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Export limit is ${MAX_ROWS.toLocaleString()} contacts per request` },
      { status: 400 },
    );
  }
  // Scope the query itself rather than filtering after: a caller passing IDs
  // from an account they can't reach should get nothing, not a shorter list
  // that still confirms those IDs exist.
  const scope = getAccountScope(session!);
  if (accountKey && !canAccessAccount(scope, accountKey)) {
    return forbidden();
  }
  // One `accountKey` clause, intersecting the requested account with the
  // caller's scope. Two separate spreads both set the same key, so the second
  // silently replaced the first and the explicit account filter did nothing.
  const allowedKeys = accountKey
    ? [accountKey]
    : scope ?? null;

  const contacts = await prisma.contact.findMany({
    where: {
      id: { in: contactIds },
      ...(allowedKeys ? { accountKey: { in: allowedKeys } } : {}),
    },
    select: {
      id: true,
      accountKey: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      address1: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      source: true,
      dateAdded: true,
      vehicleYear: true,
      vehicleMake: true,
      vehicleModel: true,
      tags: true,
    },
  });

  const rows = contacts.map((c) => {
    const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ');
    const record: Record<string, unknown> = {
      ...c,
      fullName,
      // `Contact.tags` is a JSON column, not a relation.
      tags: Array.isArray(c.tags) ? c.tags.map((t) => String(t)).join('; ') : '',
    };
    return COLUMNS.map((col) => csvEscape(formatCell(record[col.key]))).join(',');
  });

  const csv = [COLUMNS.map((c) => csvEscape(c.label)).join(','), ...rows].join('\n');

  recordCapabilityUse(
    { id: session!.user.id, email: session!.user.email },
    'contacts.pii.export',
    `Exported ${contacts.length} contact(s) to CSV`,
    accountKey,
  );

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="contacts-${stamp}.csv"`,
    },
  });
}
