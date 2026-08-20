import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope, canAccessAccount, forbidden } from '@/lib/api-auth';
import { requireAllPermissions } from '@/lib/permissions/require';
import { recordCapabilityUse } from '@/lib/permissions/audit';
import {
  buildContactsCsv,
  csvHeaders,
  loadContactsForCsv,
} from '@/lib/contacts/csv';

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
 *
 * The column list and row formatting live in `@/lib/contacts/csv`, shared
 * with the segment export so the two files are identical.
 */

/** Cap one request; the UI exports a selection, not the whole database. */
const MAX_ROWS = 50_000;

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
  const allowedKeys = accountKey ? [accountKey] : scope ?? null;

  const contacts = await loadContactsForCsv(contactIds, allowedKeys);
  const csv = buildContactsCsv(contacts);

  recordCapabilityUse(
    { id: session!.user.id, email: session!.user.email },
    'contacts.pii.export',
    `Exported ${contacts.length} contact(s) to CSV`,
    accountKey,
  );

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: csvHeaders(`contacts-${stamp}.csv`),
  });
}
