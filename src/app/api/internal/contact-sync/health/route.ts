import { NextRequest, NextResponse } from 'next/server';
import { requireInternalJobAuth } from '@/lib/internal-jobs';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/internal/contact-sync/health
 *
 * Freshness monitor for the CRM contact pipeline. The push side runs on the
 * Oz Reports host (scripts/ops/oz-reports-contact-sync.sh + cron), which
 * means Loomi cannot tell whether it's alive by looking at its own crontab —
 * a dead cron, a rotated ingest secret, an expired dealer mapping and a
 * genuinely quiet window all look the same from in here.
 *
 * So this reads the IngestRun log: every accepted batch writes a row, even
 * a zero-change one. No rows in `maxAgeHours` for an account that has CRM
 * contacts means the pipe is broken, not that the dealer sold nothing.
 *
 * Called daily by .github/workflows/contact-sync-health.yml, which fails the
 * run (→ GitHub notification) when `healthy` is false. Also useful by hand:
 *
 *   curl -H "x-internal-job-secret: $INTERNAL_JOB_SECRET" \
 *     "https://studio.loomilm.com/api/internal/contact-sync/health?maxAgeHours=30"
 *
 * Query params:
 *   maxAgeHours=N    staleness threshold (default 30 — one missed nightly
 *                    run plus slack for a long full sweep)
 *   retentionDays=N  IngestRun rows older than this are pruned (default 180,
 *                    0 disables). Keeps the log self-maintaining.
 *   ignore=a,b,c     Account keys to leave out of the check entirely —
 *                    rooftops deliberately parked out of the sync. Distinct
 *                    from the never-synced warning: parked accounts aren't
 *                    reported at all, so the warning list keeps meaning
 *                    "unexpected".
 */

const DEFAULT_MAX_AGE_HOURS = 30;
const DEFAULT_RETENTION_DAYS = 180;

// Batch-level source prefix the Oz Reports bridge sends. Used to find the
// accounts that are SUPPOSED to be receiving CRM contacts, so a hand-uploaded
// CSV account never gets flagged for a sync it was never part of.
const CRM_SOURCE_PREFIX = 'oz-reports';

type AccountStatus = 'ok' | 'stale' | 'never-synced';

interface AccountHealth {
  accountKey: string;
  dealer: string | null;
  status: AccountStatus;
  lastRunAt: string | null;
  hoursSinceLastRun: number | null;
  lastContactsRunAt: string | null;
  lastEventsRunAt: string | null;
  contactCount: number;
  lastContactUpdateAt: string | null;
  last24h: { runs: number; rows: number; created: number; updated: number; issues: number };
}

function hoursBetween(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / 3_600_000) * 10) / 10;
}

function positiveInt(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export async function GET(req: NextRequest) {
  const authError = requireInternalJobAuth(req);
  if (authError) return authError;

  const params = req.nextUrl.searchParams;
  const maxAgeHours = positiveInt(params.get('maxAgeHours'), DEFAULT_MAX_AGE_HOURS);
  const retentionDays = positiveInt(params.get('retentionDays'), DEFAULT_RETENTION_DAYS);
  const ignored = (params.get('ignore') || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);

  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 3_600_000);

  try {
    const [runsAllTime, runsByAccount, runsByAccountKind, recentRuns, contactsByAccount] = await Promise.all([
      prisma.ingestRun.count(),
      prisma.ingestRun.groupBy({
        by: ['accountKey'],
        _max: { startedAt: true },
      }),
      prisma.ingestRun.groupBy({
        by: ['accountKey', 'kind'],
        _max: { startedAt: true },
      }),
      prisma.ingestRun.groupBy({
        by: ['accountKey'],
        where: { startedAt: { gte: since24h } },
        _count: { _all: true },
        _sum: { totalRows: true, created: true, updated: true, issueCount: true },
      }),
      // Accounts that hold CRM-sourced contacts. Note the leads push
      // overrides source per contact with the CRM lead source ("AutoTrader"),
      // so a leads-only account won't appear here — it appears via its runs
      // instead, which is why both sides are unioned below.
      prisma.contact.groupBy({
        by: ['accountKey'],
        where: { source: { startsWith: CRM_SOURCE_PREFIX } },
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
    ]);

    const ignoreSet = new Set(ignored);
    const accountKeys = Array.from(
      new Set([
        ...runsByAccount.map((r) => r.accountKey),
        ...contactsByAccount.map((c) => c.accountKey),
      ]),
    )
      // Parked rooftops — deliberately out of the sync, so out of the check.
      .filter((key) => !ignoreSet.has(key))
      .sort();

    const dealers = await prisma.account.findMany({
      where: { key: { in: accountKeys } },
      select: { key: true, dealer: true },
    });
    const dealerByKey = new Map(dealers.map((d) => [d.key, d.dealer]));

    const lastRunByKey = new Map(runsByAccount.map((r) => [r.accountKey, r._max.startedAt]));
    const lastRunByKeyKind = new Map(
      runsByAccountKind.map((r) => [`${r.accountKey}:${r.kind}`, r._max.startedAt]),
    );
    const recentByKey = new Map(recentRuns.map((r) => [r.accountKey, r]));
    const contactsByKey = new Map(contactsByAccount.map((c) => [c.accountKey, c]));

    const accounts: AccountHealth[] = accountKeys.map((key) => {
      const lastRunAt = lastRunByKey.get(key) ?? null;
      const recent = recentByKey.get(key);
      const contacts = contactsByKey.get(key);

      const hoursSinceLastRun = lastRunAt ? hoursBetween(lastRunAt, now) : null;
      const status: AccountStatus = !lastRunAt
        ? 'never-synced'
        : hoursSinceLastRun !== null && hoursSinceLastRun > maxAgeHours
          ? 'stale'
          : 'ok';

      return {
        accountKey: key,
        dealer: dealerByKey.get(key) ?? null,
        status,
        lastRunAt: lastRunAt?.toISOString() ?? null,
        hoursSinceLastRun,
        lastContactsRunAt: lastRunByKeyKind.get(`${key}:contacts`)?.toISOString() ?? null,
        lastEventsRunAt: lastRunByKeyKind.get(`${key}:events`)?.toISOString() ?? null,
        contactCount: contacts?._count._all ?? 0,
        lastContactUpdateAt: contacts?._max.updatedAt?.toISOString() ?? null,
        last24h: {
          runs: recent?._count._all ?? 0,
          rows: recent?._sum.totalRows ?? 0,
          created: recent?._sum.created ?? 0,
          updated: recent?._sum.updated ?? 0,
          issues: recent?._sum.issueCount ?? 0,
        },
      };
    });

    const stale = accounts.filter((a) => a.status === 'stale');
    const neverSynced = accounts.filter((a) => a.status === 'never-synced');

    // `never-synced` is a WARNING, not a failure. Several YAG accounts are
    // parent/holding entities with no rooftop CRM feed of their own
    // (youngAutomotiveGroup, youngCollisionCenter, youngCommercialFleet,
    // youngPowersports) — the bridge skips the POST when a dealer has no rows
    // in the window, so they legitimately never produce a heartbeat. Failing
    // on them would mean a false alarm every single day, which is how a
    // monitor gets muted and stops being a monitor.
    //
    // A pipeline that has NEVER run anywhere is still a failure — that's the
    // runsAllTime check, which catches "the cron was never installed" without
    // needing per-account noise.
    const healthy = accounts.length > 0 && stale.length === 0 && runsAllTime > 0;

    // Self-maintaining retention. Cheap (indexed on startedAt) and keeps this
    // append-only log from needing a separate cron of its own.
    let pruned = 0;
    if (retentionDays > 0) {
      const cutoff = new Date(now.getTime() - retentionDays * 24 * 3_600_000);
      const { count } = await prisma.ingestRun.deleteMany({
        where: { startedAt: { lt: cutoff } },
      });
      pruned = count;
    }

    return NextResponse.json({
      checkedAt: now.toISOString(),
      maxAgeHours,
      healthy,
      accountsChecked: accounts.length,
      ignored,
      runsAllTime,
      staleCount: stale.length,
      neverSyncedCount: neverSynced.length,
      totals24h: {
        runs: accounts.reduce((sum, a) => sum + a.last24h.runs, 0),
        rows: accounts.reduce((sum, a) => sum + a.last24h.rows, 0),
        created: accounts.reduce((sum, a) => sum + a.last24h.created, 0),
        updated: accounts.reduce((sum, a) => sum + a.last24h.updated, 0),
        issues: accounts.reduce((sum, a) => sum + a.last24h.issues, 0),
      },
      // problems = the failing set. warnings = accounts that have simply never
      // pushed, which is expected for feed-less parent accounts.
      problems: stale.map((a) => ({
        accountKey: a.accountKey,
        dealer: a.dealer,
        status: a.status,
        hoursSinceLastRun: a.hoursSinceLastRun,
        contactCount: a.contactCount,
      })),
      warnings: neverSynced.map((a) => ({
        accountKey: a.accountKey,
        dealer: a.dealer,
        status: a.status,
        contactCount: a.contactCount,
      })),
      accounts,
      pruned,
    });
  } catch (err) {
    console.error('[contact-sync:health] check failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Health check failed' },
      { status: 500 },
    );
  }
}
