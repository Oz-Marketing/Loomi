// Engagement aggregations over EmailEvent rows.
//
// The Event webhook persists a row per SendGrid event with custom_args
// flattened back onto the event (campaignId, recipientId, accountKey)
// so we can aggregate without joins for the common cases.
//
// "Sent" comes from EmailCampaignRecipient.sentAt rather than the
// SendGrid 'processed' / 'delivered' events: we mark the row 'sent'
// synchronously when SendGrid returns 202, which lands earlier than
// the corresponding webhook event and survives webhook outages.

import { prisma } from '@/lib/prisma';

/**
 * The 20260521010000 migration added the EmailEvent + EmailSuppression
 * models. If a dev server was started before `prisma generate` ran with
 * the new schema, the cached singleton client doesn't have these
 * delegates and every call below would throw the unhelpful
 * "Cannot read properties of undefined (reading 'groupBy')". This guard
 * turns that into something actionable.
 */
function assertEventModelAvailable(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(prisma as any).emailEvent || !(prisma as any).emailSuppression) {
    throw new Error(
      'Prisma client is missing EmailEvent / EmailSuppression models. ' +
      'Restart the dev server so the regenerated client is picked up ' +
      '(or run `npx prisma generate` if you skipped that step).',
    );
  }
}

export interface EngagementTotals {
  /** Per-recipient sends that landed at SendGrid (mail/send 202). */
  sent: number;
  /** delivered events from the webhook. Lags `sent` slightly. */
  delivered: number;
  /** Unique opens (one per recipient). */
  uniqueOpens: number;
  /** Total open events including repeat opens. */
  totalOpens: number;
  /** Unique clicks (one per recipient). */
  uniqueClicks: number;
  /** Total click events including repeat clicks. */
  totalClicks: number;
  bounces: number;
  dropped: number;
  spamReports: number;
  unsubscribes: number;
  /** Pre-send hygiene + suppression skips. Sourced from recipient rows. */
  skipped: number;
  /** Bounced + dropped sends + hard failures from the worker. */
  failed: number;
  // Computed ratios. Express as fractions (0.0–1.0) so callers can
  // format with their own locale.
  deliveryRate: number;
  openRate: number; // unique opens / delivered
  clickRate: number; // unique clicks / delivered
  clickToOpenRate: number; // unique clicks / unique opens
  bounceRate: number; // bounces / sent
  unsubscribeRate: number; // unsubs / delivered
}

export interface CampaignEngagementRow extends EngagementTotals {
  campaignId: string;
  campaignName: string | null;
  /** First scheduled or completed timestamp — used as the "send date"
   *  column on the engagement table. */
  sentAt: Date | null;
}

export interface TimeSeriesPoint {
  /** Day bucket (UTC, YYYY-MM-DD). */
  date: string;
  delivered: number;
  opens: number;
  clicks: number;
  bounces: number;
}

export interface TopUrl {
  url: string;
  clicks: number;
}

interface QueryRange {
  start: Date | null;
  end: Date | null;
}

interface AggregateInput extends QueryRange {
  /** When null, aggregate across every account the caller can see. */
  accountKeys: string[] | null;
}

function computeRatios(t: Omit<EngagementTotals, 'deliveryRate' | 'openRate' | 'clickRate' | 'clickToOpenRate' | 'bounceRate' | 'unsubscribeRate'>): EngagementTotals {
  const safe = (num: number, den: number) => (den > 0 ? num / den : 0);
  return {
    ...t,
    deliveryRate: safe(t.delivered, t.sent),
    openRate: safe(t.uniqueOpens, t.delivered),
    clickRate: safe(t.uniqueClicks, t.delivered),
    clickToOpenRate: safe(t.uniqueClicks, t.uniqueOpens),
    bounceRate: safe(t.bounces, t.sent),
    unsubscribeRate: safe(t.unsubscribes, t.delivered),
  };
}

/**
 * Aggregate engagement across all matching campaigns. Returns totals
 * across the entire range plus a per-day time series for chart use.
 */
export async function getEngagementTotals(
  input: AggregateInput,
): Promise<{
  totals: EngagementTotals;
  series: TimeSeriesPoint[];
  topUrls: TopUrl[];
}> {
  assertEventModelAvailable();
  const { accountKeys, start, end } = input;

  // Sent count comes from recipient rows where sentAt is non-null.
  const sentWhere = recipientWhere(input);
  const range = dateFilter(start, end);
  const sentDateFilter = range ? { sentAt: range } : {};
  const sent = await prisma.emailCampaignRecipient.count({
    where: { ...sentWhere, status: 'sent', ...sentDateFilter },
  });
  const skipped = await prisma.emailCampaignRecipient.count({ where: { ...sentWhere, status: 'skipped' } });
  const failed = await prisma.emailCampaignRecipient.count({ where: { ...sentWhere, status: 'failed' } });

  // Event counts come from EmailEvent.
  const eventWhere = eventBaseWhere(accountKeys, start, end);
  const grouped = await prisma.emailEvent.groupBy({
    by: ['eventType'],
    where: eventWhere,
    _count: { _all: true },
  });
  const eventCount = new Map(grouped.map((g) => [g.eventType, g._count._all]));

  // Unique opens/clicks via distinct recipientId. Events without a
  // recipientId aren't joinable to our send log anyway, so distinct on
  // recipientId is the right denominator.
  const uniqueOpens = await prisma.emailEvent.findMany({
    where: { ...eventWhere, eventType: 'open', recipientId: { not: null } },
    distinct: ['recipientId'],
    select: { recipientId: true },
  });
  const uniqueClicks = await prisma.emailEvent.findMany({
    where: { ...eventWhere, eventType: 'click', recipientId: { not: null } },
    distinct: ['recipientId'],
    select: { recipientId: true },
  });

  const totals = computeRatios({
    sent,
    delivered: eventCount.get('delivered') || 0,
    uniqueOpens: uniqueOpens.length,
    totalOpens: eventCount.get('open') || 0,
    uniqueClicks: uniqueClicks.length,
    totalClicks: eventCount.get('click') || 0,
    bounces: eventCount.get('bounce') || 0,
    dropped: eventCount.get('dropped') || 0,
    spamReports: eventCount.get('spamreport') || 0,
    unsubscribes:
      (eventCount.get('unsubscribe') || 0) +
      (eventCount.get('group_unsubscribe') || 0),
    skipped,
    failed,
  });

  const series = await buildTimeSeries(eventWhere, start, end);
  const topUrls = await buildTopUrls(eventWhere);

  return { totals, series, topUrls };
}

/**
 * Per-campaign engagement table. Returns one row per campaign in the
 * range, sorted by sent date descending.
 */
export async function getCampaignEngagement(
  input: AggregateInput,
): Promise<CampaignEngagementRow[]> {
  assertEventModelAvailable();
  const { accountKeys, start, end } = input;

  // Build the where clause incrementally to avoid the OR-with-undefined
  // pattern that Prisma sometimes chokes on. Account scoping happens
  // in JS below because accountKeys is a JSON string on the row.
  const range = dateFilter(start, end);
  const where = range
    ? {
        OR: [
          { startedAt: range },
          { completedAt: range },
          { scheduledFor: range },
        ],
      }
    : {};

  const campaigns = await prisma.emailCampaign.findMany({
    where,
    select: {
      id: true,
      name: true,
      accountKeys: true,
      scheduledFor: true,
      startedAt: true,
      completedAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 250,
  });

  // Account-key membership check in JS (accountKeys is a JSON string on
  // the row, so a SQL-side IN doesn't work cleanly).
  const matchesAccount = (raw: string): boolean => {
    if (!accountKeys || accountKeys.length === 0) return true;
    try {
      const parsed = JSON.parse(raw) as string[];
      return parsed.some((k) => accountKeys.includes(k));
    } catch {
      return false;
    }
  };
  const filtered = campaigns.filter((c) => matchesAccount(c.accountKeys));
  if (filtered.length === 0) return [];

  const campaignIds = filtered.map((c) => c.id);

  // Batch counts: sent + skipped + failed per campaign
  const recipientGroups = await prisma.emailCampaignRecipient.groupBy({
    by: ['campaignId', 'status'],
    where: { campaignId: { in: campaignIds } },
    _count: { _all: true },
  });
  const recipientCountByCampaign = new Map<string, { sent: number; skipped: number; failed: number }>();
  for (const g of recipientGroups) {
    const entry = recipientCountByCampaign.get(g.campaignId) || { sent: 0, skipped: 0, failed: 0 };
    if (g.status === 'sent') entry.sent = g._count._all;
    if (g.status === 'skipped') entry.skipped = g._count._all;
    if (g.status === 'failed') entry.failed = g._count._all;
    recipientCountByCampaign.set(g.campaignId, entry);
  }

  // Event counts grouped by (campaignId, eventType)
  const eventGroups = await prisma.emailEvent.groupBy({
    by: ['campaignId', 'eventType'],
    where: { campaignId: { in: campaignIds } },
    _count: { _all: true },
  });
  const eventCountByCampaign = new Map<string, Record<string, number>>();
  for (const g of eventGroups) {
    if (!g.campaignId) continue;
    const entry = eventCountByCampaign.get(g.campaignId) || {};
    entry[g.eventType] = g._count._all;
    eventCountByCampaign.set(g.campaignId, entry);
  }

  // Unique opens / clicks: one query per campaign would be a lot;
  // batch with two distinct queries scoped to campaignId IN ().
  const uniqueOpenRows = await prisma.emailEvent.findMany({
    where: {
      campaignId: { in: campaignIds },
      eventType: 'open',
      recipientId: { not: null },
    },
    distinct: ['campaignId', 'recipientId'],
    select: { campaignId: true, recipientId: true },
  });
  const uniqueOpenByCampaign = new Map<string, number>();
  for (const r of uniqueOpenRows) {
    if (!r.campaignId) continue;
    uniqueOpenByCampaign.set(r.campaignId, (uniqueOpenByCampaign.get(r.campaignId) || 0) + 1);
  }

  const uniqueClickRows = await prisma.emailEvent.findMany({
    where: {
      campaignId: { in: campaignIds },
      eventType: 'click',
      recipientId: { not: null },
    },
    distinct: ['campaignId', 'recipientId'],
    select: { campaignId: true, recipientId: true },
  });
  const uniqueClickByCampaign = new Map<string, number>();
  for (const r of uniqueClickRows) {
    if (!r.campaignId) continue;
    uniqueClickByCampaign.set(r.campaignId, (uniqueClickByCampaign.get(r.campaignId) || 0) + 1);
  }

  return filtered
    .map((c) => {
      const recipientCounts = recipientCountByCampaign.get(c.id) || { sent: 0, skipped: 0, failed: 0 };
      const evt = eventCountByCampaign.get(c.id) || {};
      const totals = computeRatios({
        sent: recipientCounts.sent,
        delivered: evt['delivered'] || 0,
        uniqueOpens: uniqueOpenByCampaign.get(c.id) || 0,
        totalOpens: evt['open'] || 0,
        uniqueClicks: uniqueClickByCampaign.get(c.id) || 0,
        totalClicks: evt['click'] || 0,
        bounces: evt['bounce'] || 0,
        dropped: evt['dropped'] || 0,
        spamReports: evt['spamreport'] || 0,
        unsubscribes: (evt['unsubscribe'] || 0) + (evt['group_unsubscribe'] || 0),
        skipped: recipientCounts.skipped,
        failed: recipientCounts.failed,
      });
      return {
        campaignId: c.id,
        campaignName: c.name,
        sentAt: c.completedAt || c.startedAt || c.scheduledFor || null,
        ...totals,
      };
    })
    .sort((a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0));
}

// ── Helpers ──

function dateFilter(start: Date | null, end: Date | null): { gte?: Date; lte?: Date } | null {
  if (!start && !end) return null;
  const filter: { gte?: Date; lte?: Date } = {};
  if (start) filter.gte = start;
  if (end) filter.lte = end;
  return filter;
}

function recipientWhere(input: AggregateInput) {
  if (input.accountKeys && input.accountKeys.length > 0) {
    return { accountKey: { in: input.accountKeys } };
  }
  return {};
}

function eventBaseWhere(
  accountKeys: string[] | null,
  start: Date | null,
  end: Date | null,
) {
  const where: { accountKey?: { in: string[] }; timestamp?: { gte?: Date; lte?: Date } } = {};
  if (accountKeys && accountKeys.length > 0) {
    where.accountKey = { in: accountKeys };
  }
  const ts = dateFilter(start, end);
  if (ts) where.timestamp = ts;
  return where;
}

async function buildTimeSeries(
  baseWhere: ReturnType<typeof eventBaseWhere>,
  start: Date | null,
  end: Date | null,
): Promise<TimeSeriesPoint[]> {
  // Pull the four interesting event types in one query, then bucket in
  // JS. For accounts in the tens of thousands of events per day, raw
  // SQL with date_trunc would be faster — revisit if a sub-account
  // pushes past that scale.
  const rows = await prisma.emailEvent.findMany({
    where: {
      ...baseWhere,
      eventType: { in: ['delivered', 'open', 'click', 'bounce'] },
    },
    select: { eventType: true, timestamp: true },
    take: 50_000,
  });

  const bucketByDay = new Map<string, TimeSeriesPoint>();
  for (const row of rows) {
    const day = row.timestamp.toISOString().slice(0, 10);
    let bucket = bucketByDay.get(day);
    if (!bucket) {
      bucket = { date: day, delivered: 0, opens: 0, clicks: 0, bounces: 0 };
      bucketByDay.set(day, bucket);
    }
    if (row.eventType === 'delivered') bucket.delivered += 1;
    else if (row.eventType === 'open') bucket.opens += 1;
    else if (row.eventType === 'click') bucket.clicks += 1;
    else if (row.eventType === 'bounce') bucket.bounces += 1;
  }

  // Fill gaps with zero buckets so the chart has a continuous x-axis.
  const series: TimeSeriesPoint[] = [];
  const from = start
    ? new Date(start.toISOString().slice(0, 10))
    : earliestKey(bucketByDay);
  const to = end
    ? new Date(end.toISOString().slice(0, 10))
    : new Date();
  if (!from) return [...bucketByDay.values()].sort((a, b) => a.date.localeCompare(b.date));

  for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    series.push(bucketByDay.get(day) || { date: day, delivered: 0, opens: 0, clicks: 0, bounces: 0 });
  }
  return series;
}

function earliestKey(map: Map<string, unknown>): Date | null {
  let earliest: string | null = null;
  for (const key of map.keys()) {
    if (!earliest || key < earliest) earliest = key;
  }
  return earliest ? new Date(earliest) : null;
}

async function buildTopUrls(
  baseWhere: ReturnType<typeof eventBaseWhere>,
): Promise<TopUrl[]> {
  // Note: groupBy's orderBy on _count was finicky in Prisma 7 when the
  // counted field doesn't match the order field. Sort in JS — for the
  // top 10 list this is trivial cost.
  const grouped = await prisma.emailEvent.groupBy({
    by: ['url'],
    where: { ...baseWhere, eventType: 'click', url: { not: null } },
    _count: { _all: true },
  });
  return grouped
    .filter((g) => g.url)
    .map((g) => ({ url: g.url!, clicks: g._count._all }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 10);
}
