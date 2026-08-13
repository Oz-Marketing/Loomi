import { prisma } from '@/lib/prisma';
import { createNotification } from '@/lib/notifications/service';
import {
  RIGHTS_WARN_DAYS,
  assessRights,
  dueWarning,
  governingExpiry,
} from '@/lib/media-rights';

/**
 * Rights expiration sweep — Phase 3 of docs/asset-management.md (§6.2).
 *
 * Two jobs, deliberately separate:
 *
 *  • RETIRE — an asset whose governing date has passed gets `expiredAt` and the
 *    reason stamped on it. This is the auditable half: after the fact, someone
 *    has to be able to tell a lapsed licence from an ended campaign.
 *
 *  • WARN — 30 days out, then 7. One notification per band, not per day, or it
 *    becomes noise people filter and the warning stops working.
 *
 * What it deliberately does NOT do is block. §6.2 describes a hard block after
 * the grace period, but nothing consumes asset rights yet — the launch gate that
 * would enforce it arrives with the Go-to-Market work. Building a block with no
 * caller would be untested code sitting in the path of every future launch, so
 * the sweep flags and records, and enforcement lands with its consumer.
 *
 * Reuses expire-ads.ts's shape: same notification service, same
 * warn-don't-throw posture, same "a no-op sweep is still a successful sweep".
 *
 * Server-only.
 */

export interface MediaExpirationResult {
  /** Assets newly marked expired. */
  expired: {
    id: string;
    accountKey: string | null;
    oem: string | null;
    filename: string;
    reason: string;
    expiredAt: string;
  }[];
  /** Assets warned this run, by threshold. */
  warned: { id: string; filename: string; accountKey: string | null; days: number }[];
  /** Rows examined — separates "nothing due" from "the sweep didn't run". */
  scanned: number;
}

/** The columns the sweep reads. Narrow on purpose: this scans every account. */
const SELECT = {
  id: true,
  accountKey: true,
  oem: true,
  filename: true,
  licenseExpiresAt: true,
  expiresAt: true,
  expiredAt: true,
  expirationReason: true,
  expirationWarnedAt: true,
} as const;

/**
 * Sweep media rights.
 *
 * `accountKey` narrows it for an on-demand run; omit for the scheduled sweep.
 * Archived assets are skipped — they're already out of circulation, and expiring
 * them would fire notifications about creative nobody can reach.
 */
export async function sweepMediaExpiration(
  accountKey?: string,
  now = new Date(),
): Promise<MediaExpirationResult> {
  const result: MediaExpirationResult = { expired: [], warned: [], scanned: 0 };

  // Only rows that carry at least one date can do anything. The widest warning
  // threshold bounds the lookahead, so this stays a narrow index scan rather
  // than a full table read as the library grows.
  const horizon = new Date(now.getTime() + RIGHTS_WARN_DAYS[0] * 24 * 60 * 60 * 1000);

  let rows: {
    id: string;
    accountKey: string | null;
    oem: string | null;
    filename: string;
    licenseExpiresAt: Date | null;
    expiresAt: Date | null;
    expiredAt: Date | null;
    expirationReason: string | null;
    expirationWarnedAt: Date | null;
  }[] = [];

  try {
    rows = await prisma.mediaAsset.findMany({
      where: {
        archivedAt: null,
        ...(accountKey ? { accountKey } : {}),
        OR: [
          { licenseExpiresAt: { not: null, lte: horizon } },
          { expiresAt: { not: null, lte: horizon } },
        ],
      },
      select: SELECT,
    });
  } catch (err) {
    // Same posture as the rest of the DAM work: an environment that hasn't taken
    // the migration yet degrades to a no-op instead of crashing the worker.
    console.warn('[media-expiration] lookup failed:', err);
    return result;
  }

  result.scanned = rows.length;

  for (const row of rows) {
    const assessment = assessRights(row, now);

    // ── Retire ──
    if (
      (assessment.status === 'expired' || assessment.status === 'lapsed')
      && !row.expiredAt
    ) {
      const { date, reason } = governingExpiry(row);
      if (!date || !reason) continue;
      try {
        await prisma.mediaAsset.update({
          where: { id: row.id },
          data: { expiredAt: date, expirationReason: reason },
        });
        result.expired.push({
          id: row.id,
          accountKey: row.accountKey,
          oem: row.oem,
          filename: row.filename,
          reason,
          expiredAt: date.toISOString(),
        });
      } catch (err) {
        console.warn(`[media-expiration] could not expire ${row.id}:`, err);
      }
      continue;
    }

    // ── Warn ──
    const band = dueWarning(assessment, row.expirationWarnedAt, now);
    if (band === null) continue;
    try {
      await prisma.mediaAsset.update({
        where: { id: row.id },
        data: { expirationWarnedAt: now },
      });
      result.warned.push({
        id: row.id,
        filename: row.filename,
        accountKey: row.accountKey,
        days: assessment.daysRemaining ?? band,
      });
    } catch (err) {
      console.warn(`[media-expiration] could not stamp warning on ${row.id}:`, err);
    }
  }

  await notifyRightsEvents(result);
  return result;
}

/**
 * Who hears about it.
 *
 * OEM- and globally-scoped assets have no account rep, so they go to admins —
 * they're also the ones that matter most, because a lapsed OEM licence affects
 * every rooftop carrying the brand at once.
 */
async function recipientsFor(accountKey: string | null): Promise<string[]> {
  try {
    if (accountKey) {
      const account = await prisma.account.findUnique({
        where: { key: accountKey },
        select: { accountRepId: true },
      });
      if (account?.accountRepId) return [account.accountRepId];
    }
    const admins = await prisma.user.findMany({
      where: { role: { in: ['developer', 'super_admin', 'admin'] } },
      select: { id: true },
      take: 5,
    });
    return admins.map((a) => a.id);
  } catch {
    return [];
  }
}

function describe(items: { filename: string }[]): string {
  const names = items.slice(0, 3).map((i) => i.filename).join('; ');
  return items.length > 3 ? `${names} and ${items.length - 3} more` : names;
}

async function notifyRightsEvents(result: MediaExpirationResult): Promise<void> {
  // Group by scope so one rooftop's rep isn't told about another's assets.
  const buckets = new Map<
    string | null,
    { expired: typeof result.expired; warned: typeof result.warned }
  >();
  const bucket = (key: string | null) => {
    if (!buckets.has(key)) buckets.set(key, { expired: [], warned: [] });
    return buckets.get(key)!;
  };
  for (const e of result.expired) bucket(e.accountKey).expired.push(e);
  for (const w of result.warned) bucket(w.accountKey).warned.push(w);

  const day = new Date().toISOString().slice(0, 10);

  for (const [key, items] of buckets) {
    if (items.expired.length === 0 && items.warned.length === 0) continue;
    const recipients = await recipientsFor(key);

    for (const userId of recipients) {
      // Expiry is the louder event and gets its own notification: an asset that
      // has gone out of licence is a different conversation from one that will.
      if (items.expired.length > 0) {
        try {
          await createNotification({
            userId,
            type: 'asset_rights_expired',
            severity: 'warning',
            title: `${items.expired.length} asset(s) out of licence`,
            body: `${describe(items.expired)}. Rights or effective date has passed — replace before reuse.`,
            link: '/media',
            meta: { accountKey: key, expired: items.expired.length },
            dedupeKey: `media-expired:${key ?? 'shared'}:${day}`,
            dedupeWindowHours: 20,
          });
        } catch (err) {
          console.warn('[media-expiration] expiry notification failed:', err);
        }
      }

      if (items.warned.length > 0) {
        try {
          const soonest = Math.min(...items.warned.map((w) => w.days));
          await createNotification({
            userId,
            type: 'asset_rights_expiring',
            severity: 'info',
            title: `${items.warned.length} asset licence(s) expiring`,
            body: `${describe(items.warned)}. Soonest in ${soonest} day${soonest === 1 ? '' : 's'}.`,
            link: '/media',
            meta: { accountKey: key, warned: items.warned.length },
            dedupeKey: `media-expiring:${key ?? 'shared'}:${day}`,
            dedupeWindowHours: 20,
          });
        } catch (err) {
          console.warn('[media-expiration] warning notification failed:', err);
        }
      }
    }
  }
}
