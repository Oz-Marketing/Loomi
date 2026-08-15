/**
 * Service Retention — port of Oz Dealer Tools' ServiceRetentionReport
 * (`OzReportsData::getSalesToServiceRetention` / `getServiceRepeatRetention` /
 * `buildServiceRetentionSummary`).
 *
 * Reads local Postgres, not a vendor API — same architecture note as
 * dealer-trends.ts, which this sits beside.
 *
 * Two independent metrics:
 *   A. Sales → service. Of the people who bought, how many came back for
 *      service, within 12 months / 24 months / ever. Cohorted by purchase year.
 *   B. Service-only repeat. Of the people who service here but have never
 *      bought here, how many came back a second time within 12 months.
 *      Cohorted by first-visit year.
 *
 * ── IDENTITY ────────────────────────────────────────────────────────────────
 * ODT keyed on `custno` (the DMS customer number) scoped by dealer code. Loomi
 * has no custno; the equivalent is `ContactEvent.contactId`. That is resolved
 * at ingest by (accountKey, email) then (accountKey, phone) — see
 * lib/contacts/ingest-events.ts — so an event with neither, or one that landed
 * before its Contact existed, carries a NULL contactId.
 *
 * Unlinked events CANNOT participate: with no identity there is no way to tell
 * that a sale and a service visit are the same person. They are excluded, which
 * biases every rate DOWNWARD. `getLinkageCoverage` measures how much of the
 * account's history is linked so the UI can qualify the numbers — do not ship a
 * retention rate without showing it.
 *
 * Coverage self-heals: the Sunday `?all=1` sweep re-pushes full history and the
 * ingest re-resolves contactId on the update path, so events that arrived
 * before their contact get linked on the next sweep.
 *
 * ── DELIBERATE DEVIATION FROM ODT ───────────────────────────────────────────
 * ODT's Metric A documents "a customer is retained if they have at least one
 * service visit AFTER their purchase date", but its SQL joins the customer's
 * GLOBAL first service visit (`MIN(date)` over all time) and then tests that it
 * falls 1–365 days after the sale. For a repeat buyer whose first-ever service
 * predates a later purchase, that difference is negative, so they are dropped
 * from retained_12m, retained_24m AND retained_ever — even though they plainly
 * serviced after that purchase.
 *
 * This implements the DOCUMENTED definition: the first service visit *after
 * that sale*. Repeat buyers are therefore counted, and rates here read HIGHER
 * than ODT's for any dealer with meaningful repeat business. That is a fix, not
 * a drift — but it does mean the two reports will not tie out.
 */
import { prisma } from '@/lib/prisma';

/** Cohorts older than this are not charted. Matches ODT's 5-year window. */
const COHORT_YEARS = 5;
const DAYS_12M = 365;
const DAYS_24M = 730;
/** ODT's month approximation — average days per month. */
const DAYS_PER_MONTH = 30.44;

const round1 = (n: number) => Math.round(n * 10) / 10;
const rate = (num: number, den: number) => (den > 0 ? round1((num / den) * 100) : null);

// ── Metric A: sales → service ──

/** Raw per-cohort counts, before maturity and rate logic. */
export interface SalesCohortRow {
  cohort_year: number;
  total_sold: number;
  retained_12m: number;
  retained_24m: number;
  retained_ever: number;
}

export interface SalesCohort {
  cohortYear: number;
  totalSold: number;
  retained12m: number;
  retained24m: number;
  retainedEver: number;
  /** Null until the cohort's window has closed — see `mature12m` / `mature24m`. */
  rate12m: number | null;
  rate24m: number | null;
  rateEver: number | null;
  monthsOld: number;
  mature12m: boolean;
  mature24m: boolean;
}

/**
 * Attach maturity and rates to raw cohort counts.
 *
 * Maturity is measured from JANUARY 1 of the cohort year, following ODT. That
 * is an approximation in the cohort's favour: a December buyer in a cohort
 * declared "12-month mature" has only had a few months to come back, so the
 * most recent mature cohort reads slightly low. The alternative — waiting until
 * every member's window has closed — costs a full extra year of reporting, so
 * ODT's convention is kept.
 */
export function foldSalesCohorts(rows: SalesCohortRow[], now: Date): SalesCohort[] {
  return rows
    .map((r) => {
      const cohortYear = Number(r.cohort_year);
      const totalSold = Number(r.total_sold) || 0;
      const retained12m = Number(r.retained_12m) || 0;
      const retained24m = Number(r.retained_24m) || 0;
      const retainedEver = Number(r.retained_ever) || 0;

      const yearStart = Date.UTC(cohortYear, 0, 1);
      const monthsOld = Math.max(
        0,
        Math.floor((now.getTime() - yearStart) / 86_400_000 / DAYS_PER_MONTH),
      );
      const mature12m = monthsOld >= 12;
      const mature24m = monthsOld >= 24;

      return {
        cohortYear,
        totalSold,
        retained12m,
        retained24m,
        retainedEver,
        // An immature window reports null, not a low number. A 2026 cohort
        // showing "8%" would read as terrible retention rather than as a
        // year that hasn't finished happening yet.
        rate12m: mature12m ? rate(retained12m, totalSold) : null,
        rate24m: mature24m ? rate(retained24m, totalSold) : null,
        rateEver: rate(retainedEver, totalSold),
        monthsOld,
        mature12m,
        mature24m,
      };
    })
    .sort((a, b) => b.cohortYear - a.cohortYear);
}

// ── Metric B: service-only repeat ──

export interface ServiceCohortRow {
  first_visit_year: number;
  total_first_timers: number;
  returned_12m: number;
}

export interface ServiceCohort {
  firstVisitYear: number;
  totalFirstTimers: number;
  returned12m: number;
  lost12m: number;
  rate12m: number | null;
}

export function foldServiceCohorts(rows: ServiceCohortRow[]): ServiceCohort[] {
  return rows
    .map((r) => {
      const totalFirstTimers = Number(r.total_first_timers) || 0;
      const returned12m = Number(r.returned_12m) || 0;
      return {
        firstVisitYear: Number(r.first_visit_year),
        totalFirstTimers,
        returned12m,
        lost12m: totalFirstTimers - returned12m,
        rate12m: rate(returned12m, totalFirstTimers),
      };
    })
    .sort((a, b) => b.firstVisitYear - a.firstVisitYear);
}

// ── Blended summary ──

export interface RetentionSummary {
  salesTotal: number;
  salesTotal24m: number;
  salesTotalAll: number;
  salesRetained12m: number;
  salesRetained24m: number;
  salesRetainedEver: number;
  salesRate12m: number | null;
  salesRate24m: number | null;
  salesRateEver: number | null;
  svcTotal: number;
  svcRetained12m: number;
  svcRate12m: number | null;
}

/**
 * Headline rates across cohorts.
 *
 * The 12- and 24-month rates use SEPARATE denominators — each counts only the
 * cohorts whose window has actually closed. Sharing one denominator would put
 * (say) 2025 buyers into the 24-month denominator while they can contribute
 * nothing to its numerator, dragging the rate down for a reason that has
 * nothing to do with retention. `rateEver` has no such problem and uses every
 * cohort. Ported from ODT's `buildServiceRetentionSummary`, whose comment makes
 * the same point.
 */
export function buildRetentionSummary(
  salesCohorts: SalesCohort[],
  serviceCohorts: ServiceCohort[],
): RetentionSummary {
  let salesTotal = 0;
  let salesTotal24m = 0;
  let salesRetained12m = 0;
  let salesRetained24m = 0;
  let salesRetainedEver = 0;
  let salesTotalAll = 0;

  for (const c of salesCohorts) {
    if (c.mature12m) {
      salesTotal += c.totalSold;
      salesRetained12m += c.retained12m;
    }
    if (c.mature24m) {
      salesTotal24m += c.totalSold;
      salesRetained24m += c.retained24m;
    }
    salesRetainedEver += c.retainedEver;
    salesTotalAll += c.totalSold;
  }

  let svcTotal = 0;
  let svcRetained12m = 0;
  for (const c of serviceCohorts) {
    svcTotal += c.totalFirstTimers;
    svcRetained12m += c.returned12m;
  }

  return {
    salesTotal,
    salesTotal24m,
    salesTotalAll,
    salesRetained12m,
    salesRetained24m,
    salesRetainedEver,
    salesRate12m: rate(salesRetained12m, salesTotal),
    salesRate24m: rate(salesRetained24m, salesTotal24m),
    salesRateEver: rate(salesRetainedEver, salesTotalAll),
    svcTotal,
    svcRetained12m,
    svcRate12m: rate(svcRetained12m, svcTotal),
  };
}

// ── Linkage coverage ──

export interface LinkageCoverage {
  saleEvents: number;
  saleEventsLinked: number;
  serviceEvents: number;
  serviceEventsLinked: number;
  /** Linked share of all sale + service events, 0–1. */
  overall: number;
}

export function foldCoverage(rows: { type: string; total: number; linked: number }[]): LinkageCoverage {
  const pick = (t: string) => rows.find((r) => r.type === t);
  const sale = pick('sale');
  const service = pick('service');

  const saleEvents = Number(sale?.total) || 0;
  const saleEventsLinked = Number(sale?.linked) || 0;
  const serviceEvents = Number(service?.total) || 0;
  const serviceEventsLinked = Number(service?.linked) || 0;

  const total = saleEvents + serviceEvents;
  return {
    saleEvents,
    saleEventsLinked,
    serviceEvents,
    serviceEventsLinked,
    overall: total > 0 ? (saleEventsLinked + serviceEventsLinked) / total : 0,
  };
}

// ── Queries ──

function cohortFloor(now: Date): Date {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - COHORT_YEARS);
  return d;
}

/**
 * Metric A. Cohort membership is one row per (contact, purchase year), keyed on
 * that year's EARLIEST sale, so buying twice in one year is one cohort member —
 * matching ODT's `COUNT(DISTINCT custno)`. Buying in two different years puts
 * the customer in both cohorts, also matching ODT.
 */
async function querySalesCohorts(accountKey: string, now: Date): Promise<SalesCohortRow[]> {
  const floor = cohortFloor(now);

  return prisma.$queryRaw<SalesCohortRow[]>`
    WITH cohort_members AS (
      SELECT
        "contactId",
        extract(year FROM "eventDate")::int AS cohort_year,
        min("eventDate")                    AS sale_date
      FROM "ContactEvent"
      WHERE "accountKey" = ${accountKey}
        AND "type" = 'sale'
        AND "contactId" IS NOT NULL
        AND "eventDate" >= ${floor}
      GROUP BY 1, 2
    ),
    with_first_service AS (
      SELECT
        cm.cohort_year,
        cm.sale_date,
        (
          SELECT min(sv."eventDate")
          FROM "ContactEvent" sv
          WHERE sv."contactId"  = cm."contactId"
            AND sv."accountKey" = ${accountKey}
            AND sv."type"       = 'service'
            AND sv."eventDate"  > cm.sale_date
        ) AS first_svc
      FROM cohort_members cm
    )
    SELECT
      cohort_year,
      count(*)::int AS total_sold,
      count(*) FILTER (
        WHERE first_svc IS NOT NULL
          AND first_svc <= sale_date + (${DAYS_12M} || ' days')::interval
      )::int AS retained_12m,
      count(*) FILTER (
        WHERE first_svc IS NOT NULL
          AND first_svc <= sale_date + (${DAYS_24M} || ' days')::interval
      )::int AS retained_24m,
      count(*) FILTER (WHERE first_svc IS NOT NULL)::int AS retained_ever
    FROM with_first_service
    GROUP BY 1
    ORDER BY 1 DESC
  `;
}

/**
 * Metric B. "Service-only" excludes anyone with ANY sale at this account, ever
 * — not just within the cohort window — so a 2015 buyer never appears here.
 * Cohorts whose 12-month window is still open are excluded outright (ODT does
 * the same), because a half-finished cohort can only ever read low.
 */
async function queryServiceCohorts(accountKey: string, now: Date): Promise<ServiceCohortRow[]> {
  const floor = cohortFloor(now);
  const matureCutoff = new Date(now);
  matureCutoff.setUTCFullYear(matureCutoff.getUTCFullYear() - 1);

  return prisma.$queryRaw<ServiceCohortRow[]>`
    WITH first_visits AS (
      SELECT "contactId", min("eventDate") AS first_visit
      FROM "ContactEvent"
      WHERE "accountKey" = ${accountKey}
        AND "type" = 'service'
        AND "contactId" IS NOT NULL
        AND "eventDate" >= ${floor}
      GROUP BY 1
    ),
    buyers AS (
      SELECT DISTINCT "contactId"
      FROM "ContactEvent"
      WHERE "accountKey" = ${accountKey}
        AND "type" = 'sale'
        AND "contactId" IS NOT NULL
    ),
    first_timers AS (
      SELECT fv."contactId", fv.first_visit
      FROM first_visits fv
      LEFT JOIN buyers b ON b."contactId" = fv."contactId"
      WHERE b."contactId" IS NULL
        AND fv.first_visit <= ${matureCutoff}
    )
    SELECT
      extract(year FROM ft.first_visit)::int AS first_visit_year,
      count(*)::int                          AS total_first_timers,
      count(r.hit)::int                      AS returned_12m
    FROM first_timers ft
    LEFT JOIN LATERAL (
      SELECT 1 AS hit
      FROM "ContactEvent" r
      WHERE r."contactId"  = ft."contactId"
        AND r."accountKey" = ${accountKey}
        AND r."type"       = 'service'
        AND r."eventDate"  > ft.first_visit
        AND r."eventDate" <= ft.first_visit + (${DAYS_12M} || ' days')::interval
      LIMIT 1
    ) r ON true
    GROUP BY 1
    ORDER BY 1 DESC
  `;
}

async function queryCoverage(accountKey: string) {
  return prisma.$queryRaw<{ type: string; total: number; linked: number }[]>`
    SELECT
      "type",
      count(*)::int                                        AS total,
      count(*) FILTER (WHERE "contactId" IS NOT NULL)::int AS linked
    FROM "ContactEvent"
    WHERE "accountKey" = ${accountKey}
      AND "type" IN ('sale', 'service')
    GROUP BY 1
  `;
}

export async function getServiceRetention(accountKey: string, now: Date = new Date()) {
  const [salesRows, serviceRows, coverageRows] = await Promise.all([
    querySalesCohorts(accountKey, now),
    queryServiceCohorts(accountKey, now),
    queryCoverage(accountKey),
  ]);

  const salesCohorts = foldSalesCohorts(salesRows, now);
  const serviceCohorts = foldServiceCohorts(serviceRows);

  return {
    salesCohorts,
    serviceCohorts,
    summary: buildRetentionSummary(salesCohorts, serviceCohorts),
    coverage: foldCoverage(coverageRows),
  };
}
