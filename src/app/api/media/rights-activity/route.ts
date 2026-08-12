import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { RIGHTS_WARN_DAYS, assessRights } from '@/lib/media-rights';

/**
 * GET /api/media/rights-activity
 *
 * The rights sweep's job history, plus what it found that still needs a person.
 *
 * Two halves on purpose. The run history answers "is this job alive?" — a
 * heartbeat nobody looks at is only marginally better than no heartbeat. The
 * attention list answers "so what?", which is the reason anyone opens the page.
 *
 * Admin-only: it spans every account.
 */

/**
 * How long before silence is suspicious.
 *
 * The sweep is scheduled daily, so a day and a half of nothing means it missed a
 * run. Deliberately not 24h — a deploy that shifts the cron by an hour must not
 * light up a warning.
 */
const STALE_AFTER_HOURS = 36;

export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { role, accountKeys = [] } = session!.user;
  const unrestricted =
    role === 'developer' || role === 'super_admin' || (role === 'admin' && accountKeys.length === 0);
  if (!unrestricted) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const now = new Date();

  // Wrapped: an environment that hasn't taken the migration yet should render an
  // empty panel rather than a 500 — same posture as the sweep itself.
  const runs = await prisma.mediaSweepRun
    .findMany({ orderBy: { startedAt: 'desc' }, take: 20 })
    .catch(() => []);

  const horizon = new Date(now.getTime() + RIGHTS_WARN_DAYS[0] * 24 * 60 * 60 * 1000);
  const dated = await prisma.mediaAsset
    .findMany({
      where: {
        archivedAt: null,
        OR: [
          { licenseExpiresAt: { not: null, lte: horizon } },
          { expiresAt: { not: null, lte: horizon } },
        ],
      },
      select: {
        id: true,
        filename: true,
        accountKey: true,
        oem: true,
        status: true,
        licenseExpiresAt: true,
        expiresAt: true,
        expiredAt: true,
        expirationReason: true,
      },
      // Bounded: this is a review queue, not an export. The counts below come
      // from the same set, so a library with thousands of dated assets would
      // under-report — acceptable while it's this far from that, and the cap is
      // stated in the response so the UI can say so.
      take: 200,
      orderBy: { licenseExpiresAt: 'asc' },
    })
    .catch(() => []);

  const attention = dated
    .map((a) => ({ asset: a, rights: assessRights(a, now) }))
    .filter((r) => r.rights.status !== 'active' && r.rights.status !== 'unknown')
    .map((r) => ({
      id: r.asset.id,
      filename: r.asset.filename,
      accountKey: r.asset.accountKey,
      oem: r.asset.oem,
      status: r.asset.status,
      rightsStatus: r.rights.status,
      daysRemaining: r.rights.daysRemaining,
      reason: r.rights.reason,
      // An APPROVED asset that has lapsed is the urgent case: it is cleared for
      // use and shouldn't be. A lapsed draft is untidy; this is exposure.
      urgent:
        r.asset.status === 'approved'
        && (r.rights.status === 'expired' || r.rights.status === 'lapsed'),
    }));

  const lastRun = runs[0] ?? null;
  const hoursSince = lastRun
    ? (now.getTime() - new Date(lastRun.startedAt).getTime()) / 3_600_000
    : null;

  return NextResponse.json({
    health: {
      lastRunAt: lastRun ? new Date(lastRun.startedAt).toISOString() : null,
      lastRunError: lastRun?.error ?? null,
      hoursSinceLastRun: hoursSince === null ? null : Math.round(hoursSince * 10) / 10,
      // `never` is distinct from `stale`: a job that has never run may simply not
      // have been deployed yet, which is a different conversation from one that
      // stopped.
      state: !lastRun
        ? 'never'
        : lastRun.error
          ? 'error'
          : hoursSince !== null && hoursSince > STALE_AFTER_HOURS
            ? 'stale'
            : 'ok',
      staleAfterHours: STALE_AFTER_HOURS,
    },
    runs: runs.map((r) => ({
      id: r.id,
      accountKey: r.accountKey,
      startedAt: new Date(r.startedAt).toISOString(),
      finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
      scanned: r.scanned,
      expiredCount: r.expiredCount,
      warnedCount: r.warnedCount,
      error: r.error,
    })),
    attention,
    attentionTruncated: dated.length >= 200,
  });
}
