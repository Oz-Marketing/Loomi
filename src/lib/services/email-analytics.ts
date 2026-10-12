// Email engagement — the numbers behind the Blasts list, the sent-blast drawer,
// the Blasts analytics tab, the client-facing Reporting page and the portfolio
// dashboard. One set of definitions, computed one way, for every surface.
//
// ── WHAT EACH NUMBER MEANS ──────────────────────────────────────────────────
// Everything is counted per RECIPIENT — an EmailBlastRecipient row and the
// SendGrid events joined to it — never by counting raw events:
//
//   Sent       Recipients SendGrid accepted: status 'sent' or 'bounced'. A
//              bounce WAS dispatched and refused afterwards, so it stays in
//              Sent. Counting only 'sent', as this file used to, dropped every
//              bounce out of the denominator: delivery rate drifted to and past
//              100%, bounce rate was overstated, and a dropped message landed
//              in neither Sent nor Bounced.
//   Delivered  'sent' recipients with a 'delivered' event.
//   Bounced    Status 'bounced', which the webhook writes for a bounce AND a
//              drop. A recipient delivered and THEN bounced counts once, as
//              bounced — the bounce is the later, terminal fact, and the one
//              that suppressed the address — so Delivered + Bounced never
//              exceeds Sent.
//   Opens      'sent' recipients with an eventType 'open' event (clicks the
//              same with 'click'). Unique = one per recipient, total = every
//              event. Machine opens — Apple Mail Privacy Protection fetching
//              the pixel on the reader's behalf — are stored as 'machine_open'
//              and count nowhere.
//   Failed     Status 'failed': Loomi could not dispatch it.
//   Skipped    Status 'skipped': deliberately not attempted (suppressed, no
//              address, a domain with no mail server, a canceled send).
//
// Rates are computed by `computeRatios` and clamped to 0–100%. A numerator and
// its denominator come from separate webhook deliveries, and one lost
// 'delivered' event must not be able to print a 104% open rate.
//
// ── WHAT A DATE RANGE SELECTS ───────────────────────────────────────────────
// A range picks RECIPIENTS by when they were dispatched: `sentAt`, or, for one
// never dispatched, `updatedAt` — when its skip or failure was recorded. Their
// opens and clicks then count whenever they happen, so a blast's engagement is
// reported against the window it went out in and each recipient lands in
// exactly one window. Skipped and failed follow the same rule; they used to
// ignore the range entirely, so a 7-day report carried all-time failures.
//
// Totals and per-blast rows are produced by that one rule, so the rows add up
// to the totals (until CAMPAIGN_ROW_LIMIT truncates the list). Flow emails are
// recipients of a flow step's wrapper campaign, and whether they count is the
// caller's `source` choice, applied to both. They used to count in the totals
// but vanish from the rows whenever a range was set, because rows were chosen
// by the wrapper's start/complete dates, which a wrapper never gets.
//
// The daily chart and the link list are deliberately different: they plot
// ACTIVITY, so an open is drawn on the day it happened. They still go through
// the recipient row, so they obey the same scope and the same opens rule.
//
// ── PURGED BLASTS ───────────────────────────────────────────────────────────
// The archive purge hard-deletes a blast and its recipients but keeps their
// events (EmailEvent.recipientId is SET NULL). Counting events by themselves
// kept a purged blast's deliveries and opens after its sends were gone, and
// inflated every rate. Everything here joins through the recipient row, so a
// purged blast leaves the numerators and the denominators together.
//
// ── NOTHING IS LOADED INTO MEMORY ───────────────────────────────────────────
// Blasts have no recipient cap and the server has 2GB. Every aggregate is
// computed in Postgres; only per-blast, per-account or per-day figures come
// back. The aggregates take id and key lists as ONE array parameter
// (`= ANY($1::text[])`), and the campaign-metadata reads chunk their `in`
// lists (DB_CHUNK), so nothing here meets Postgres's 65,535 bind-parameter
// ceiling.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { chunk, DB_CHUNK } from '@/lib/db/chunk';

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

/** Raw per-recipient counts, before any rate is derived. See the file header. */
export interface EngagementCounts {
  /** Accepted by SendGrid — status 'sent' or 'bounced'. */
  sent: number;
  /** 'sent' recipients with a delivered event. Never counts a bounce. */
  delivered: number;
  /** Recipients with at least one 'open' (never 'machine_open'). */
  uniqueOpens: number;
  /** Every 'open' event from those recipients, repeats included. */
  totalOpens: number;
  /** Recipients with at least one click. */
  uniqueClicks: number;
  /** Every click event from those recipients, repeats included. */
  totalClicks: number;
  /** Status 'bounced' — a bounce or a drop, one per recipient. */
  bounces: number;
  /** The part of `bounces` SendGrid dropped without attempting. */
  dropped: number;
  spamReports: number;
  unsubscribes: number;
  /** Deliberately not attempted: suppressed, no address, dead domain, canceled. */
  skipped: number;
  /** Loomi could not dispatch it. Bounces are NOT failures. */
  failed: number;
}

export interface EngagementTotals extends EngagementCounts {
  // Computed ratios. Express as fractions (0.0–1.0) so callers can
  // format with their own locale. Always clamped to that range.
  deliveryRate: number; // delivered / sent
  openRate: number; // unique opens / delivered
  clickRate: number; // unique clicks / delivered
  clickToOpenRate: number; // unique clicks / unique opens
  bounceRate: number; // bounces / sent
  unsubscribeRate: number; // unsubs / delivered
}

export interface CampaignEngagementRow extends EngagementTotals {
  campaignId: string;
  campaignName: string | null;
  /** The blast's completed / started / scheduled time. A flow step's wrapper
   *  has none of those, so it is dated by its latest send in the window. */
  sentAt: Date | null;
}

export interface TimeSeriesPoint {
  /** Day bucket (UTC, YYYY-MM-DD). */
  date: string;
  /** Recipients with that activity on that day — distinct per day. */
  delivered: number;
  opens: number;
  clicks: number;
  bounces: number;
}

export interface TopUrl {
  url: string;
  clicks: number;
}

/**
 * Which campaigns' recipients count. 'blasts' is the one-off sends a person
 * composed; 'flows' is the wrapper campaigns flow steps send through; 'all' is
 * both. The same filter as `BlastSourceFilter` on the Blasts list.
 */
export type EngagementSource = 'blasts' | 'flows' | 'all';

export interface EngagementScope {
  /**
   * Accounts whose recipients count. `null` = every account. An EMPTY list
   * means none: a scoped user with no assignments must see nothing, and this
   * used to widen `[]` to the whole platform.
   */
  accountKeys: string[] | null;
  start: Date | null;
  end: Date | null;
  /** Defaults to 'all'. */
  source?: EngagementSource;
}

export const EMPTY_ENGAGEMENT_COUNTS: EngagementCounts = {
  sent: 0,
  delivered: 0,
  uniqueOpens: 0,
  totalOpens: 0,
  uniqueClicks: 0,
  totalClicks: 0,
  bounces: 0,
  dropped: 0,
  spamReports: 0,
  unsubscribes: 0,
  skipped: 0,
  failed: 0,
};

/**
 * `num / den` as a fraction, clamped to 0–1, and 0 when there is nothing to
 * divide by. Every rate on every engagement surface goes through this.
 */
export function rate(num: number, den: number): number {
  if (!(den > 0) || !Number.isFinite(num) || num <= 0) return 0;
  return Math.min(1, num / den);
}

export function computeRatios(t: EngagementCounts): EngagementTotals {
  return {
    ...t,
    deliveryRate: rate(t.delivered, t.sent),
    openRate: rate(t.uniqueOpens, t.delivered),
    clickRate: rate(t.uniqueClicks, t.delivered),
    clickToOpenRate: rate(t.uniqueClicks, t.uniqueOpens),
    bounceRate: rate(t.bounces, t.sent),
    unsubscribeRate: rate(t.unsubscribes, t.delivered),
  };
}

/**
 * Sum counts across groups. Every count is per recipient and a recipient
 * belongs to exactly one campaign and one account, so a plain sum is exact —
 * including the unique ones.
 */
export function sumEngagementCounts(groups: Iterable<EngagementCounts>): EngagementCounts {
  const out: EngagementCounts = { ...EMPTY_ENGAGEMENT_COUNTS };
  const keys = Object.keys(EMPTY_ENGAGEMENT_COUNTS) as (keyof EngagementCounts)[];
  for (const g of groups) {
    for (const k of keys) out[k] += g[k];
  }
  return out;
}

/**
 * Most campaign rows either surface can ask for at once. Mirrors the `limit`
 * the campaigns-list endpoint passes to `listEmailBlasts` / `listSmsBlasts`.
 */
export const CAMPAIGN_ROW_LIMIT = 500;

// ── Reports ──

export interface EngagementReport {
  totals: EngagementTotals;
  series: TimeSeriesPoint[];
  topUrls: TopUrl[];
  campaigns: CampaignEngagementRow[];
  /** Campaigns with a recipient in the window — uncapped, unlike `campaigns`. */
  campaignCount: number;
}

/**
 * Totals, chart, top links and per-campaign rows in one pass. The totals and
 * the rows come from the SAME aggregate, which is what guarantees they agree.
 */
export async function getEngagementReport(input: EngagementScope): Promise<EngagementReport> {
  assertEventModelAvailable();
  const scope = normalizeScope(input);
  const [groups, series, topUrls] = await Promise.all([
    aggregateEmailCohort(scope, 'campaign'),
    buildTimeSeries(scope),
    buildTopUrls(scope),
  ]);
  const byCampaign = new Map(groups.map((g) => [g.key, g]));
  return {
    totals: computeRatios(sumEngagementCounts(groups)),
    series,
    topUrls,
    campaigns: await buildCampaignRows(scope, byCampaign),
    campaignCount: groups.length,
  };
}

/**
 * Aggregate engagement across all matching campaigns. Returns totals
 * across the entire range plus a per-day time series for chart use.
 */
export async function getEngagementTotals(
  input: EngagementScope,
): Promise<{
  totals: EngagementTotals;
  series: TimeSeriesPoint[];
  topUrls: TopUrl[];
}> {
  assertEventModelAvailable();
  const scope = normalizeScope(input);
  const [groups, series, topUrls] = await Promise.all([
    aggregateEmailCohort(scope, 'campaign'),
    buildTimeSeries(scope),
    buildTopUrls(scope),
  ]);
  return { totals: computeRatios(sumEngagementCounts(groups)), series, topUrls };
}

/**
 * Per-campaign engagement table. Returns one row per campaign, sorted by
 * send date descending.
 */
export async function getCampaignEngagement(
  input: EngagementScope,
): Promise<CampaignEngagementRow[]> {
  assertEventModelAvailable();
  const scope = normalizeScope(input);
  if (hasRange(scope)) {
    const groups = await aggregateEmailCohort(scope, 'campaign');
    return buildCampaignRows(scope, new Map(groups.map((g) => [g.key, g])));
  }
  // No range: the rows are the list's own page of campaigns, so only those
  // campaigns' recipients need aggregating.
  const campaigns = await listPageCampaigns(scope);
  const groups = await aggregateEmailCohort(
    { ...scope, campaignIds: campaigns.map((c) => c.id) },
    'campaign',
  );
  return buildCampaignRows(scope, new Map(groups.map((g) => [g.key, g])), campaigns);
}

/**
 * Per-campaign engagement for a single campaign. Mirrors the shape of
 * a row from {@link getCampaignEngagement} so the campaigns-list detail
 * drawer can render the same KPIs without pulling the whole range.
 *
 * `accountKeys` scopes the recipients the same way the list does, so a blast
 * that spans several accounts reads the same in the row and in the drawer.
 */
export async function getCampaignEngagementById(
  campaignId: string,
  accountKeys: string[] | null = null,
): Promise<CampaignEngagementRow | null> {
  assertEventModelAvailable();

  const campaign = await prisma.emailBlast.findUnique({
    where: { id: campaignId },
    select: CAMPAIGN_META_SELECT,
  });
  if (!campaign) return null;

  const [group] = await aggregateEmailCohort(
    { accountKeys, start: null, end: null, source: 'all', campaignIds: [campaign.id] },
    'campaign',
  );
  return toCampaignRow(campaign, group);
}

// ── The cohort aggregate ──

export interface EngagementGroup extends EngagementCounts {
  /** The campaign id or account key the row is grouped by. */
  key: string;
  /** Latest dispatch among the group's recipients in the window. */
  lastSentAt: Date | null;
}

export interface CohortFilter extends EngagementScope {
  /** Only these campaigns (the list's page, or the one the drawer shows). */
  campaignIds?: string[];
}

/**
 * Every count in the file header, for the recipients the filter selects,
 * grouped by campaign or by account.
 *
 * Two steps, both in SQL. `cohort` picks the recipient rows; `engagement`
 * folds each one's events into a handful of flags and counts (one row per
 * recipient, however many events it has); the outer query then counts
 * recipients by status and flag. Because each recipient is folded to one row
 * before anything is counted, "unique" is exact and repeat opens can never
 * inflate a recipient-level figure.
 */
export async function aggregateEmailCohort(
  filter: CohortFilter,
  by: 'campaign' | 'account',
): Promise<EngagementGroup[]> {
  const f: CohortFilter = {
    ...normalizeScope(filter),
    campaignIds: filter.campaignIds ? [...new Set(filter.campaignIds)] : undefined,
  };
  if (isEmptyScope(f) || (f.campaignIds && f.campaignIds.length === 0)) return [];

  // A fixed column, never caller input.
  const groupCol = by === 'campaign' ? Prisma.raw('c."campaignId"') : Prisma.raw('c."accountKey"');

  // Index hints for the event scan. Both writers of EmailEvent (the blast
  // send loop and the flow engine) stamp campaignId, recipientId and
  // accountKey from the same recipient row, so for any event joined to a
  // cohort recipient these hold anyway — they exist so Postgres can reach the
  // events through (campaignId, eventType) or (accountKey, eventType) instead
  // of reading the whole table.
  const eventHints: Prisma.Sql[] = [];
  if (f.campaignIds) eventHints.push(Prisma.sql`AND e."campaignId" = ANY(${f.campaignIds}::text[])`);
  if (f.accountKeys) eventHints.push(Prisma.sql`AND e."accountKey" = ANY(${f.accountKeys}::text[])`);

  const rows = await prisma.$queryRaw<RawGroupRow[]>`
    WITH cohort AS (
      SELECT r.id, r."campaignId", r."accountKey", r.status, r."sentAt"
        FROM "EmailCampaignRecipient" r
        ${campaignJoin(f)}
       WHERE ${cohortWhere(f)}
    ),
    engagement AS (
      SELECT e."recipientId",
             bool_or(e."eventType" = 'delivered') AS delivered,
             COUNT(*) FILTER (WHERE e."eventType" = 'open') AS opens,
             COUNT(*) FILTER (WHERE e."eventType" = 'click') AS clicks,
             bool_or(e."eventType" = 'dropped') AS dropped,
             bool_or(e."eventType" = 'spamreport') AS "spamReport",
             bool_or(e."eventType" IN ('unsubscribe', 'group_unsubscribe')) AS unsubscribed
        FROM "EmailEvent" e
        JOIN cohort c ON c.id = e."recipientId"
       WHERE e."eventType" IN ('delivered', 'open', 'click', 'dropped', 'spamreport', 'unsubscribe', 'group_unsubscribe')
             ${eventHints.length > 0 ? Prisma.join(eventHints, ' ') : Prisma.empty}
       GROUP BY e."recipientId"
    )
    SELECT ${groupCol} AS "key",
           COUNT(*) FILTER (WHERE c.status IN ('sent', 'bounced'))::int AS "sent",
           COUNT(*) FILTER (WHERE c.status = 'sent' AND x.delivered)::int AS "delivered",
           COUNT(*) FILTER (WHERE c.status = 'sent' AND x.opens > 0)::int AS "uniqueOpens",
           COALESCE(SUM(x.opens) FILTER (WHERE c.status = 'sent'), 0)::int AS "totalOpens",
           COUNT(*) FILTER (WHERE c.status = 'sent' AND x.clicks > 0)::int AS "uniqueClicks",
           COALESCE(SUM(x.clicks) FILTER (WHERE c.status = 'sent'), 0)::int AS "totalClicks",
           COUNT(*) FILTER (WHERE c.status = 'bounced')::int AS "bounces",
           COUNT(*) FILTER (WHERE c.status = 'bounced' AND x.dropped)::int AS "dropped",
           COUNT(*) FILTER (WHERE c.status = 'sent' AND x."spamReport")::int AS "spamReports",
           COUNT(*) FILTER (WHERE c.status = 'sent' AND x.unsubscribed)::int AS "unsubscribes",
           COUNT(*) FILTER (WHERE c.status = 'skipped')::int AS "skipped",
           COUNT(*) FILTER (WHERE c.status = 'failed')::int AS "failed",
           MAX(c."sentAt") FILTER (WHERE c.status IN ('sent', 'bounced')) AS "lastSentAt"
      FROM cohort c
      LEFT JOIN engagement x ON x."recipientId" = c.id
     GROUP BY ${groupCol}
  `;
  return rows.map(toGroup);
}

/**
 * Activity per UTC day, by event time — the chart. Days with no activity are
 * absent; `buildTimeSeries` fills the gaps for a continuous axis.
 *
 * Each figure is distinct RECIPIENTS that day, under the same rules as the
 * totals: delivered/opens/clicks only for recipients still 'sent', a bounce
 * or drop only for recipients now 'bounced', and only eventType 'open' is an
 * open. It used to read at most 50,000 raw events in no particular order and
 * bucket them in JS, which quietly cut off any account busier than that.
 */
export async function getEmailActivityByDay(input: EngagementScope): Promise<TimeSeriesPoint[]> {
  const scope = normalizeScope(input);
  if (isEmptyScope(scope)) return [];
  const where: Prisma.Sql[] = [
    Prisma.sql`e."eventType" IN ('delivered', 'open', 'click', 'bounce', 'dropped')`,
    Prisma.sql`r.status IN ('sent', 'bounced')`,
    ...activityWhere(scope),
  ];
  // Two levels: fold each (day, recipient) to one row of flags, then count
  // flags per day. Same answer as four COUNT(DISTINCT …)s, without the four
  // sorts those need — measured ~25% faster over half a million events.
  // `timestamp` is stored as UTC without a zone, so the day is the UTC day
  // whatever the database session's time zone is.
  const rows = await prisma.$queryRaw<RawDayRow[]>`
    SELECT to_char(d.day, 'YYYY-MM-DD') AS "date",
           COUNT(*) FILTER (WHERE d.delivered)::int AS "delivered",
           COUNT(*) FILTER (WHERE d.opened)::int AS "opens",
           COUNT(*) FILTER (WHERE d.clicked)::int AS "clicks",
           COUNT(*) FILTER (WHERE d.bounced)::int AS "bounces"
      FROM (
        SELECT date_trunc('day', e."timestamp") AS day,
               e."recipientId",
               bool_or(e."eventType" = 'delivered' AND r.status = 'sent') AS delivered,
               bool_or(e."eventType" = 'open' AND r.status = 'sent') AS opened,
               bool_or(e."eventType" = 'click' AND r.status = 'sent') AS clicked,
               bool_or(e."eventType" IN ('bounce', 'dropped') AND r.status = 'bounced') AS bounced
          FROM "EmailEvent" e
          JOIN "EmailCampaignRecipient" r ON r.id = e."recipientId"
          ${campaignJoin(scope)}
         WHERE ${Prisma.join(where, ' AND ')}
         GROUP BY 1, 2
      ) d
     GROUP BY d.day
     ORDER BY d.day
  `;
  return rows.map((row) => ({
    date: String(row.date),
    delivered: Number(row.delivered) || 0,
    opens: Number(row.opens) || 0,
    clicks: Number(row.clicks) || 0,
    bounces: Number(row.bounces) || 0,
  }));
}

// ── Helpers ──

/** Columns a campaign row needs; shared by every metadata read. */
const CAMPAIGN_META_SELECT = {
  id: true,
  name: true,
  accountKeys: true,
  scheduledFor: true,
  startedAt: true,
  completedAt: true,
} as const;

interface CampaignMeta {
  id: string;
  name: string | null;
  accountKeys: string;
  scheduledFor: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

interface RawGroupRow {
  key: string;
  sent: number | bigint;
  delivered: number | bigint;
  uniqueOpens: number | bigint;
  totalOpens: number | bigint;
  uniqueClicks: number | bigint;
  totalClicks: number | bigint;
  bounces: number | bigint;
  dropped: number | bigint;
  spamReports: number | bigint;
  unsubscribes: number | bigint;
  skipped: number | bigint;
  failed: number | bigint;
  lastSentAt: Date | string | null;
}

interface RawDayRow {
  date: string;
  delivered: number | bigint;
  opens: number | bigint;
  clicks: number | bigint;
  bounces: number | bigint;
}

function toGroup(row: RawGroupRow): EngagementGroup {
  const n = (v: number | bigint | null | undefined) => Number(v ?? 0) || 0;
  return {
    key: row.key,
    sent: n(row.sent),
    delivered: n(row.delivered),
    uniqueOpens: n(row.uniqueOpens),
    totalOpens: n(row.totalOpens),
    uniqueClicks: n(row.uniqueClicks),
    totalClicks: n(row.totalClicks),
    bounces: n(row.bounces),
    dropped: n(row.dropped),
    spamReports: n(row.spamReports),
    unsubscribes: n(row.unsubscribes),
    skipped: n(row.skipped),
    failed: n(row.failed),
    lastSentAt: row.lastSentAt ? new Date(row.lastSentAt) : null,
  };
}

/** Just the counts — a group also carries its key and date, which aren't counts. */
function countsOf(group: EngagementGroup | undefined): EngagementCounts {
  const out: EngagementCounts = { ...EMPTY_ENGAGEMENT_COUNTS };
  if (!group) return out;
  for (const k of Object.keys(EMPTY_ENGAGEMENT_COUNTS) as (keyof EngagementCounts)[]) {
    out[k] = group[k];
  }
  return out;
}

function toCampaignRow(c: CampaignMeta, group: EngagementGroup | undefined): CampaignEngagementRow {
  return {
    campaignId: c.id,
    campaignName: c.name,
    sentAt: c.completedAt || c.startedAt || c.scheduledFor || group?.lastSentAt || null,
    ...computeRatios(countsOf(group)),
  };
}

function normalizeScope(input: EngagementScope): EngagementScope {
  return {
    accountKeys: input.accountKeys ? [...new Set(input.accountKeys)] : null,
    start: input.start ?? null,
    end: input.end ?? null,
    source: input.source ?? 'all',
  };
}

function isEmptyScope(scope: EngagementScope): boolean {
  return scope.accountKeys !== null && scope.accountKeys.length === 0;
}

function hasRange(scope: EngagementScope): boolean {
  return Boolean(scope.start || scope.end);
}

/** JOIN to the campaign row, only when the source filter needs its flowNodeKey. */
function campaignJoin(scope: EngagementScope): Prisma.Sql {
  return (scope.source ?? 'all') === 'all'
    ? Prisma.empty
    : Prisma.sql`JOIN "EmailCampaign" b ON b.id = r."campaignId"`;
}

function sourcePredicates(scope: EngagementScope): Prisma.Sql[] {
  if (scope.source === 'blasts') return [Prisma.sql`b."flowNodeKey" IS NULL`];
  if (scope.source === 'flows') return [Prisma.sql`b."flowNodeKey" IS NOT NULL`];
  return [];
}

/**
 * The recipients a report counts: a reported status, in scope, dispatched (or,
 * for one never dispatched, resolved) inside the range. Pending recipients are
 * work in progress and count nowhere until they resolve.
 */
function cohortWhere(f: CohortFilter): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`r.status IN ('sent', 'bounced', 'failed', 'skipped')`];
  if (f.accountKeys) parts.push(Prisma.sql`r."accountKey" = ANY(${f.accountKeys}::text[])`);
  if (f.campaignIds) parts.push(Prisma.sql`r."campaignId" = ANY(${f.campaignIds}::text[])`);
  if (f.start || f.end) {
    // COALESCE("sentAt", "updatedAt") in range, spelled out over the plain
    // columns. Same rows; the difference is the planner. A range on the
    // COALESCE expression has no statistics, so Postgres guessed a 300k-row
    // cohort at ~800 rows and walked the events index once per recipient
    // (seconds); over the columns it reads their histograms and hash-joins.
    const within = (col: Prisma.Sql) =>
      Prisma.join(
        [
          ...(f.start ? [Prisma.sql`${col} >= ${f.start}`] : []),
          ...(f.end ? [Prisma.sql`${col} <= ${f.end}`] : []),
        ],
        ' AND ',
      );
    parts.push(Prisma.sql`(
      (${within(Prisma.raw('r."sentAt"'))})
      OR (r."sentAt" IS NULL AND ${within(Prisma.raw('r."updatedAt"'))})
    )`);
  }
  parts.push(...sourcePredicates(f));
  return Prisma.join(parts, ' AND ');
}

/**
 * Scope for the activity views (chart, top links): events in the range, from
 * recipients that still exist, in scope. The event's own accountKey is the
 * same index hint as in `aggregateEmailCohort`.
 */
function activityWhere(scope: EngagementScope): Prisma.Sql[] {
  const parts: Prisma.Sql[] = [];
  if (scope.accountKeys) {
    parts.push(Prisma.sql`r."accountKey" = ANY(${scope.accountKeys}::text[])`);
    parts.push(Prisma.sql`e."accountKey" = ANY(${scope.accountKeys}::text[])`);
  }
  if (scope.start) parts.push(Prisma.sql`e."timestamp" >= ${scope.start}`);
  if (scope.end) parts.push(Prisma.sql`e."timestamp" <= ${scope.end}`);
  parts.push(...sourcePredicates(scope));
  return parts;
}

async function buildTimeSeries(scope: EngagementScope): Promise<TimeSeriesPoint[]> {
  const days = await getEmailActivityByDay(scope);
  const bucketByDay = new Map(days.map((d) => [d.date, d]));

  // Fill gaps with zero buckets so the chart has a continuous x-axis.
  const series: TimeSeriesPoint[] = [];
  const from = scope.start
    ? new Date(scope.start.toISOString().slice(0, 10))
    : earliestKey(bucketByDay);
  const to = scope.end
    ? new Date(scope.end.toISOString().slice(0, 10))
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

/**
 * Most-clicked links in the range, by click events. Same population as the
 * click rate — recipients still 'sent', in scope — so a purged blast's links
 * leave with it.
 */
async function buildTopUrls(scope: EngagementScope): Promise<TopUrl[]> {
  if (isEmptyScope(scope)) return [];
  const where: Prisma.Sql[] = [
    Prisma.sql`e."eventType" = 'click'`,
    Prisma.sql`e.url IS NOT NULL`,
    Prisma.sql`r.status = 'sent'`,
    ...activityWhere(scope),
  ];
  const rows = await prisma.$queryRaw<Array<{ url: string; clicks: number | bigint }>>`
    SELECT e.url AS "url", COUNT(*)::int AS "clicks"
      FROM "EmailEvent" e
      JOIN "EmailCampaignRecipient" r ON r.id = e."recipientId"
      ${campaignJoin(scope)}
     WHERE ${Prisma.join(where, ' AND ')}
     GROUP BY e.url
     ORDER BY 2 DESC, 1 ASC
     LIMIT 10
  `;
  return rows
    .filter((row) => row.url)
    .map((row) => ({ url: row.url, clicks: Number(row.clicks) || 0 }));
}

/**
 * The campaigns the Blasts list shows on one page: newest first, capped at
 * CAMPAIGN_ROW_LIMIT, scoped to the account.
 */
async function listPageCampaigns(scope: EngagementScope): Promise<CampaignMeta[]> {
  if (isEmptyScope(scope)) return [];
  const accountKeys = scope.accountKeys;
  // Build the where clause incrementally to avoid the OR-with-undefined
  // pattern that Prisma sometimes chokes on.
  const clauses: Prisma.EmailBlastWhereInput[] = [];
  // Account scoping runs in SQL, not (only) in JS.
  //
  // `accountKeys` is a JSON string column, so there is no clean `IN`. It used
  // to be filtered in JS *after* the `take` below, which made the cap global:
  // the query fetched the N most recent blasts ACROSS EVERY ACCOUNT and only
  // then narrowed to this one. Once the platform had more blasts than the cap,
  // an account's sends fell off the end and its rows silently lost their
  // numbers — while the Reports page, querying a narrower date window, still
  // found them. Same data, two different answers.
  //
  // Matching on the quoted key ('"abc"') is exact despite being a substring
  // test: the surrounding quotes are part of the pattern, so '"abc"' cannot
  // match inside '"xabc"'. The JS check below still runs as a belt-and-braces
  // parse of the real array.
  if (accountKeys) {
    clauses.push({
      OR: accountKeys.map((key) => ({ accountKeys: { contains: JSON.stringify(key) } })),
    });
  }
  if (scope.source === 'blasts') clauses.push({ flowNodeKey: null });
  if (scope.source === 'flows') clauses.push({ flowNodeKey: { not: null } });

  const campaigns = await prisma.emailBlast.findMany({
    where: clauses.length > 0 ? { AND: clauses } : {},
    select: CAMPAIGN_META_SELECT,
    orderBy: { createdAt: 'desc' },
    // Now that the account is part of the query this cap is PER ACCOUNT.
    // Kept deliberately in step with the campaigns list's own page size
    // (`listEmailBlasts({ limit: CAMPAIGN_ROW_LIMIT })`) so every row the list
    // can render is a row this can supply numbers for; raising one without the
    // other reintroduces rows that show "—" for no visible reason.
    take: CAMPAIGN_ROW_LIMIT,
  });

  // Belt-and-braces membership check: parses the real array, so a row whose
  // JSON somehow doesn't mean what the substring match assumed is dropped.
  if (!accountKeys) return campaigns;
  return campaigns.filter((c) => {
    try {
      const parsed = JSON.parse(c.accountKeys) as string[];
      return parsed.some((k) => accountKeys.includes(k));
    } catch {
      return false;
    }
  });
}

/** Campaign metadata for ids that came out of an aggregate, chunked. */
async function loadCampaignMeta(ids: string[]): Promise<CampaignMeta[]> {
  if (ids.length === 0) return [];
  const slices = await Promise.all(
    chunk(ids, DB_CHUNK).map((slice) =>
      prisma.emailBlast.findMany({ where: { id: { in: slice } }, select: CAMPAIGN_META_SELECT }),
    ),
  );
  return slices.flat();
}

/**
 * One row per campaign, newest first.
 *
 * With a range, the rows are exactly the campaigns that have a recipient in
 * the window — the same set the totals were summed from. Without one they are
 * the Blasts list's page of campaigns, which can include drafts with nothing
 * to report yet (zeros), because the list needs a row for everything it shows.
 */
async function buildCampaignRows(
  scope: EngagementScope,
  groups: Map<string, EngagementGroup>,
  preselected?: CampaignMeta[],
): Promise<CampaignEngagementRow[]> {
  const campaigns = preselected
    ?? (hasRange(scope) ? await loadCampaignMeta([...groups.keys()]) : await listPageCampaigns(scope));
  return campaigns
    .map((c) => toCampaignRow(c, groups.get(c.id)))
    .sort((a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0))
    .slice(0, CAMPAIGN_ROW_LIMIT);
}
