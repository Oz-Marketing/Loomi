import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { channelRegistry } from '@/lib/services/budget-channels';
import { isValidPeriod, periodOf } from '@/lib/budget/period';
import { upsertImportedLines } from '@/lib/services/budget';

/**
 * Oz Reports → Loomi budget ingest (transitional).
 *
 * Machine-to-machine, same shared secret as /api/ingest/contacts. The push
 * side lives on the Oz Reports host (Loomi.php::pushbudgets) because that's
 * where the budget tables and the dealer→account mapping both live; this end
 * only maps, validates and upserts. See docs/budget-module.md §6.
 *
 * Idempotent: every line carries `externalId` ("ozreports:account_budgets:N"),
 * so re-running updates in place instead of duplicating an 8,000-line ledger.
 *
 * Throwaway by design, like the contacts bridge — it gets deleted when Oz
 * Reports is decommissioned.
 */

// Oz Reports has ~8,000 live budget lines. Batching keeps a single request off
// the request-timeout cliff and makes a partial failure cheap to retry.
const MAX_LINES_PER_REQUEST = 500;

function timingSafeCompare(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function presentedSecret(req: NextRequest): string {
  const header = req.headers.get('x-oz-ingest-secret')?.trim() || '';
  if (header) return header;
  const auth = req.headers.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice('bearer '.length).trim();
  return '';
}

/** One row as the Oz Reports push sends it — raw source shape, mapped here. */
interface IncomingLine {
  /** account_budgets.id */
  id?: number;
  /** dealer_map.loomi_account_key for account_id (billed to) */
  accountKey?: string | null;
  /** …and for spend_account_id, when it differs */
  spendAccountKey?: string | null;
  ozChannelId?: number | null;
  forYear?: number | null;
  forMonth?: number | null;
  budget?: number | string | null;
  /** margin from margin_rules, already resolved with the 999 fallback */
  margin?: number | string | null;
  campaignName?: string | null;
  bulkEntryId?: string | null;
  specialBudgetName?: string | null;
}

export async function POST(req: NextRequest) {
  const expected = (process.env.OZ_INGEST_SECRET || '').trim();
  if (!expected) {
    return NextResponse.json({ error: 'OZ_INGEST_SECRET is not configured' }, { status: 500 });
  }
  const presented = presentedSecret(req);
  if (!presented || !timingSafeCompare(presented, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ch = await channelRegistry();

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const lines: IncomingLine[] = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length > MAX_LINES_PER_REQUEST) {
    return NextResponse.json(
      { error: `Batch exceeds ${MAX_LINES_PER_REQUEST} lines; split into smaller requests` },
      { status: 400 },
    );
  }
  const archivedIds: string[] = Array.isArray(body.archivedIds)
    ? body.archivedIds.filter((x: unknown) => typeof x === 'string')
    : [];
  // Report what WOULD happen without writing. The push runs this first so the
  // channel/account gaps surface before a single row lands.
  const dryRun = body.dryRun === true;

  // Every account referenced must exist in Loomi. Checked up front in one
  // query — a per-row lookup across 500 rows is 500 round trips, and a missing
  // account is a mapping problem to report, not an FK error to crash on.
  const referenced = new Set<string>();
  for (const l of lines) {
    if (l.accountKey) referenced.add(l.accountKey);
    if (l.spendAccountKey) referenced.add(l.spendAccountKey);
  }
  const known = new Set(
    (
      await prisma.account.findMany({
        where: { key: { in: [...referenced] } },
        select: { key: true },
      })
    ).map((a) => a.key),
  );

  const mapped: Parameters<typeof upsertImportedLines>[0] = [];
  const rejected: { externalId: string; reason: string }[] = [];
  // Aggregated so a systemic gap reads as one line item rather than 400.
  const unmappedChannels = new Map<number, { lines: number; dollars: number }>();
  const unknownAccounts = new Map<string, number>();

  for (const l of lines) {
    const externalId = `ozreports:account_budgets:${l.id}`;
    const amount = Number(l.budget ?? 0);
    const note = (reason: string) => rejected.push({ externalId, reason });

    if (!l.id) {
      note('missing source id');
      continue;
    }
    if (!l.accountKey) {
      note('account has no loomi_account_key');
      continue;
    }
    if (!known.has(l.accountKey)) {
      unknownAccounts.set(l.accountKey, (unknownAccounts.get(l.accountKey) ?? 0) + 1);
      note(`account "${l.accountKey}" does not exist in Loomi`);
      continue;
    }
    if (l.spendAccountKey && !known.has(l.spendAccountKey)) {
      note(`spend account "${l.spendAccountKey}" does not exist in Loomi`);
      continue;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      note(`unusable budget amount "${l.budget}"`);
      continue;
    }

    // Oz allows channel_id 0/NULL and has ids with no Loomi home. Both get
    // reported with their dollar weight rather than dropped into a catch-all —
    // guessing here is how money quietly lands in the wrong place.
    const channel = ch.fromExternalId(l.ozChannelId ?? null);
    if (!channel || !ch.has(channel)) {
      const id = l.ozChannelId ?? 0;
      const prev = unmappedChannels.get(id) ?? { lines: 0, dollars: 0 };
      unmappedChannels.set(id, { lines: prev.lines + 1, dollars: prev.dollars + amount });
      note(`Oz channel_id ${id} has no Loomi channel`);
      continue;
    }

    const year = Number(l.forYear ?? 0);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      note(`unusable for_year "${l.forYear}"`);
      continue;
    }
    // for_month 0 is Oz's "unassigned pool" marker — a real state here, not an
    // error: the line keeps its year and simply has no period.
    const month = Number(l.forMonth ?? 0);
    const period = month >= 1 && month <= 12 ? periodOf(year, month) : null;
    if (period && !isValidPeriod(period)) {
      note(`unusable for_month "${l.forMonth}"`);
      continue;
    }

    // Oz stores the agency's cut; Loomi stores the client→spend factor.
    const margin = Number(l.margin ?? 0);
    const markup = Number.isFinite(margin) && margin > 0 && margin < 1 ? 1 - margin : null;

    mapped.push({
      externalId,
      accountKey: l.accountKey,
      spendAccountKey: l.spendAccountKey || l.accountKey,
      year,
      period,
      channel,
      amount,
      markup,
      source: 'adhoc',
      status: 'committed',
      batchId: l.bulkEntryId || null,
      label: l.campaignName?.trim() || l.specialBudgetName?.trim() || null,
      notes: l.specialBudgetName ? `Special budget: ${l.specialBudgetName}` : null,
    });
  }

  const summary = {
    received: lines.length,
    mappable: mapped.length,
    rejected: rejected.length,
    unmappedChannels: [...unmappedChannels.entries()]
      .map(([ozChannelId, v]) => ({ ozChannelId, ...v }))
      .sort((a, b) => b.dollars - a.dollars),
    unknownAccounts: [...unknownAccounts.entries()].map(([key, lines]) => ({ key, lines })),
  };

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      ...summary,
      wouldArchive: archivedIds.length,
      // Capped — a systemic failure would otherwise return thousands of rows.
      sampleRejected: rejected.slice(0, 25),
    });
  }

  const result = await upsertImportedLines(mapped, archivedIds, null);

  return NextResponse.json({
    ...summary,
    created: result.created,
    updated: result.updated,
    archived: result.archived,
    // Rejections from the write pass (FK races, invariant violations) on top of
    // the mapping rejections above.
    writeRejected: result.rejected.slice(0, 25),
  });
}
