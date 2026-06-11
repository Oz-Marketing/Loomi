/**
 * StackAdapt (OTT/CTV/display) reporting client — GraphQL over fetch.
 *
 * Port of Oz Dealer Tools' StackAdaptApi library. Read-only delivery pulls per
 * advertiser, used by the StackAdapt tab of the Ads report. Queries are copied
 * near-verbatim from the PHP (built against StackAdapt's live GraphQL schema);
 * derived metrics (ctr/cpc/cpm/cost-per-conversion) are recomputed from the raw
 * counts here exactly as the PHP did, rather than trusting the API's ecpc/ecpm,
 * so numbers stay in parity.
 *
 * Credentials: a single agency-wide GraphQL key in env (STACKADAPT_API_KEY).
 * Each sub-account stores only its advertiser id (Account.stackadaptAdvertiserId).
 * Margin markup lives in src/lib/reporting/margins.ts (same field set as Meta).
 */

import { prisma } from '@/lib/prisma';

const DEFAULT_GRAPHQL_URL = 'https://api.stackadapt.com/graphql';

export interface StackAdaptConfig {
  apiKey: string;
  graphqlUrl: string;
}

/** Reads the agency GraphQL key from env. null when not configured. */
export function getStackAdaptConfig(): StackAdaptConfig | null {
  const apiKey = process.env.STACKADAPT_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    graphqlUrl: process.env.STACKADAPT_GRAPHQL_URL?.trim() || DEFAULT_GRAPHQL_URL,
  };
}

export function isStackAdaptConfigured(): boolean {
  return getStackAdaptConfig() !== null;
}

export type StackAdaptErrorCode =
  | 'not_configured'
  | 'no_advertiser'
  | 'graphql_error';

export class StackAdaptError extends Error {
  code: StackAdaptErrorCode;
  /** Underlying HTTP status from the GraphQL endpoint, when relevant. */
  httpStatus?: number;
  constructor(message: string, code: StackAdaptErrorCode, httpStatus?: number) {
    super(message);
    this.name = 'StackAdaptError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message?: string }[];
}

/** POST a GraphQL query, returning `data`. Throws StackAdaptError on any failure. */
async function gql<T>(
  cfg: StackAdaptConfig,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(cfg.graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    throw new StackAdaptError(
      `Could not reach the StackAdapt API: ${err instanceof Error ? err.message : 'network error'}`,
      'graphql_error',
    );
  }

  const json = (await res.json().catch(() => null)) as GraphQLResponse<T> | null;
  if (res.status >= 400) {
    throw new StackAdaptError(
      `StackAdapt GraphQL error (HTTP ${res.status})`,
      'graphql_error',
      res.status,
    );
  }
  if (json?.errors?.length) {
    throw new StackAdaptError(
      `StackAdapt: ${json.errors[0]?.message || 'GraphQL error'}`,
      'graphql_error',
      res.status,
    );
  }
  return (json?.data ?? {}) as T;
}

// ── DeliveryStatsRecord field set (copied verbatim from the PHP fragment) ──
const METRICS_FRAGMENT = `
  impressionsBigint
  clicksBigint
  cost
  conversionsBigint
  uniqueImpressionsBigint
  ctr
  ecpc
  ecpm
  ecpa
  frequency
`;

interface RawStats {
  impressionsBigint?: string | number;
  clicksBigint?: string | number;
  cost?: string | number;
  conversionsBigint?: string | number;
  uniqueImpressionsBigint?: string | number;
  frequency?: string | number;
}

export interface StackAdaptMetrics {
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  spend: number;
  cpm: number;
  conversions: number;
  cost_per_conversion: number;
  unique_impressions: number;
  frequency: number;
}

export interface StackAdaptRow extends StackAdaptMetrics {
  id: string;
  name: string;
}

export interface StackAdaptDailyRow extends StackAdaptMetrics {
  date: string;
  label: string;
}

const intOf = (v: string | number | undefined) => Math.trunc(Number(v ?? 0)) || 0;
const floatOf = (v: string | number | undefined) => Number(v ?? 0) || 0;
/** PHP round($n, 2) — round half away from zero matches Math.round for >= 0 values. */
const round2 = (n: number) => Math.round(n * 100) / 100;

export const EMPTY_STACKADAPT_METRICS: StackAdaptMetrics = {
  impressions: 0,
  clicks: 0,
  ctr: 0,
  cpc: 0,
  spend: 0,
  cpm: 0,
  conversions: 0,
  cost_per_conversion: 0,
  unique_impressions: 0,
  frequency: 0,
};

/**
 * Normalize a DeliveryStatsRecord into our standard metric shape, recomputing
 * the rate/cost fields from raw counts (Oz parity — StackAdaptApi::normalizeStats).
 */
function normalizeStats(s: RawStats): StackAdaptMetrics {
  const impressions = intOf(s.impressionsBigint);
  const clicks = intOf(s.clicksBigint);
  const spend = floatOf(s.cost);
  const conversions = intOf(s.conversionsBigint);

  return {
    impressions,
    clicks,
    ctr: impressions > 0 ? round2((clicks / impressions) * 100) : 0,
    cpc: clicks > 0 ? round2(spend / clicks) : 0,
    spend: round2(spend),
    cpm: impressions > 0 ? round2((spend / impressions) * 1000) : 0,
    conversions,
    cost_per_conversion: conversions > 0 ? round2(spend / conversions) : 0,
    unique_impressions: intOf(s.uniqueImpressionsBigint),
    frequency: floatOf(s.frequency),
  };
}

/**
 * Resolves the agency key + this account's advertiser id, ready for GraphQL.
 * Throws a StackAdaptError the caller can map to a status.
 */
export async function getAdvertiserConfig(
  accountKey: string,
): Promise<{ cfg: StackAdaptConfig; advertiserId: string }> {
  const cfg = getStackAdaptConfig();
  if (!cfg) {
    throw new StackAdaptError(
      'StackAdapt is not connected (set STACKADAPT_API_KEY).',
      'not_configured',
    );
  }
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { stackadaptAdvertiserId: true },
  });
  const advertiserId = account?.stackadaptAdvertiserId?.trim();
  if (!advertiserId) {
    throw new StackAdaptError(
      "No StackAdapt advertiser is linked. Add it in the account's settings.",
      'no_advertiser',
    );
  }
  return { cfg, advertiserId };
}

// ── Delivery query response shapes ──

type CampaignNode = { campaign?: { id?: string; name?: string }; metrics?: RawStats };
type CampaignGroupNode = { campaignGroup?: { id?: string; name?: string }; metrics?: RawStats };
type AdNode = { ad?: { id?: string; name?: string }; metrics?: RawStats };
type DailyNode = { granularity?: { startTime?: string }; metrics?: RawStats };

/** Account-level totals over [from, to] (advertiserDelivery TOTAL). */
export async function getAccountMetrics(
  cfg: StackAdaptConfig,
  advertiserId: string,
  from: string,
  to: string,
): Promise<StackAdaptMetrics> {
  const query = `
    query($ids: [ID!], $from: ISO8601Date, $to: ISO8601Date) {
      advertiserDelivery(dataType: TABLE, granularity: TOTAL, ids: $ids, date: { from: $from, to: $to }) {
        ... on AdvertiserDeliveryOutcome { totalStats { ${METRICS_FRAGMENT} } }
      }
    }
  `;
  const data = await gql<{ advertiserDelivery?: { totalStats?: RawStats } }>(cfg, query, {
    ids: [advertiserId],
    from,
    to,
  });
  const stats = data.advertiserDelivery?.totalStats;
  return stats ? normalizeStats(stats) : { ...EMPTY_STACKADAPT_METRICS };
}

/** Per-campaign performance, sorted by spend desc. */
export async function getCampaignPerformance(
  cfg: StackAdaptConfig,
  advertiserId: string,
  from: string,
  to: string,
): Promise<StackAdaptRow[]> {
  const query = `
    query($advIds: [ID!], $from: ISO8601Date, $to: ISO8601Date) {
      campaignDelivery(dataType: TABLE, granularity: TOTAL, filterBy: { advertiserIds: $advIds }, date: { from: $from, to: $to }) {
        ... on CampaignDeliveryOutcome {
          records { nodes { campaign { id name } metrics { ${METRICS_FRAGMENT} } } }
        }
      }
    }
  `;
  const data = await gql<{ campaignDelivery?: { records?: { nodes?: CampaignNode[] } } }>(
    cfg,
    query,
    { advIds: [advertiserId], from, to },
  );
  const rows = (data.campaignDelivery?.records?.nodes ?? []).map((n) => ({
    ...normalizeStats(n.metrics ?? {}),
    id: String(n.campaign?.id ?? ''),
    name: n.campaign?.name ?? 'Unknown',
  }));
  return rows.sort((a, b) => b.spend - a.spend);
}

/** Per-campaign-group performance, sorted by spend desc. */
export async function getCampaignGroupPerformance(
  cfg: StackAdaptConfig,
  advertiserId: string,
  from: string,
  to: string,
): Promise<StackAdaptRow[]> {
  const query = `
    query($advIds: [ID!], $from: ISO8601Date, $to: ISO8601Date) {
      campaignGroupDelivery(dataType: TABLE, granularity: TOTAL, filterBy: { advertiserIds: $advIds }, date: { from: $from, to: $to }) {
        ... on CampaignGroupDeliveryOutcome {
          records { nodes { campaignGroup { id name } metrics { ${METRICS_FRAGMENT} } } }
        }
      }
    }
  `;
  const data = await gql<{ campaignGroupDelivery?: { records?: { nodes?: CampaignGroupNode[] } } }>(
    cfg,
    query,
    { advIds: [advertiserId], from, to },
  );
  const rows = (data.campaignGroupDelivery?.records?.nodes ?? []).map((n) => ({
    ...normalizeStats(n.metrics ?? {}),
    id: String(n.campaignGroup?.id ?? ''),
    name: n.campaignGroup?.name ?? 'Unknown',
  }));
  return rows.sort((a, b) => b.spend - a.spend);
}

/** Daily trend over [from, to] (advertiserDelivery GRAPH DAILY), sorted by date asc. */
export async function getDailyPerformance(
  cfg: StackAdaptConfig,
  advertiserId: string,
  from: string,
  to: string,
): Promise<StackAdaptDailyRow[]> {
  const query = `
    query($ids: [ID!], $from: ISO8601Date, $to: ISO8601Date) {
      advertiserDelivery(dataType: GRAPH, granularity: DAILY, ids: $ids, date: { from: $from, to: $to }) {
        ... on AdvertiserDeliveryOutcome {
          records { nodes { granularity { startTime } metrics { ${METRICS_FRAGMENT} } } }
        }
      }
    }
  `;
  const data = await gql<{ advertiserDelivery?: { records?: { nodes?: DailyNode[] } } }>(
    cfg,
    query,
    { ids: [advertiserId], from, to },
  );
  const rows = (data.advertiserDelivery?.records?.nodes ?? []).map((n) => {
    // startTime is an ISO8601 datetime ("2025-01-01T00:00:00Z") — take the date.
    const date = (n.granularity?.startTime ?? '').slice(0, 10);
    const label = date
      ? new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
          month: 'short',
          day: '2-digit',
          timeZone: 'UTC',
        })
      : '';
    return { ...normalizeStats(n.metrics ?? {}), date, label };
  });
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** Top 20 creatives (ads) by impressions (adDelivery). */
export async function getCreativePerformance(
  cfg: StackAdaptConfig,
  advertiserId: string,
  from: string,
  to: string,
): Promise<StackAdaptRow[]> {
  const query = `
    query($advIds: [ID!], $from: ISO8601Date, $to: ISO8601Date) {
      adDelivery(dataType: TABLE, granularity: TOTAL, filterBy: { advertiserIds: $advIds }, date: { from: $from, to: $to }) {
        ... on AdDeliveryOutcome {
          records { nodes { ad { id name } metrics { ${METRICS_FRAGMENT} } } }
        }
      }
    }
  `;
  const data = await gql<{ adDelivery?: { records?: { nodes?: AdNode[] } } }>(cfg, query, {
    advIds: [advertiserId],
    from,
    to,
  });
  const rows = (data.adDelivery?.records?.nodes ?? []).map((n) => ({
    ...normalizeStats(n.metrics ?? {}),
    id: String(n.ad?.id ?? ''),
    name: n.ad?.name ?? 'Unknown',
  }));
  return rows.sort((a, b) => b.impressions - a.impressions).slice(0, 20);
}
