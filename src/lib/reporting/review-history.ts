/**
 * Review history — the half of the Reputation report that Google Places cannot
 * answer. Port of Oz Dealer Tools' `OzReputation::getReviewStats`.
 *
 * ── WHY THIS IS A TABLE AND NOT AN API CALL ─────────────────────────────────
 * The existing Reputation report reads Places live: current rating, and the
 * handful of reviews Google chooses to return. Places has no history — no
 * "reviews in March", no star distribution across a range, and no idea whether
 * anyone replied. Those three are exactly what a dealer's reputation *trend*
 * is made of, and none can be reconstructed later: a review not recorded today
 * is gone from the API's window tomorrow.
 *
 * So `ReviewEvent` accumulates, and the two sources answer different
 * questions. The live rating stays authoritative for "what does our listing
 * say right now"; this is authoritative for "what happened over time". Where
 * they disagree — and they will, because Places averages every review ever
 * while a ranged query does not — the UI says which is which.
 *
 * ── THE REPLY RATE IS THE POINT ─────────────────────────────────────────────
 * Of the three, reply rate is the one nobody else can produce and the one a
 * store can actually act on this week. It is a share of reviews IN THE RANGE
 * that have a reply — not of all reviews ever — so a store that cleared its
 * backlog last month doesn't get to keep claiming the credit this month.
 */
import { prisma } from '@/lib/prisma';

export interface StarDistribution {
  stars: number;
  reviews: number;
  share: number;
}

export interface ReviewMonth {
  period: string;
  label: string;
  reviews: number;
  /** Mean stars for the month. Null when the month had none. */
  average: number | null;
  replied: number;
}

export interface ReviewStats {
  reviews: number;
  /** Mean stars across the range. Null when there were none. */
  average: number | null;
  replied: number;
  /** Share of in-range reviews with a reply, 0–100. Null when none. */
  replyRate: number | null;
  distribution: StarDistribution[];
  months: ReviewMonth[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

function monthLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Always five rows, 5 stars down to 1, zeros included.
 *
 * A sparse distribution would omit the star rating nobody gave — and "no
 * 1-star reviews" is one of the more useful things this chart can show, so it
 * must be a visible empty bar rather than a missing one.
 */
export function foldDistribution(rows: { stars: number; reviews: number }[]): StarDistribution[] {
  const byStar = new Map(rows.map((r) => [Number(r.stars), num(r.reviews)]));
  const total = [...byStar.values()].reduce((a, b) => a + b, 0);
  return [5, 4, 3, 2, 1].map((stars) => {
    const reviews = byStar.get(stars) ?? 0;
    return { stars, reviews, share: total > 0 ? reviews / total : 0 };
  });
}

export function foldMonths(
  rows: { period: string; reviews: number; starsSum: number; replied: number }[],
): ReviewMonth[] {
  return rows
    .map((r) => {
      const reviews = num(r.reviews);
      return {
        period: r.period,
        label: monthLabel(r.period),
        reviews,
        // Averaged from the summed stars, not from a mean of monthly means.
        average: reviews > 0 ? round2(num(r.starsSum) / reviews) : null,
        replied: num(r.replied),
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));
}

/** Totals derived from the distribution, so the two can never disagree. */
export function summarize(
  distribution: StarDistribution[],
  replied: number,
): Omit<ReviewStats, 'distribution' | 'months'> {
  const reviews = distribution.reduce((n, d) => n + d.reviews, 0);
  const starsSum = distribution.reduce((n, d) => n + d.stars * d.reviews, 0);
  return {
    reviews,
    average: reviews > 0 ? round2(starsSum / reviews) : null,
    replied,
    // Null, not 0 — "we replied to none of zero reviews" is not a fact.
    replyRate: reviews > 0 ? round1((replied / reviews) * 100) : null,
  };
}

function bounds(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`);
  const endExclusive = new Date(`${to}T00:00:00Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { start, endExclusive };
}

/**
 * Range stats plus a trailing monthly trend.
 *
 * The trend deliberately ignores `from`/`to` and always walks the last
 * `trendMonths` months: a trend that reshapes itself every time someone
 * narrows the date filter isn't a trend, and the range stats above it already
 * answer the filtered question.
 */
export async function getReviewHistory(
  accountKey: string,
  from: string,
  to: string,
  trendMonths = 12,
): Promise<ReviewStats> {
  const { start, endExclusive } = bounds(from, to);

  const trendStart = new Date(endExclusive);
  trendStart.setUTCMonth(trendStart.getUTCMonth() - trendMonths);
  trendStart.setUTCDate(1);

  const [distRows, repliedRow, monthRows] = await Promise.all([
    prisma.$queryRaw<{ stars: number; reviews: number }[]>`
      SELECT "stars", count(*)::int AS reviews
      FROM "ReviewEvent"
      WHERE "accountKey" = ${accountKey}
        AND "publishedAt" >= ${start} AND "publishedAt" < ${endExclusive}
      GROUP BY 1
    `,
    prisma.reviewEvent.count({
      where: {
        accountKey,
        replied: true,
        publishedAt: { gte: start, lt: endExclusive },
      },
    }),
    prisma.$queryRaw<{ period: string; reviews: number; starsSum: number; replied: number }[]>`
      SELECT
        to_char(date_trunc('month', "publishedAt"), 'YYYY-MM') AS period,
        count(*)::int                                          AS reviews,
        coalesce(sum("stars"), 0)::int                         AS "starsSum",
        count(*) FILTER (WHERE "replied")::int                 AS replied
      FROM "ReviewEvent"
      WHERE "accountKey" = ${accountKey}
        AND "publishedAt" >= ${trendStart} AND "publishedAt" < ${endExclusive}
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  const distribution = foldDistribution(distRows);
  const months = foldMonths(monthRows);

  return { ...summarize(distribution, repliedRow), distribution, months };
}

/** How far back the history goes — the UI needs it to caveat early months. */
export async function getHistoryCoverage(accountKey: string) {
  const row = await prisma.reviewEvent.aggregate({
    where: { accountKey },
    _min: { publishedAt: true },
    _count: { _all: true },
  });
  return {
    reviews: row._count._all,
    earliest: row._min.publishedAt ? row._min.publishedAt.toISOString().slice(0, 10) : null,
  };
}
