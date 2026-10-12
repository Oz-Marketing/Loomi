import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';
import { chunk, DB_CHUNK } from '@/lib/db/chunk';
import { getRelatedAccountKeys } from '@/lib/services/accounts';
import {
  OPT_OUT_SOURCE,
  parseOptOutEmail,
  parseOptOutList,
  parseOptOutPhone,
  recordEmailOptOuts,
  recordSmsOptOuts,
} from '@/lib/sending/opt-outs';

// POST /api/accounts/[key]/suppressions/import
//
// Bring a list of opt-outs over from another system — GoHighLevel, as every
// blast moves off it. Anyone who opted out there must never be mailed or
// texted from Loomi, and until this existed the only way in was "Add
// manually", one address at a time.
//
// Two steps, both POST with a JSON body:
//
//   { mode: 'preview', text }
//       Parse a pasted list or an uploaded CSV (see parseOptOutList) and
//       count it: emails, phones, values that couldn't be read, and how many
//       are already suppressed here. Returns the normalized addresses. No
//       writes.
//
//   { mode: 'commit', emails?, phones? }
//       Suppress those addresses at this account and every other account in
//       its group. Each address is validated again — the client is never
//       trusted to have done it. Returns added / already suppressed / invalid.
//
// The client sends the commit in batches of `batchSize` (from the preview).
// Every address becomes one row per account in the group, and a list of tens
// of thousands across a twenty-account group is hundreds of thousands of rows
// — more than one request should carry through nginx's 60-second cut.
//
// Rows are written with reason 'manual' (a deliberate opt-out, not a bounce)
// and source 'import'. An export can't say whether the person opted out
// themselves, so the contact toggle treats imports as theirs and won't clear
// them; removing one is the explicit "Remove" in this tab.

interface RouteParams {
  params: Promise<{ key: string }>;
}

// The same ceiling as the contact CSV import.
const MAX_TEXT_BYTES = 25 * 1024 * 1024;

// Per commit request. The client batches well under this (see batchSizeFor);
// this is the backstop for a client that doesn't.
const MAX_ADDRESSES_PER_COMMIT = 5000;

/**
 * Addresses per commit request, sized by the group: each address is a row at
 * every account, so a bigger group gets smaller batches. About 20,000 rows a
 * request keeps each one to a handful of INSERTs.
 */
function batchSizeFor(groupAccounts: number): number {
  return Math.max(100, Math.min(2000, Math.floor(20000 / Math.max(1, groupAccounts))));
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  // The same gate and scope check as "Add manually" on the list route.
  const { error, session } = await requirePermission('agency.subaccounts.edit');
  if (error) return error;

  const { key } = await params;
  const userKeys = session!.user.accountKeys ?? [];
  if (session!.user.role === 'admin' && userKeys.length > 0 && !userKeys.includes(key)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }

  // Suppression rows have no foreign key to Account, so a mistyped key would
  // quietly write rows nothing ever reads.
  const account = await prisma.account.findUnique({ where: { key }, select: { key: true } });
  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  const relatedAccountKeys = await getRelatedAccountKeys(key);
  const groupAccounts = 1 + relatedAccountKeys.length;

  if (body.mode === 'preview') {
    if (typeof body.text !== 'string' || !body.text.trim()) {
      return NextResponse.json(
        { error: 'Paste a list or upload a file of emails or phone numbers.' },
        { status: 400 },
      );
    }
    if (Buffer.byteLength(body.text, 'utf8') > MAX_TEXT_BYTES) {
      return NextResponse.json(
        { error: `That's more than ${MAX_TEXT_BYTES / 1024 / 1024}MB. Split it into smaller files.` },
        { status: 413 },
      );
    }

    const parsed = parseOptOutList(body.text);
    const [emailsSuppressed, phonesSuppressed] = await Promise.all([
      countSuppressed('email', key, parsed.emails),
      countSuppressed('sms', key, parsed.phones),
    ]);

    return NextResponse.json({
      emails: parsed.emails,
      phones: parsed.phones,
      invalid: { count: parsed.invalidCount, samples: parsed.invalidSamples },
      optOutColumns: parsed.optOutColumns,
      notOptedOutRows: parsed.notOptedOutRows,
      rowCount: parsed.rowCount,
      hasHeader: parsed.hasHeader,
      alreadySuppressed: { email: emailsSuppressed, sms: phonesSuppressed },
      groupAccounts,
      batchSize: batchSizeFor(groupAccounts),
    });
  }

  if (body.mode === 'commit') {
    const rawEmails = stringList(body.emails);
    const rawPhones = stringList(body.phones);
    if (rawEmails === null || rawPhones === null) {
      return NextResponse.json(
        { error: 'emails and phones must be arrays of strings' },
        { status: 400 },
      );
    }
    if (rawEmails.length + rawPhones.length === 0) {
      return NextResponse.json({ error: 'Nothing to import' }, { status: 400 });
    }
    if (rawEmails.length + rawPhones.length > MAX_ADDRESSES_PER_COMMIT) {
      return NextResponse.json(
        { error: `At most ${MAX_ADDRESSES_PER_COMMIT} addresses per request — send it in batches.` },
        { status: 413 },
      );
    }

    const emails = validated(rawEmails, parseOptOutEmail);
    const phones = validated(rawPhones, parseOptOutPhone);

    const shared = {
      accountKey: key,
      reason: 'manual' as const,
      source: OPT_OUT_SOURCE.import,
      raw: JSON.stringify({ via: 'suppressions-import', userId: session!.user.id }),
      relatedAccountKeys,
    };
    const emailResult = emails.valid.length > 0
      ? await recordEmailOptOuts({ ...shared, emails: emails.valid })
      : null;
    const phoneResult = phones.valid.length > 0
      ? await recordSmsOptOuts({ ...shared, phones: phones.valid })
      : null;

    return NextResponse.json({
      email: {
        added: emailResult?.added ?? 0,
        alreadySuppressed: emails.valid.length - (emailResult?.added ?? 0),
        invalid: emails.invalid,
      },
      sms: {
        added: phoneResult?.added ?? 0,
        alreadySuppressed: phones.valid.length - (phoneResult?.added ?? 0),
        invalid: phones.invalid,
      },
      groupAccounts,
    });
  }

  return NextResponse.json({ error: "mode must be 'preview' or 'commit'" }, { status: 400 });
}

/** A JSON array of strings (absent → empty), or null when it's something else. */
function stringList(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  if (!value.every((entry) => typeof entry === 'string')) return null;
  return value as string[];
}

/** Normalize each entry, dedupe the good ones, count the rest. */
function validated(
  values: string[],
  parse: (raw: string) => string | null,
): { valid: string[]; invalid: number } {
  const valid = new Set<string>();
  let invalid = 0;
  for (const value of values) {
    const address = parse(value);
    if (address) valid.add(address);
    else invalid += 1;
  }
  return { valid: [...valid], invalid };
}

/** How many of these addresses already have a suppression row at this account. */
async function countSuppressed(
  channel: 'email' | 'sms',
  accountKey: string,
  addresses: string[],
): Promise<number> {
  let total = 0;
  for (const slice of chunk(addresses, DB_CHUNK)) {
    total +=
      channel === 'email'
        ? await prisma.emailSuppression.count({ where: { accountKey, email: { in: slice } } })
        : await prisma.smsSuppression.count({ where: { accountKey, phone: { in: slice } } });
  }
  return total;
}
