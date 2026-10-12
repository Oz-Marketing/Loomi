// Who is opted out, as of right now — the one lookup every send path uses.
//
// Three rules, each of which some path used to get wrong:
//
//  1. An opt-out anywhere in an account's GROUP applies to the account. The
//     writers are supposed to cascade a suppression row to every sibling, but
//     not all of them did, and an account that joins a group later never
//     received the rows written before it joined. Checking the whole group at
//     send time makes both of those harmless.
//  2. Emails compare case-insensitively. Most writers store lowercase; one
//     stored the contact's address as typed, and an exact match against a
//     lowercased audience never found it.
//  3. Phones compare by their digits, with a US leading 1 dropped. A STOP
//     arrives from Twilio as "+18015550101" while a contact can hold
//     "(801) 555-0101"; exact matching between those formats texts someone
//     who said STOP.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { chunk, DB_CHUNK } from '@/lib/db/chunk';
import { getSuppressionScopes } from '@/lib/services/accounts';

/** Returns the suppression reason for (accountKey, address), or null. */
export type SuppressionCheck = (accountKey: string, address: string) => string | null;

/**
 * Comparison key for a phone: digits only, US numbers without their leading 1.
 * "(801) 555-0101", "801.555.0101", "+1 801 555 0101" and "18015550101" all
 * become "8015550101".
 */
export function phoneMatchKey(raw: string | null | undefined): string {
  const digits = String(raw || '').replace(/\D+/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

/** The SQL twin of phoneMatchKey, applied to a column. */
const PHONE_KEY_SQL = Prisma.sql`(CASE
  WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) = 11
   AND left(regexp_replace(phone, '[^0-9]', '', 'g'), 1) = '1'
  THEN right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
  ELSE regexp_replace(phone, '[^0-9]', '', 'g')
END)`;

function buildCheck(
  scopes: Map<string, string[]>,
  byAddress: Map<string, Map<string, string>>,
  normalize: (address: string) => string,
): SuppressionCheck {
  return (accountKey, address) => {
    const byAccount = byAddress.get(normalize(address));
    if (!byAccount) return null;
    for (const key of scopes.get(accountKey) ?? [accountKey]) {
      const reason = byAccount.get(key);
      if (reason) return reason;
    }
    return null;
  };
}

/**
 * Email suppressions for a set of (account, email) pairs. Chunks run one after
 * another rather than in parallel, so a large audience can't take a dozen of
 * the database's connections at once.
 */
export async function loadEmailSuppressions(
  refs: { accountKey: string; email: string | null | undefined }[],
): Promise<SuppressionCheck> {
  const normalize = (email: string) => email.toLowerCase().trim();
  const accountKeys = [...new Set(refs.map((r) => r.accountKey).filter(Boolean))];
  const emails = [
    ...new Set(refs.map((r) => normalize(r.email || '')).filter(Boolean)),
  ];
  const scopes = await getSuppressionScopes(accountKeys);
  const byAddress = new Map<string, Map<string, string>>();
  if (accountKeys.length === 0 || emails.length === 0) {
    return buildCheck(scopes, byAddress, normalize);
  }

  const scopeKeys = [...new Set([...scopes.values()].flat())];
  for (const slice of chunk(emails, DB_CHUNK)) {
    const rows = await prisma.$queryRaw<{ accountKey: string; email: string; reason: string }[]>(
      Prisma.sql`SELECT "accountKey", lower(trim(email)) AS email, reason
        FROM "EmailSuppression"
        WHERE "accountKey" IN (${Prisma.join(scopeKeys)})
          AND lower(trim(email)) IN (${Prisma.join(slice)})`,
    );
    for (const row of rows) {
      const byAccount = byAddress.get(row.email) ?? new Map<string, string>();
      byAccount.set(row.accountKey, row.reason);
      byAddress.set(row.email, byAccount);
    }
  }
  return buildCheck(scopes, byAddress, normalize);
}

/** SMS suppressions for a set of (account, phone) pairs, matched by phoneMatchKey. */
export async function loadSmsSuppressions(
  refs: { accountKey: string; phone: string | null | undefined }[],
): Promise<SuppressionCheck> {
  const accountKeys = [...new Set(refs.map((r) => r.accountKey).filter(Boolean))];
  const phoneKeys = [...new Set(refs.map((r) => phoneMatchKey(r.phone)).filter(Boolean))];
  const scopes = await getSuppressionScopes(accountKeys);
  const byAddress = new Map<string, Map<string, string>>();
  if (accountKeys.length === 0 || phoneKeys.length === 0) {
    return buildCheck(scopes, byAddress, phoneMatchKey);
  }

  const scopeKeys = [...new Set([...scopes.values()].flat())];
  for (const slice of chunk(phoneKeys, DB_CHUNK)) {
    const rows = await prisma.$queryRaw<{ accountKey: string; phoneKey: string; reason: string }[]>(
      Prisma.sql`SELECT "accountKey", ${PHONE_KEY_SQL} AS "phoneKey", reason
        FROM "SmsSuppression"
        WHERE "accountKey" IN (${Prisma.join(scopeKeys)})
          AND ${PHONE_KEY_SQL} IN (${Prisma.join(slice)})`,
    );
    for (const row of rows) {
      const byAccount = byAddress.get(row.phoneKey) ?? new Map<string, string>();
      byAccount.set(row.accountKey, row.reason);
      byAddress.set(row.phoneKey, byAccount);
    }
  }
  return buildCheck(scopes, byAddress, phoneMatchKey);
}
