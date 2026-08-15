/**
 * Customer geography — port of Oz Dealer Tools' HeatmapReport
 * (`OzReportsData::getSalesByZipCode` / `getServiceByZipCode`).
 *
 * Aggregates sale or service events by the customer's postal code, for a date
 * range, with an optional deal-type filter on the sales side.
 *
 * Reads local Postgres, not a vendor API — same architecture note as
 * dealer-trends.ts and service-retention.ts, which this sits beside.
 *
 * ── WHERE THE ADDRESS COMES FROM, AND WHY IT DIFFERS FROM ODT ───────────────
 * ODT read zip/city/state off the DMS transaction row itself, so each sale was
 * attributed to the address the customer had AT THE TIME OF THAT SALE. Loomi
 * has no address on `ContactEvent`; it lives on `Contact` and is overwritten by
 * every contact sync. So a customer who moves takes their whole history with
 * them — all their past events re-attribute to their CURRENT postal code.
 *
 * For a trade-area map this is usually the more useful reading ("where do our
 * customers live now"), but it is NOT the same question ODT answered, and a
 * year-over-year comparison against ODT will not tie out for any dealer with
 * meaningful customer churn between ZIPs.
 *
 * ── PLACEMENT COVERAGE ──────────────────────────────────────────────────────
 * An event can only be placed on the map if it is linked to a Contact AND that
 * Contact has a postal code. Two independent ways to fall out:
 *
 *   unlinked  — `ContactEvent.contactId` is null (no email/phone to match on
 *               at ingest; see lib/contacts/ingest-events.ts)
 *   noPostal  — linked, but the Contact has no postalCode
 *
 * Both are reported by `getCustomerGeography` so the UI can say how much of the
 * business the map actually represents. A heatmap that silently drops a third
 * of the ROs is worse than no heatmap.
 */
import { prisma } from '@/lib/prisma';
import { classifySale, type SaleMix } from './dealer-trends';
import { lookupCentroid } from './zip-centroids';

export type GeographyMode = 'sales' | 'service';
export type DealTypeFilter = 'ALL' | 'NEW' | 'USED' | 'LEASE';

export const DEAL_TYPE_FILTERS: DealTypeFilter[] = ['ALL', 'NEW', 'USED', 'LEASE'];

/** Maps the UI filter onto the buckets `classifySale` produces. */
const FILTER_BUCKET: Record<Exclude<DealTypeFilter, 'ALL'>, SaleMix> = {
  NEW: 'new',
  USED: 'used',
  LEASE: 'lease',
};

/** One `GROUP BY postal_code, sale_type, deal_type` row, pre-classification. */
export interface ZipGroupRow {
  postal_code: string;
  city: string | null;
  state: string | null;
  sale_type: string;
  deal_type: string;
  count: number;
  revenue: number;
  /** Service only; zero on the sales side. */
  customer_pay: number;
  warranty_pay: number;
}

export interface ZipRow {
  postalCode: string;
  city: string | null;
  state: string | null;
  /** Units sold, or repair orders. */
  count: number;
  revenue: number;
  customerPay: number;
  warrantyPay: number;
  /** Share of the report's total count, 0–1. */
  share: number;
  /** Null when the Gazetteer has no such ZIP — see `attachCentroids`. */
  lat: number | null;
  lng: number | null;
}

/** ZIPs present in the data that the Gazetteer can't place on a map. */
export interface MappingCoverage {
  /** Distinct ZIPs with no centroid. */
  unmappedZips: number;
  /** Events sitting in those ZIPs. */
  unmappedCount: number;
}

export interface GeographyTotals {
  count: number;
  revenue: number;
  customerPay: number;
  warrantyPay: number;
  avgValue: number;
  zipCount: number;
}

export interface PlacementCoverage {
  events: number;
  placed: number;
  unlinked: number;
  noPostal: number;
  /** Placed share of all events in range, 0–1. */
  overall: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function bounds(from: string, to: string): { start: Date; endExclusive: Date } {
  const start = new Date(`${from}T00:00:00Z`);
  const endExclusive = new Date(`${to}T00:00:00Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { start, endExclusive };
}

/**
 * Classify, filter by deal type, and collapse to one row per postal code.
 *
 * Service rows carry empty type strings and are never filtered — `dealType` is
 * meaningless for a repair order, and passing 'LEASE' on the service side would
 * otherwise silently empty the map.
 */
export function foldZipRows(
  rows: ZipGroupRow[],
  mode: GeographyMode,
  dealType: DealTypeFilter,
): { zips: ZipRow[]; totals: GeographyTotals } {
  const keep =
    mode === 'service' || dealType === 'ALL'
      ? () => true
      : (r: ZipGroupRow) => classifySale(r.sale_type, r.deal_type) === FILTER_BUCKET[dealType];

  const byZip = new Map<string, ZipRow>();
  for (const r of rows) {
    if (!keep(r)) continue;
    const key = r.postal_code;
    const existing = byZip.get(key) ?? {
      postalCode: key,
      city: r.city,
      state: r.state,
      count: 0,
      revenue: 0,
      customerPay: 0,
      warrantyPay: 0,
      share: 0,
      lat: null,
      lng: null,
    };
    existing.count += Number(r.count) || 0;
    existing.revenue += Number(r.revenue) || 0;
    existing.customerPay += Number(r.customer_pay) || 0;
    existing.warrantyPay += Number(r.warranty_pay) || 0;
    byZip.set(key, existing);
  }

  const zips = [...byZip.values()].sort(
    (a, b) => b.count - a.count || a.postalCode.localeCompare(b.postalCode),
  );

  const count = zips.reduce((n, z) => n + z.count, 0);
  for (const z of zips) {
    z.revenue = round2(z.revenue);
    z.customerPay = round2(z.customerPay);
    z.warrantyPay = round2(z.warrantyPay);
    z.share = count > 0 ? z.count / count : 0;
  }

  const revenue = round2(zips.reduce((n, z) => n + z.revenue, 0));
  return {
    zips,
    totals: {
      count,
      revenue,
      customerPay: round2(zips.reduce((n, z) => n + z.customerPay, 0)),
      warrantyPay: round2(zips.reduce((n, z) => n + z.warrantyPay, 0)),
      avgValue: count > 0 ? round2(revenue / count) : 0,
      zipCount: zips.length,
    },
  };
}

export function foldPlacement(row?: {
  events: number;
  placed: number;
  unlinked: number;
  no_postal: number;
}): PlacementCoverage {
  const events = Number(row?.events) || 0;
  const placed = Number(row?.placed) || 0;
  return {
    events,
    placed,
    unlinked: Number(row?.unlinked) || 0,
    noPostal: Number(row?.no_postal) || 0,
    overall: events > 0 ? placed / events : 0,
  };
}

/**
 * Group by normalized postal code.
 *
 * ZIP+4 is collapsed to the 5-digit prefix — otherwise one household's
 * "84010-1234" and their neighbour's "84010-1235" become two map points. City
 * and state are taken as the most common value for the ZIP rather than grouped
 * on, so a single spelling variant ("St. George" vs "Saint George") doesn't
 * split a ZIP into two rows the way it does in ODT.
 */
async function queryZipGroups(
  accountKey: string,
  mode: GeographyMode,
  from: string,
  to: string,
): Promise<ZipGroupRow[]> {
  const { start, endExclusive } = bounds(from, to);
  const type = mode === 'sales' ? 'sale' : 'service';

  return prisma.$queryRaw<ZipGroupRow[]>`
    SELECT
      upper(split_part(trim(c."postalCode"), '-', 1))          AS postal_code,
      mode() WITHIN GROUP (ORDER BY c."city")                  AS city,
      mode() WITHIN GROUP (ORDER BY c."state")                 AS state,
      upper(coalesce(e.details->>'sale_type', ''))             AS sale_type,
      upper(coalesce(e.details->>'deal_type',
                     e.details->>'new_used', ''))              AS deal_type,
      count(*)::int                                            AS count,
      coalesce(sum(e."amount"), 0)::float8                     AS revenue,
      coalesce(sum(
        CASE WHEN e.details->>'customer_pay' ~ '^-?[0-9]+([.][0-9]+)?$'
          THEN (e.details->>'customer_pay')::numeric END
      ), 0)::float8                                            AS customer_pay,
      coalesce(sum(
        CASE WHEN e.details->>'warranty_pay' ~ '^-?[0-9]+([.][0-9]+)?$'
          THEN (e.details->>'warranty_pay')::numeric END
      ), 0)::float8                                            AS warranty_pay
    FROM "ContactEvent" e
    JOIN "Contact" c ON c."id" = e."contactId"
    WHERE e."accountKey" = ${accountKey}
      AND e."type" = ${type}
      AND e."eventDate" >= ${start}
      AND e."eventDate" <  ${endExclusive}
      AND c."postalCode" IS NOT NULL
      AND trim(c."postalCode") NOT IN ('', '\\N')
    GROUP BY 1, 4, 5
    ORDER BY 6 DESC
  `;
}

/** How much of the range's business can actually be placed on a map. */
async function queryPlacement(
  accountKey: string,
  mode: GeographyMode,
  from: string,
  to: string,
) {
  const { start, endExclusive } = bounds(from, to);
  const type = mode === 'sales' ? 'sale' : 'service';

  const rows = await prisma.$queryRaw<
    { events: number; placed: number; unlinked: number; no_postal: number }[]
  >`
    SELECT
      count(*)::int AS events,
      count(*) FILTER (
        WHERE c."id" IS NOT NULL
          AND c."postalCode" IS NOT NULL
          AND trim(c."postalCode") NOT IN ('', '\\N')
      )::int AS placed,
      count(*) FILTER (WHERE e."contactId" IS NULL)::int AS unlinked,
      count(*) FILTER (
        WHERE e."contactId" IS NOT NULL
          AND (c."postalCode" IS NULL OR trim(c."postalCode") IN ('', '\\N'))
      )::int AS no_postal
    FROM "ContactEvent" e
    LEFT JOIN "Contact" c ON c."id" = e."contactId"
    WHERE e."accountKey" = ${accountKey}
      AND e."type" = ${type}
      AND e."eventDate" >= ${start}
      AND e."eventDate" <  ${endExclusive}
  `;

  return rows[0];
}

/**
 * Fill in map coordinates, and report what couldn't be placed.
 *
 * A ZIP in the data with no Gazetteer entry is normally one of three things: a
 * Canadian or other non-US postal code, a PO-box-only ZIP that has no ZCTA
 * polygon, or a typo in the DMS. Those rows keep their place in every table and
 * total — they are real business — they simply can't be drawn, so the map
 * reports them separately rather than pretending the totals match.
 *
 * Kept separate from `foldZipRows` so that stays a pure function of its input,
 * and so the ~890KB centroid table is only ever pulled in on the server.
 */
export function attachCentroids(zips: ZipRow[]): MappingCoverage {
  let unmappedZips = 0;
  let unmappedCount = 0;

  for (const z of zips) {
    const hit = lookupCentroid(z.postalCode);
    if (hit) {
      z.lat = hit[0];
      z.lng = hit[1];
    } else {
      unmappedZips += 1;
      unmappedCount += z.count;
    }
  }

  return { unmappedZips, unmappedCount };
}

export async function getCustomerGeography(
  accountKey: string,
  mode: GeographyMode,
  from: string,
  to: string,
  dealType: DealTypeFilter = 'ALL',
) {
  const [groupRows, placementRow] = await Promise.all([
    queryZipGroups(accountKey, mode, from, to),
    queryPlacement(accountKey, mode, from, to),
  ]);

  const { zips, totals } = foldZipRows(groupRows, mode, dealType);
  const mapping = attachCentroids(zips);

  return { zips, totals, placement: foldPlacement(placementRow), mapping };
}
