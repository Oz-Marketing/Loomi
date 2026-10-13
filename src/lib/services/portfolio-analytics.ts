// Cross-account aggregations for the management dashboard.
//
// Each function takes a (possibly null) list of allowed account keys
// + an optional date range, and returns a slice of data sized for one
// widget. All queries hit Postgres — no ESP round-trips. Designed to
// run in parallel from a single /api/dashboard/portfolio handler.
//
// Email figures come from lib/services/email-analytics.ts — the same
// recipients, the same rules (a bounce is a send; opens are unique and never
// machine opens; rates clamp at 100%) and the same date semantics as the
// Blasts list and the Reporting page. This file used to count raw events on
// its own: the open rate divided EVERY open event, repeats included, by
// deliveries, so a list with habitual re-openers read well over 100%.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { chunk, DB_CHUNK } from '@/lib/db/chunk';
import {
  aggregateEmailCohort,
  computeRatios,
  getEmailActivityByDay,
  rate,
  sumEngagementCounts,
} from '@/lib/services/email-analytics';

// Schema note: EmailBlast.accountKeys + SmsBlast.accountKeys are
// stored as a JSON string (not a relational column). SQL-side scoping
// would need a LIKE on the serialized array, so we instead fetch a
// scoped superset (status / date filters apply at SQL) and filter the
// accountKey membership in JS. Volume is fine for dashboard scale.

// ── Shared types ──

export interface PortfolioRange {
  start: Date | null;
  end: Date | null;
}

export interface PortfolioScope extends PortfolioRange {
  /** null = caller can see every account. */
  accountKeys: string[] | null;
}

function dateFilter(start: Date | null, end: Date | null): { gte?: Date; lte?: Date } | undefined {
  if (!start && !end) return undefined;
  const f: { gte?: Date; lte?: Date } = {};
  if (start) f.gte = start;
  if (end) f.lte = end;
  return f;
}

function parseAccountKeyJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    // fall through
  }
  return [];
}

function accountsOverlap(rowKeys: string[], scope: string[] | null): boolean {
  if (!scope || scope.length === 0) return true;
  return rowKeys.some((k) => scope.includes(k));
}

/** Recipient statuses that mean "SendGrid accepted it" — a bounce included. */
const DISPATCHED_STATUSES = ['sent', 'bounced'];

// ── Suppression counting ────────────────────────────────────────
//
// One opt-out is MANY rows. A bounce, complaint, unsubscribe or STOP — and a
// manual opt-out — is written at the account where it happened AND copied to
// every account grouped with it (sendgrid-events.ts, twilio-events.ts, the
// contact suppression route), so the whole group stops mailing that person.
// The copies are real suppressions for the accounts that hold them, but they
// are not growth there: counted as rows, one unsubscribe at one account read
// as a spike at every account in the group, and the portfolio total
// multiplied it by the size of the group.
//
// So "added" counts each opt-out ONCE, at the account where it started. The
// rows carry no origin, but the copies are written in the same burst as the
// original, so a row is a copy when another account's row for the same
// address was written at or just before it — within a minute, ties going to
// the lower id, which is the earlier write. An address suppressed at two
// accounts independently, minutes apart, still counts at both. Totals
// ("N suppressed") count distinct addresses, for the same reason.

const SUPPRESSION_TABLES = {
  // Fixed identifiers, never caller input.
  email: { table: Prisma.raw('"EmailSuppression"'), address: Prisma.raw('"email"') },
  sms: { table: Prisma.raw('"SmsSuppression"'), address: Prisma.raw('"phone"') },
} as const;

type SuppressionChannel = keyof typeof SUPPRESSION_TABLES;

/** Suppressions that started in scope and range, grouped by account or reason. */
export async function countOriginSuppressions(
  channel: SuppressionChannel,
  scope: PortfolioScope,
  by: 'account' | 'reason',
): Promise<Map<string, number>> {
  if (scope.accountKeys && scope.accountKeys.length === 0) return new Map();
  const { table, address } = SUPPRESSION_TABLES[channel];
  const groupCol = by === 'account' ? Prisma.raw('s."accountKey"') : Prisma.raw('s."reason"');
  const where: Prisma.Sql[] = [
    Prisma.sql`NOT EXISTS (
      SELECT 1
        FROM ${table} o
       WHERE o.${address} = s.${address}
         AND o."accountKey" <> s."accountKey"
         AND o."createdAt" >= s."createdAt" - INTERVAL '1 minute'
         AND (o."createdAt" < s."createdAt" OR (o."createdAt" = s."createdAt" AND o.id < s.id))
    )`,
  ];
  if (scope.accountKeys) where.push(Prisma.sql`s."accountKey" = ANY(${scope.accountKeys}::text[])`);
  if (scope.start) where.push(Prisma.sql`s."createdAt" >= ${scope.start}`);
  if (scope.end) where.push(Prisma.sql`s."createdAt" <= ${scope.end}`);
  const rows = await prisma.$queryRaw<Array<{ key: string; added: number | bigint }>>`
    SELECT ${groupCol} AS "key", COUNT(*)::int AS "added"
      FROM ${table} s
     WHERE ${Prisma.join(where, ' AND ')}
     GROUP BY 1
  `;
  return new Map(rows.map((r) => [r.key, Number(r.added) || 0]));
}

/** Distinct suppressed addresses in scope — a group-wide opt-out is one. */
async function countSuppressedAddresses(
  channel: SuppressionChannel,
  accountKeys: string[] | null,
): Promise<number> {
  if (accountKeys && accountKeys.length === 0) return 0;
  const { table, address } = SUPPRESSION_TABLES[channel];
  const where = accountKeys
    ? Prisma.sql`WHERE "accountKey" = ANY(${accountKeys}::text[])`
    : Prisma.empty;
  const [row] = await prisma.$queryRaw<Array<{ n: number | bigint }>>`
    SELECT COUNT(DISTINCT ${address})::int AS "n" FROM ${table} ${where}
  `;
  return Number(row?.n) || 0;
}

function sumValues(map: Map<string, number>): number {
  let total = 0;
  for (const v of map.values()) total += v;
  return total;
}

// ── Portfolio KPIs ──────────────────────────────────────────────

export interface PortfolioKpis {
  accountsTotal: number;
  accountsActive: number; // had at least one send in the range
  contactsTotal: number;
  contactsAdded: number; // dateAdded inside range
  emailsSent: number;
  smsSent: number;
  emailDelivered: number;
  emailOpens: number;
  emailClicks: number;
  emailBounces: number;
  emailSpamReports: number;
  emailUnsubscribes: number;
  smsDelivered: number;
  smsFailed: number;
  smsStops: number;
  emailDeliveryRate: number;
  emailOpenRate: number;
  emailClickRate: number;
  emailBounceRate: number;
  emailSpamRate: number;
  smsDeliveryRate: number;
  suppressionsAdded: number; // email + sms suppression rows created in range
}

export async function getPortfolioKpis(scope: PortfolioScope): Promise<PortfolioKpis> {
  const { start, end } = scope;
  const range = dateFilter(start, end);

  // Pull account list once so we know which keys are in scope and how
  // many accounts the user can see in total.
  const accounts = await prisma.account.findMany({
    where: {
      key: { not: { startsWith: '\\_' } },
      ...(scope.accountKeys ? { key: { in: scope.accountKeys } } : {}),
    },
    select: { key: true },
  });
  const accountsTotal = accounts.length;
  const accountKeys = accounts.map((a) => a.key);

  const contactsTotal = await prisma.contact.count({
    where: { accountKey: { in: accountKeys } },
  });
  const contactsAdded = await prisma.contact.count({
    where: {
      accountKey: { in: accountKeys },
      ...(range ? { dateAdded: range } : {}),
    },
  });

  // Email: every count from the shared recipient aggregate — see the file
  // header. Sent includes bounces; opens and clicks are unique recipients.
  const email = computeRatios(
    sumEngagementCounts(
      await aggregateEmailCohort({ accountKeys, start, end, source: 'all' }, 'account'),
    ),
  );
  const emailsSent = email.sent;
  const emailDelivered = email.delivered;
  const emailOpens = email.uniqueOpens;
  const emailClicks = email.uniqueClicks;
  const emailBounces = email.bounces;
  const emailSpamReports = email.spamReports;
  const emailUnsubscribes = email.unsubscribes;

  // SMS: same shape, status = 'sent' or 'delivered' counts as sent.
  const smsSent = await prisma.smsBlastRecipient.count({
    where: {
      accountKey: { in: accountKeys },
      status: { in: ['sent', 'delivered'] },
      ...(range ? { sentAt: range } : {}),
    },
  });

  // SMS event aggregates.
  const smsEventGroups = await prisma.smsEvent.groupBy({
    by: ['eventType'],
    where: {
      accountKey: { in: accountKeys },
      ...(range ? { timestamp: range } : {}),
    },
    _count: { _all: true },
  });
  const smsEventCount = new Map(smsEventGroups.map((g) => [g.eventType, g._count._all]));
  const smsDelivered = smsEventCount.get('delivered') || 0;
  const smsFailed = (smsEventCount.get('failed') || 0) + (smsEventCount.get('undelivered') || 0);
  const smsStops = (smsEventCount.get('stop') || 0) + (smsEventCount.get('unsub') || 0);

  // Suppressions added in range (email + sms), each opt-out once — not once
  // per account its group-wide copies landed on. See "Suppression counting".
  const suppressionScope = { accountKeys, start, end };
  const [emailSuppressionsAdded, smsSuppressionsAdded] = await Promise.all([
    countOriginSuppressions('email', suppressionScope, 'account').then(sumValues),
    countOriginSuppressions('sms', suppressionScope, 'account').then(sumValues),
  ]);

  // Active accounts = accounts that had at least one recipient row
  // (sent or otherwise) in the period.
  const activeAccountsRaw = await prisma.emailBlastRecipient.groupBy({
    by: ['accountKey'],
    where: {
      accountKey: { in: accountKeys },
      ...(range ? { createdAt: range } : {}),
    },
    _count: { _all: true },
  });
  const activeAccountSet = new Set(activeAccountsRaw.map((r) => r.accountKey));
  const activeSmsAccounts = await prisma.smsBlastRecipient.groupBy({
    by: ['accountKey'],
    where: {
      accountKey: { in: accountKeys },
      ...(range ? { createdAt: range } : {}),
    },
    _count: { _all: true },
  });
  for (const r of activeSmsAccounts) activeAccountSet.add(r.accountKey);
  const accountsActive = activeAccountSet.size;

  return {
    accountsTotal,
    accountsActive,
    contactsTotal,
    contactsAdded,
    emailsSent,
    smsSent,
    emailDelivered,
    emailOpens,
    emailClicks,
    emailBounces,
    emailSpamReports,
    emailUnsubscribes,
    smsDelivered,
    smsFailed,
    smsStops,
    emailDeliveryRate: email.deliveryRate,
    emailOpenRate: email.openRate,
    emailClickRate: email.clickRate,
    emailBounceRate: email.bounceRate,
    emailSpamRate: rate(emailSpamReports, emailDelivered),
    smsDeliveryRate: rate(smsDelivered, smsSent),
    suppressionsAdded: emailSuppressionsAdded + smsSuppressionsAdded,
  };
}

// ── Engagement timeline (multi-account daily series) ────────────

export interface EngagementTimelinePoint {
  date: string; // YYYY-MM-DD
  emailDelivered: number;
  emailOpens: number;
  emailClicks: number;
  emailBounces: number;
  smsDelivered: number;
}

export async function getEngagementTimeline(scope: PortfolioScope): Promise<EngagementTimelinePoint[]> {
  const { start, end, accountKeys } = scope;

  // Both channels are bucketed by day in SQL. This used to pull up to 100,000
  // raw events per channel into memory, in no particular order, and count them
  // in JS — so a busy portfolio's chart was silently truncated, and the read
  // itself was a memory risk on a 2GB server. Email days follow the shared
  // rules (distinct recipients; only real opens); see email-analytics.ts.
  const [emailDays, smsDays] = await Promise.all([
    getEmailActivityByDay({ accountKeys, start, end, source: 'all' }),
    smsDeliveredByDay(scope),
  ]);

  const buckets = new Map<string, EngagementTimelinePoint>();
  function bucket(day: string): EngagementTimelinePoint {
    let b = buckets.get(day);
    if (!b) {
      b = { date: day, emailDelivered: 0, emailOpens: 0, emailClicks: 0, emailBounces: 0, smsDelivered: 0 };
      buckets.set(day, b);
    }
    return b;
  }

  for (const day of emailDays) {
    const b = bucket(day.date);
    b.emailDelivered = day.delivered;
    b.emailOpens = day.opens;
    b.emailClicks = day.clicks;
    b.emailBounces = day.bounces;
  }
  for (const [day, delivered] of smsDays) {
    bucket(day).smsDelivered = delivered;
  }

  // Fill gaps so the line chart has a continuous x-axis.
  const series: EngagementTimelinePoint[] = [];
  const from = start
    ? new Date(start.toISOString().slice(0, 10))
    : earliestDate(buckets);
  const to = end ? new Date(end.toISOString().slice(0, 10)) : new Date();
  if (!from) return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));

  for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    series.push(
      buckets.get(day) || {
        date: day,
        emailDelivered: 0,
        emailOpens: 0,
        emailClicks: 0,
        emailBounces: 0,
        smsDelivered: 0,
      },
    );
  }
  return series;
}

/** SMS delivered events per UTC day, counted in SQL. */
async function smsDeliveredByDay(scope: PortfolioScope): Promise<Map<string, number>> {
  if (scope.accountKeys && scope.accountKeys.length === 0) return new Map();
  const where: Prisma.Sql[] = [Prisma.sql`"eventType" = 'delivered'`];
  if (scope.accountKeys) where.push(Prisma.sql`"accountKey" = ANY(${scope.accountKeys}::text[])`);
  if (scope.start) where.push(Prisma.sql`"timestamp" >= ${scope.start}`);
  if (scope.end) where.push(Prisma.sql`"timestamp" <= ${scope.end}`);
  const rows = await prisma.$queryRaw<Array<{ date: string; delivered: number | bigint }>>`
    SELECT to_char("timestamp", 'YYYY-MM-DD') AS "date", COUNT(*)::int AS "delivered"
      FROM "SmsEvent"
     WHERE ${Prisma.join(where, ' AND ')}
     GROUP BY 1
  `;
  return new Map(rows.map((r) => [String(r.date), Number(r.delivered) || 0]));
}

function earliestDate(map: Map<string, unknown>): Date | null {
  let earliest: string | null = null;
  for (const key of map.keys()) {
    if (!earliest || key < earliest) earliest = key;
  }
  return earliest ? new Date(earliest) : null;
}

// ── Engaged contacts (opened/clicked email or replied SMS in window) ─

export interface EngagedContactsResult {
  windowDays: number;
  engagedTotal: number; // distinct contact ids
  engagedByAccount: Array<{ accountKey: string; dealer: string; engagedCount: number; totalCount: number; rate: number }>;
}

export async function getEngagedContacts(
  scope: { accountKeys: string[] | null },
  windowDays: number,
): Promise<EngagedContactsResult> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  if (scope.accountKeys && scope.accountKeys.length === 0) {
    return { windowDays, engagedTotal: 0, engagedByAccount: [] };
  }
  const accountKeyWhere = scope.accountKeys && scope.accountKeys.length > 0 ? { accountKey: { in: scope.accountKeys } } : {};

  // Distinct contacts per account who opened or clicked an email, or replied
  // to a text (eventType = received), since `since` — deduped across both
  // channels, and counted in SQL. This used to load every engaged recipient
  // id into memory and look them all up in one IN list, which breaks
  // outright past Postgres's 65,535 bind parameters: a single large blast
  // with a healthy open rate gets there now that blasts are uncapped.
  // Events with no recipient (e.g. transactional traffic) can't join and are
  // excluded, as before. Only eventType 'open' is an open — never a
  // 'machine_open'.
  const scoped = (alias: 'r' | 'e') =>
    scope.accountKeys
      ? Prisma.sql`AND ${Prisma.raw(alias)}."accountKey" = ANY(${scope.accountKeys}::text[])`
      : Prisma.empty;
  const engagedRows = await prisma.$queryRaw<Array<{ accountKey: string; engaged: number | bigint }>>`
    SELECT u."accountKey" AS "accountKey", COUNT(DISTINCT u."contactId")::int AS "engaged"
      FROM (
        SELECT r."accountKey", r."contactId"
          FROM "EmailEvent" e
          JOIN "EmailCampaignRecipient" r ON r.id = e."recipientId"
         WHERE e."eventType" IN ('open', 'click')
           AND e."timestamp" >= ${since}
           ${scoped('e')}
           ${scoped('r')}
        UNION
        SELECT r."accountKey", r."contactId"
          FROM "SmsEvent" e
          JOIN "SmsCampaignRecipient" r ON r.id = e."recipientId"
         WHERE e."eventType" = 'received'
           AND e."timestamp" >= ${since}
           ${scoped('e')}
           ${scoped('r')}
      ) u
     GROUP BY u."accountKey"
  `;
  const engagedByKey = new Map(engagedRows.map((r) => [r.accountKey, Number(r.engaged) || 0]));

  const totalContacts = await prisma.contact.groupBy({
    by: ['accountKey'],
    where: accountKeyWhere,
    _count: { _all: true },
  });
  const totalByAccount = new Map(totalContacts.map((r) => [r.accountKey, r._count._all]));

  const accountMeta = await prisma.account.findMany({
    where: { key: { not: { startsWith: '\\_' } }, ...(scope.accountKeys ? { key: { in: scope.accountKeys } } : {}) },
    select: { key: true, dealer: true },
  });
  const dealerByAccount = new Map(accountMeta.map((a) => [a.key, a.dealer]));

  let engagedTotal = 0;
  const engagedByAccount: EngagedContactsResult['engagedByAccount'] = [];
  for (const a of accountMeta) {
    const engagedCount = engagedByKey.get(a.key) || 0;
    const totalCount = totalByAccount.get(a.key) || 0;
    engagedTotal += engagedCount;
    engagedByAccount.push({
      accountKey: a.key,
      dealer: dealerByAccount.get(a.key) || a.key,
      engagedCount,
      totalCount,
      rate: totalCount > 0 ? engagedCount / totalCount : 0,
    });
  }
  engagedByAccount.sort((a, b) => b.engagedCount - a.engagedCount);

  return { windowDays, engagedTotal, engagedByAccount };
}

// ── Lifecycle alerts (service / lease / warranty due) ───────────

export interface LifecycleAlertsResult {
  service: { dueIn30: number; dueIn60: number; dueIn90: number; byAccount: Array<{ accountKey: string; dealer: string; dueIn30: number; dueIn60: number; dueIn90: number }> };
  lease: { endingIn30: number; endingIn60: number; endingIn90: number; byAccount: Array<{ accountKey: string; dealer: string; endingIn30: number; endingIn60: number; endingIn90: number }> };
  warranty: { expiringIn30: number; expiringIn60: number; expiringIn90: number; byAccount: Array<{ accountKey: string; dealer: string; expiringIn30: number; expiringIn60: number; expiringIn90: number }> };
}

export async function getLifecycleAlerts(scope: { accountKeys: string[] | null }): Promise<LifecycleAlertsResult> {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const in60 = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const in90 = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const accountKeyWhere = scope.accountKeys && scope.accountKeys.length > 0 ? { accountKey: { in: scope.accountKeys } } : {};
  const accounts = await prisma.account.findMany({
    where: { key: { not: { startsWith: '\\_' } }, ...(scope.accountKeys ? { key: { in: scope.accountKeys } } : {}) },
    select: { key: true, dealer: true },
  });
  const dealerByAccount = new Map(accounts.map((a) => [a.key, a.dealer]));

  async function bucketCounts(field: 'nextServiceDate' | 'leaseEndDate' | 'warrantyEndDate') {
    const [in30Rows, in60Rows, in90Rows] = await Promise.all([
      prisma.contact.groupBy({
        by: ['accountKey'],
        where: { ...accountKeyWhere, [field]: { gte: now, lte: in30 } },
        _count: { _all: true },
      }),
      prisma.contact.groupBy({
        by: ['accountKey'],
        where: { ...accountKeyWhere, [field]: { gte: now, lte: in60 } },
        _count: { _all: true },
      }),
      prisma.contact.groupBy({
        by: ['accountKey'],
        where: { ...accountKeyWhere, [field]: { gte: now, lte: in90 } },
        _count: { _all: true },
      }),
    ]);

    const by30 = new Map(in30Rows.map((r) => [r.accountKey, r._count._all]));
    const by60 = new Map(in60Rows.map((r) => [r.accountKey, r._count._all]));
    const by90 = new Map(in90Rows.map((r) => [r.accountKey, r._count._all]));

    let total30 = 0;
    let total60 = 0;
    let total90 = 0;
    const byAccount: Array<{ accountKey: string; dealer: string; dueIn30: number; dueIn60: number; dueIn90: number }> = [];
    for (const a of accounts) {
      const c30 = by30.get(a.key) || 0;
      const c60 = by60.get(a.key) || 0;
      const c90 = by90.get(a.key) || 0;
      total30 += c30;
      total60 += c60;
      total90 += c90;
      if (c90 > 0) {
        byAccount.push({
          accountKey: a.key,
          dealer: dealerByAccount.get(a.key) || a.key,
          dueIn30: c30,
          dueIn60: c60,
          dueIn90: c90,
        });
      }
    }
    byAccount.sort((a, b) => b.dueIn30 - a.dueIn30 || b.dueIn90 - a.dueIn90);
    return { total30, total60, total90, byAccount };
  }

  const service = await bucketCounts('nextServiceDate');
  const lease = await bucketCounts('leaseEndDate');
  const warranty = await bucketCounts('warrantyEndDate');

  return {
    service: {
      dueIn30: service.total30,
      dueIn60: service.total60,
      dueIn90: service.total90,
      byAccount: service.byAccount,
    },
    lease: {
      endingIn30: lease.total30,
      endingIn60: lease.total60,
      endingIn90: lease.total90,
      byAccount: lease.byAccount.map((r) => ({
        accountKey: r.accountKey,
        dealer: r.dealer,
        endingIn30: r.dueIn30,
        endingIn60: r.dueIn60,
        endingIn90: r.dueIn90,
      })),
    },
    warranty: {
      expiringIn30: warranty.total30,
      expiringIn60: warranty.total60,
      expiringIn90: warranty.total90,
      byAccount: warranty.byAccount.map((r) => ({
        accountKey: r.accountKey,
        dealer: r.dealer,
        expiringIn30: r.dueIn30,
        expiringIn60: r.dueIn60,
        expiringIn90: r.dueIn90,
      })),
    },
  };
}

// ── Send pipeline ───────────────────────────────────────────────

export interface PipelineCampaign {
  id: string;
  channel: 'email' | 'sms';
  name: string;
  status: string;
  scheduledFor: string | null;
  startedAt: string | null;
  completedAt: string | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  accountKeys: string[];
  error: string | null;
  updatedAt: string;
}

export interface SendPipelineResult {
  scheduled: PipelineCampaign[];
  inFlight: PipelineCampaign[];
  recentlyFailed: PipelineCampaign[];
}

export async function getSendPipeline(scope: { accountKeys: string[] | null }): Promise<SendPipelineResult> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [emailBlasts, smsBlasts] = await Promise.all([
    prisma.emailBlast.findMany({
      where: {
        OR: [
          { status: { in: ['scheduled', 'processing', 'queued'] } },
          { status: 'failed', updatedAt: { gte: sevenDaysAgo } },
        ],
      },
      orderBy: { scheduledFor: 'asc' },
      take: 200,
    }),
    prisma.smsBlast.findMany({
      where: {
        OR: [
          { status: { in: ['scheduled', 'processing', 'queued'] } },
          { status: 'failed', updatedAt: { gte: sevenDaysAgo } },
        ],
      },
      orderBy: { scheduledFor: 'asc' },
      take: 200,
    }),
  ]);

  const mapEmail = (c: typeof emailBlasts[number]): PipelineCampaign => ({
    id: c.id,
    channel: 'email',
    name: c.name || c.subject || 'Untitled campaign',
    status: c.status,
    scheduledFor: c.scheduledFor?.toISOString() || null,
    startedAt: c.startedAt?.toISOString() || null,
    completedAt: c.completedAt?.toISOString() || null,
    totalRecipients: c.totalRecipients,
    sentCount: c.sentCount,
    failedCount: c.failedCount,
    accountKeys: parseAccountKeyJson(c.accountKeys),
    error: c.error,
    updatedAt: c.updatedAt.toISOString(),
  });
  const mapSms = (c: typeof smsBlasts[number]): PipelineCampaign => ({
    id: c.id,
    channel: 'sms',
    name: c.name || 'Untitled SMS',
    status: c.status,
    scheduledFor: c.scheduledFor?.toISOString() || null,
    startedAt: c.startedAt?.toISOString() || null,
    completedAt: c.completedAt?.toISOString() || null,
    totalRecipients: c.totalRecipients,
    sentCount: c.sentCount,
    failedCount: c.failedCount,
    accountKeys: parseAccountKeyJson(c.accountKeys),
    error: c.error,
    updatedAt: c.updatedAt.toISOString(),
  });

  const merged: PipelineCampaign[] = [
    ...emailBlasts.map(mapEmail),
    ...smsBlasts.map(mapSms),
  ].filter((c) => accountsOverlap(c.accountKeys, scope.accountKeys));

  const scheduled = merged
    .filter((c) => c.status === 'scheduled' || c.status === 'queued')
    .sort((a, b) => (a.scheduledFor || '').localeCompare(b.scheduledFor || ''));
  const inFlight = merged
    .filter((c) => c.status === 'processing')
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  const recentlyFailed = merged
    .filter((c) => c.status === 'failed')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return { scheduled, inFlight, recentlyFailed };
}

// ── Account health ──────────────────────────────────────────────

export interface AccountHealthRow {
  accountKey: string;
  dealer: string;
  contactCount: number;
  sentInPeriod: number;
  deliveredInPeriod: number;
  opensInPeriod: number;
  clicksInPeriod: number;
  bouncesInPeriod: number;
  openRate: number;
  clickRate: number;
  bounceRate: number;
  suppressionGrowth: number;
  lastSentAt: string | null;
  daysSinceLastSend: number | null;
  healthScore: number; // 0–100
}

export async function getAccountHealth(scope: PortfolioScope): Promise<AccountHealthRow[]> {
  const { start, end, accountKeys } = scope;

  const accounts = await prisma.account.findMany({
    where: { key: { not: { startsWith: '\\_' } }, ...(accountKeys ? { key: { in: accountKeys } } : {}) },
    select: { key: true, dealer: true },
  });
  const allowedKeys = accounts.map((a) => a.key);
  if (allowedKeys.length === 0) return [];

  const [contactCounts, emailGroups, suppressionByKey, lastSentRows] =
    await Promise.all([
      prisma.contact.groupBy({
        by: ['accountKey'],
        where: { accountKey: { in: allowedKeys } },
        _count: { _all: true },
      }),
      // Sent/delivered/opens/clicks/bounces per account, by the shared rules.
      // `opensInPeriod` is UNIQUE opens: dividing every open event by
      // deliveries is what let this read over 100%.
      aggregateEmailCohort({ accountKeys: allowedKeys, start, end, source: 'all' }, 'account'),
      // Opt-outs that STARTED at each account — a group-wide copy is not this
      // account's growth. See "Suppression counting".
      countOriginSuppressions('email', { accountKeys: allowedKeys, start, end }, 'account'),
      prisma.emailBlastRecipient.groupBy({
        by: ['accountKey'],
        where: { accountKey: { in: allowedKeys }, status: { in: DISPATCHED_STATUSES } },
        _max: { sentAt: true },
      }),
    ]);

  const contactsByKey = new Map(contactCounts.map((r) => [r.accountKey, r._count._all]));
  const emailByKey = new Map(emailGroups.map((g) => [g.key, g]));
  const lastSentByKey = new Map(
    lastSentRows.map((r) => [r.accountKey, r._max.sentAt?.getTime() ?? null]),
  );

  const now = Date.now();

  const rows: AccountHealthRow[] = accounts.map((a) => {
    const email = emailByKey.get(a.key);
    const sent = email?.sent ?? 0;
    const delivered = email?.delivered ?? 0;
    const opens = email?.uniqueOpens ?? 0;
    const clicks = email?.uniqueClicks ?? 0;
    const bounces = email?.bounces ?? 0;
    const lastSentMs = lastSentByKey.get(a.key) ?? null;
    const daysSinceLastSend = lastSentMs ? Math.floor((now - lastSentMs) / (24 * 60 * 60 * 1000)) : null;
    const openRate = rate(opens, delivered);
    const clickRate = rate(clicks, delivered);
    const bounceRate = rate(bounces, sent);
    const healthScore = computeHealthScore({
      sent,
      openRate,
      clickRate,
      bounceRate,
      daysSinceLastSend,
      suppressionGrowth: suppressionByKey.get(a.key) || 0,
      contactCount: contactsByKey.get(a.key) || 0,
    });
    return {
      accountKey: a.key,
      dealer: a.dealer,
      contactCount: contactsByKey.get(a.key) || 0,
      sentInPeriod: sent,
      deliveredInPeriod: delivered,
      opensInPeriod: opens,
      clicksInPeriod: clicks,
      bouncesInPeriod: bounces,
      openRate,
      clickRate,
      bounceRate,
      suppressionGrowth: suppressionByKey.get(a.key) || 0,
      lastSentAt: lastSentMs ? new Date(lastSentMs).toISOString() : null,
      daysSinceLastSend,
      healthScore,
    };
  });

  rows.sort((a, b) => b.healthScore - a.healthScore || b.contactCount - a.contactCount);
  return rows;
}

function computeHealthScore(input: {
  sent: number;
  openRate: number;
  clickRate: number;
  bounceRate: number;
  daysSinceLastSend: number | null;
  suppressionGrowth: number;
  contactCount: number;
}): number {
  // Heuristic 0–100 score. Weights chosen to surface accounts that are
  // simultaneously dormant + low engagement + high bounce.
  let score = 50;
  if (input.contactCount === 0) return 0;

  // Send recency
  if (input.daysSinceLastSend === null) score -= 20;
  else if (input.daysSinceLastSend > 60) score -= 18;
  else if (input.daysSinceLastSend > 30) score -= 8;
  else if (input.daysSinceLastSend <= 7) score += 8;
  else if (input.daysSinceLastSend <= 14) score += 4;

  // Engagement quality (industry-ish benchmarks: 20% open, 2.5% click).
  if (input.sent > 0) {
    score += Math.min(20, (input.openRate / 0.20) * 18);
    score += Math.min(15, (input.clickRate / 0.025) * 12);
  }

  // Deliverability
  if (input.bounceRate > 0.05) score -= 25;
  else if (input.bounceRate > 0.02) score -= 10;
  else if (input.bounceRate > 0 && input.bounceRate <= 0.01) score += 4;

  // Suppression growth penalty (only material if relative spike)
  if (input.suppressionGrowth > Math.max(50, input.contactCount * 0.05)) score -= 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── Anomaly feed ────────────────────────────────────────────────

export type AnomalySeverity = 'info' | 'warning' | 'critical';

export interface AnomalyAlert {
  id: string;
  severity: AnomalySeverity;
  title: string;
  detail: string;
  accountKey: string;
  dealer: string;
  href?: string;
  timestamp: string;
}

export async function getAnomalies(scope: { accountKeys: string[] | null }): Promise<AnomalyAlert[]> {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const accountKeyWhere = scope.accountKeys && scope.accountKeys.length > 0 ? { accountKey: { in: scope.accountKeys } } : {};
  const accounts = await prisma.account.findMany({
    where: { key: { not: { startsWith: '\\_' } }, ...(scope.accountKeys ? { key: { in: scope.accountKeys } } : {}) },
    select: { key: true, dealer: true, slug: true },
  });
  const dealerByAccount = new Map(accounts.map((a) => [a.key, a.dealer]));
  const slugByAccount = new Map(accounts.map((a) => [a.key, a.slug]));
  const accountHref = (key: string): string | undefined => {
    const slug = slugByAccount.get(key);
    return slug ? `/subaccount/${slug}/dashboard` : undefined;
  };

  const alerts: AnomalyAlert[] = [];

  // 1. Bounce rate spikes (last 7d > 5% on >= 50 sends). Bounced recipients
  //    over dispatched recipients from the same 7 days — the same rule as
  //    every other bounce rate. It used to divide bounce EVENTS (drops
  //    missed) by 'sent' rows (bounces missing), which overstated the rate.
  const last7d = await aggregateEmailCohort(
    { accountKeys: scope.accountKeys, start: sevenDaysAgo, end: null, source: 'all' },
    'account',
  );
  for (const { key, sent, bounces } of last7d) {
    if (sent < 50) continue;
    const bounceRate = rate(bounces, sent);
    if (bounceRate >= 0.05) {
      alerts.push({
        id: `bounce-spike-${key}`,
        severity: 'critical',
        title: 'Bounce rate spike',
        detail: `${(bounceRate * 100).toFixed(1)}% bounces on ${sent.toLocaleString()} sends (7d).`,
        accountKey: key,
        dealer: dealerByAccount.get(key) || key,
        href: accountHref(key),
        timestamp: new Date().toISOString(),
      });
    } else if (bounceRate >= 0.02) {
      alerts.push({
        id: `bounce-elevated-${key}`,
        severity: 'warning',
        title: 'Elevated bounce rate',
        detail: `${(bounceRate * 100).toFixed(1)}% bounces on ${sent.toLocaleString()} sends (7d).`,
        accountKey: key,
        dealer: dealerByAccount.get(key) || key,
        href: accountHref(key),
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 2. Spam complaint signals (any in 30d is worth surfacing).
  const spamReportsByAccount = await prisma.emailEvent.groupBy({
    by: ['accountKey'],
    where: { ...accountKeyWhere, eventType: 'spamreport', timestamp: { gte: thirtyDaysAgo } },
    _count: { _all: true },
  });
  for (const r of spamReportsByAccount) {
    if (!r.accountKey || r._count._all === 0) continue;
    alerts.push({
      id: `spam-${r.accountKey}`,
      severity: r._count._all >= 3 ? 'critical' : 'warning',
      title: 'Spam complaints',
      detail: `${r._count._all} spam complaint${r._count._all === 1 ? '' : 's'} in the last 30 days.`,
      accountKey: r.accountKey,
      dealer: dealerByAccount.get(r.accountKey) || r.accountKey,
      href: accountHref(r.accountKey),
      timestamp: new Date().toISOString(),
    });
  }

  // 3. Dormant accounts (have contacts but no send in 30d).
  const lastSendByAccount = await prisma.emailBlastRecipient.groupBy({
    by: ['accountKey'],
    where: { ...accountKeyWhere, status: { in: DISPATCHED_STATUSES } },
    _max: { sentAt: true },
  });
  const lastSendMap = new Map(lastSendByAccount.map((r) => [r.accountKey, r._max.sentAt?.getTime() ?? null]));
  const contactCounts = await prisma.contact.groupBy({
    by: ['accountKey'],
    where: accountKeyWhere,
    _count: { _all: true },
  });
  for (const r of contactCounts) {
    if (r._count._all < 50) continue;
    const last = lastSendMap.get(r.accountKey);
    if (last === undefined || last === null) {
      alerts.push({
        id: `dormant-never-${r.accountKey}`,
        severity: 'warning',
        title: 'No sends yet',
        detail: `${r._count._all.toLocaleString()} contacts and no campaigns have been sent.`,
        accountKey: r.accountKey,
        dealer: dealerByAccount.get(r.accountKey) || r.accountKey,
        href: accountHref(r.accountKey),
        timestamp: new Date().toISOString(),
      });
      continue;
    }
    const daysSince = Math.floor((now - last) / (24 * 60 * 60 * 1000));
    if (daysSince >= 30) {
      alerts.push({
        id: `dormant-${r.accountKey}`,
        severity: daysSince >= 60 ? 'warning' : 'info',
        title: 'Dormant account',
        detail: `No sends in ${daysSince} days (${r._count._all.toLocaleString()} contacts).`,
        accountKey: r.accountKey,
        dealer: dealerByAccount.get(r.accountKey) || r.accountKey,
        href: accountHref(r.accountKey),
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 4. Recent failed campaigns (in scope).
  const failedCampaigns = await prisma.emailBlast.findMany({
    where: { status: 'failed', updatedAt: { gte: sevenDaysAgo } },
    orderBy: { updatedAt: 'desc' },
    take: 30,
  });
  for (const c of failedCampaigns) {
    const keys = parseAccountKeyJson(c.accountKeys);
    if (!accountsOverlap(keys, scope.accountKeys)) continue;
    const primaryKey = keys[0] || '';
    alerts.push({
      id: `failed-${c.id}`,
      severity: 'critical',
      title: 'Campaign failed',
      detail: c.error ? `${c.name || c.subject}: ${c.error.slice(0, 120)}` : `${c.name || c.subject} did not complete.`,
      accountKey: primaryKey,
      dealer: primaryKey ? (dealerByAccount.get(primaryKey) || primaryKey) : 'Portfolio',
      href: '/messaging/blasts',
      timestamp: c.updatedAt.toISOString(),
    });
  }

  // 5. Suppression growth (>5% of contact base in 7d or >= 100 raw). Counted
  //    where each opt-out started, so one group-wide unsubscribe doesn't
  //    raise this alert at every account in the group.
  const suppressionsLast7d = await countOriginSuppressions(
    'email',
    { accountKeys: scope.accountKeys, start: sevenDaysAgo, end: null },
    'account',
  );
  const contactsByKey = new Map(contactCounts.map((r) => [r.accountKey, r._count._all]));
  for (const [accountKey, added] of suppressionsLast7d) {
    const total = contactsByKey.get(accountKey) || 0;
    if (total === 0) continue;
    const pct = added / total;
    if (pct >= 0.05 || added >= 100) {
      alerts.push({
        id: `suppression-growth-${accountKey}`,
        severity: pct >= 0.1 ? 'critical' : 'warning',
        title: 'Suppression list growing fast',
        detail: `${added.toLocaleString()} new suppressions in 7d (${(pct * 100).toFixed(1)}% of list).`,
        accountKey,
        dealer: dealerByAccount.get(accountKey) || accountKey,
        href: '/settings/email-texts?section=suppressions',
        timestamp: new Date().toISOString(),
      });
    }
  }

  const order: Record<AnomalySeverity, number> = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => order[a.severity] - order[b.severity] || b.timestamp.localeCompare(a.timestamp));
  return alerts;
}

// ── Top campaigns ───────────────────────────────────────────────

export interface TopCampaignRow {
  campaignId: string;
  campaignName: string;
  channel: 'email';
  accountKeys: string[];
  sent: number;
  delivered: number;
  uniqueOpens: number;
  uniqueClicks: number;
  openRate: number;
  clickRate: number;
  sentAt: string | null;
}

export async function getTopCampaigns(scope: PortfolioScope, limit = 5): Promise<TopCampaignRow[]> {
  const { start, end, accountKeys } = scope;

  // The same per-campaign numbers as the Blasts list and the Reporting page:
  // recipients in scope, sent in the window, one-off blasts only (a flow step
  // is not a campaign to rank). This used to pick blasts by date, count only
  // 'sent' rows as sent, count raw delivered events, and load every distinct
  // opener and clicker of up to 250 blasts into memory to count them.
  const groups = (
    await aggregateEmailCohort({ accountKeys, start, end, source: 'blasts' }, 'campaign')
  ).filter((g) => g.sent >= 25); // only rank campaigns with meaningful denominator
  if (groups.length === 0) return [];

  const campaigns = (
    await Promise.all(
      chunk(groups.map((g) => g.key), DB_CHUNK).map((ids) =>
        prisma.emailBlast.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            name: true,
            subject: true,
            accountKeys: true,
            scheduledFor: true,
            startedAt: true,
            completedAt: true,
          },
        }),
      ),
    )
  ).flat();
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));

  const rows: TopCampaignRow[] = groups.flatMap((g) => {
    const c = campaignById.get(g.key);
    if (!c) return [];
    const sentAt = c.completedAt || c.startedAt || c.scheduledFor || g.lastSentAt;
    return [
      {
        campaignId: c.id,
        campaignName: c.name || c.subject || 'Untitled campaign',
        channel: 'email' as const,
        accountKeys: parseAccountKeyJson(c.accountKeys),
        sent: g.sent,
        delivered: g.delivered,
        uniqueOpens: g.uniqueOpens,
        uniqueClicks: g.uniqueClicks,
        openRate: rate(g.uniqueOpens, g.delivered),
        clickRate: rate(g.uniqueClicks, g.delivered),
        sentAt: sentAt ? sentAt.toISOString() : null,
      },
    ];
  });

  rows.sort((a, b) => b.clickRate - a.clickRate || b.openRate - a.openRate);
  return rows.slice(0, limit);
}

// ── Recent activity ─────────────────────────────────────────────

export interface ActivityEntry {
  id: string;
  kind: 'campaign-launched' | 'campaign-scheduled' | 'campaign-failed' | 'list-created' | 'contact-imported';
  title: string;
  detail: string;
  accountKey: string;
  dealer: string;
  timestamp: string;
}

export async function getRecentActivity(scope: { accountKeys: string[] | null }, limit = 20): Promise<ActivityEntry[]> {
  const accounts = await prisma.account.findMany({
    where: { key: { not: { startsWith: '\\_' } }, ...(scope.accountKeys ? { key: { in: scope.accountKeys } } : {}) },
    select: { key: true, dealer: true },
  });
  const dealerByAccount = new Map(accounts.map((a) => [a.key, a.dealer]));

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [emailBlasts, smsBlasts, lists] = await Promise.all([
    prisma.emailBlast.findMany({
      where: { OR: [{ startedAt: { gte: sevenDaysAgo } }, { scheduledFor: { gte: sevenDaysAgo } }, { updatedAt: { gte: sevenDaysAgo } }] },
      orderBy: { updatedAt: 'desc' },
      take: 80,
    }),
    prisma.smsBlast.findMany({
      where: { OR: [{ startedAt: { gte: sevenDaysAgo } }, { scheduledFor: { gte: sevenDaysAgo } }, { updatedAt: { gte: sevenDaysAgo } }] },
      orderBy: { updatedAt: 'desc' },
      take: 80,
    }),
    prisma.contactList.findMany({
      where: {
        createdAt: { gte: sevenDaysAgo },
        ...(scope.accountKeys ? { accountKey: { in: scope.accountKeys } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, name: true, accountKey: true, createdAt: true },
    }),
  ]);

  const entries: ActivityEntry[] = [];

  for (const c of emailBlasts) {
    const keys = parseAccountKeyJson(c.accountKeys);
    if (!accountsOverlap(keys, scope.accountKeys)) continue;
    const primaryKey = keys[0] || '';
    const dealer = primaryKey ? dealerByAccount.get(primaryKey) || primaryKey : 'Portfolio';
    if (c.status === 'completed' && c.completedAt) {
      // `sentCount` is the rows still 'sent' — the webhook moves a bounce out
      // of it — so a bounce is added back to say how many went out. It never
      // was a delivered count.
      entries.push({
        id: `email-completed-${c.id}`,
        kind: 'campaign-launched',
        title: 'Email campaign sent',
        detail: `${c.name || c.subject} — ${(c.sentCount + c.bouncedCount).toLocaleString()} sent`,
        accountKey: primaryKey,
        dealer,
        timestamp: c.completedAt.toISOString(),
      });
    } else if (c.status === 'scheduled' && c.scheduledFor) {
      entries.push({
        id: `email-scheduled-${c.id}`,
        kind: 'campaign-scheduled',
        title: 'Email scheduled',
        detail: `${c.name || c.subject} — fires ${new Date(c.scheduledFor).toLocaleString()}`,
        accountKey: primaryKey,
        dealer,
        timestamp: c.updatedAt.toISOString(),
      });
    } else if (c.status === 'failed') {
      entries.push({
        id: `email-failed-${c.id}`,
        kind: 'campaign-failed',
        title: 'Email campaign failed',
        detail: c.error ? `${c.name || c.subject}: ${c.error.slice(0, 100)}` : `${c.name || c.subject} did not complete`,
        accountKey: primaryKey,
        dealer,
        timestamp: c.updatedAt.toISOString(),
      });
    }
  }

  for (const c of smsBlasts) {
    const keys = parseAccountKeyJson(c.accountKeys);
    if (!accountsOverlap(keys, scope.accountKeys)) continue;
    const primaryKey = keys[0] || '';
    const dealer = primaryKey ? dealerByAccount.get(primaryKey) || primaryKey : 'Portfolio';
    if (c.status === 'completed' && c.completedAt) {
      entries.push({
        id: `sms-completed-${c.id}`,
        kind: 'campaign-launched',
        title: 'SMS campaign sent',
        detail: `${c.name || 'SMS'} — ${c.sentCount.toLocaleString()} delivered`,
        accountKey: primaryKey,
        dealer,
        timestamp: c.completedAt.toISOString(),
      });
    } else if (c.status === 'scheduled' && c.scheduledFor) {
      entries.push({
        id: `sms-scheduled-${c.id}`,
        kind: 'campaign-scheduled',
        title: 'SMS scheduled',
        detail: `${c.name || 'SMS'} — fires ${new Date(c.scheduledFor).toLocaleString()}`,
        accountKey: primaryKey,
        dealer,
        timestamp: c.updatedAt.toISOString(),
      });
    }
  }

  for (const list of lists) {
    entries.push({
      id: `list-created-${list.id}`,
      kind: 'list-created',
      title: 'Contact list created',
      detail: list.name,
      accountKey: list.accountKey,
      dealer: dealerByAccount.get(list.accountKey) || list.accountKey,
      timestamp: list.createdAt.toISOString(),
    });
  }

  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return entries.slice(0, limit);
}

// ── Rep performance (super_admin / developer) ───────────────────

export interface RepPerformanceRow {
  repId: string | null;
  repName: string;
  accountCount: number;
  contactCount: number;
  sentInPeriod: number;
  deliveredInPeriod: number;
  opensInPeriod: number;
  clicksInPeriod: number;
  openRate: number;
  clickRate: number;
  averageHealthScore: number;
}

export async function getRepPerformance(scope: PortfolioScope): Promise<RepPerformanceRow[]> {
  const accountHealth = await getAccountHealth(scope);

  const accounts = await prisma.account.findMany({
    where: { key: { in: accountHealth.map((r) => r.accountKey) } },
    select: { key: true, accountRepId: true },
  });
  const repByAccount = new Map(accounts.map((a) => [a.key, a.accountRepId]));
  const repIds = [...new Set(accounts.map((a) => a.accountRepId).filter((id): id is string => Boolean(id)))];
  const reps = repIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: repIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const repNameById = new Map(reps.map((r) => [r.id, r.name || r.email || 'Rep']));

  const byRep = new Map<string | null, AccountHealthRow[]>();
  for (const row of accountHealth) {
    const repId = repByAccount.get(row.accountKey) || null;
    let list = byRep.get(repId);
    if (!list) {
      list = [];
      byRep.set(repId, list);
    }
    list.push(row);
  }

  const rows: RepPerformanceRow[] = [];
  for (const [repId, list] of byRep) {
    const contactCount = list.reduce((s, r) => s + r.contactCount, 0);
    const sent = list.reduce((s, r) => s + r.sentInPeriod, 0);
    const delivered = list.reduce((s, r) => s + r.deliveredInPeriod, 0);
    const opens = list.reduce((s, r) => s + r.opensInPeriod, 0);
    const clicks = list.reduce((s, r) => s + r.clicksInPeriod, 0);
    const avgHealth = list.length > 0 ? Math.round(list.reduce((s, r) => s + r.healthScore, 0) / list.length) : 0;
    rows.push({
      repId,
      repName: repId ? repNameById.get(repId) || 'Rep' : 'Unassigned',
      accountCount: list.length,
      contactCount,
      sentInPeriod: sent,
      deliveredInPeriod: delivered,
      opensInPeriod: opens,
      clicksInPeriod: clicks,
      // Summing per-account unique opens is exact — a recipient belongs to one
      // account — so this stays a unique-open rate.
      openRate: rate(opens, delivered),
      clickRate: rate(clicks, delivered),
      averageHealthScore: avgHealth,
    });
  }
  rows.sort((a, b) => b.averageHealthScore - a.averageHealthScore || b.contactCount - a.contactCount);
  return rows;
}

// ── Suppression health ──────────────────────────────────────────

export interface SuppressionHealthResult {
  emailTotal: number;
  smsTotal: number;
  emailAddedInPeriod: number;
  smsAddedInPeriod: number;
  emailReasons: Array<{ reason: string; count: number }>;
  smsReasons: Array<{ reason: string; count: number }>;
}

export async function getSuppressionHealth(scope: PortfolioScope): Promise<SuppressionHealthResult> {
  const { start, end, accountKeys } = scope;
  // Preserved: an empty list here has always meant "no account filter".
  const keys = accountKeys && accountKeys.length > 0 ? accountKeys : null;
  const inScope = { accountKeys: keys, start, end };

  // Totals are distinct addresses and "added" counts each opt-out where it
  // started — a group-wide opt-out is one suppression, not one per account.
  // The reasons split the same "added" set, so they sum to it.
  const [emailTotal, smsTotal, emailReasonsAdded, smsReasonsAdded] = await Promise.all([
    countSuppressedAddresses('email', keys),
    countSuppressedAddresses('sms', keys),
    countOriginSuppressions('email', inScope, 'reason'),
    countOriginSuppressions('sms', inScope, 'reason'),
  ]);

  const toReasons = (byReason: Map<string, number>) =>
    [...byReason.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

  return {
    emailTotal,
    smsTotal,
    emailAddedInPeriod: sumValues(emailReasonsAdded),
    smsAddedInPeriod: sumValues(smsReasonsAdded),
    emailReasons: toReasons(emailReasonsAdded),
    smsReasons: toReasons(smsReasonsAdded),
  };
}

// ── Meta Ads Pacer summary ──────────────────────────────────────

export interface MetaPacerSummaryRow {
  accountKey: string;
  dealer: string;
  baseBudgetGoal: number;
  addedBudgetGoal: number;
  totalBudgetGoal: number;
  actualSpend: number;
  pacingPct: number;
  adCount: number;
  period: string; // YYYY-MM
}

export async function getMetaPacerSummary(scope: { accountKeys: string[] | null }): Promise<MetaPacerSummaryRow[]> {
  const accountKeyWhere = scope.accountKeys && scope.accountKeys.length > 0 ? { accountKey: { in: scope.accountKeys } } : {};
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  const plans = await prisma.metaAdsPacerPlan.findMany({
    where: accountKeyWhere,
    include: {
      account: { select: { key: true, dealer: true } },
      periodBudgets: { where: { period: currentMonth } },
      ads: { where: { period: currentMonth } },
    },
  });

  const rows: MetaPacerSummaryRow[] = plans.map((plan) => {
    const periodBudget = plan.periodBudgets[0];
    const baseBudget = periodBudget?.baseBudgetGoal ?? plan.baseBudgetGoal ?? '0';
    const addedBudget = periodBudget?.addedBudgetGoal ?? plan.addedBudgetGoal ?? '0';
    const base = parseFloat(baseBudget) || 0;
    const added = parseFloat(addedBudget) || 0;
    const total = base + added;
    const actual = plan.ads.reduce((sum, ad) => {
      const v = parseFloat(ad.pacerActual || '0');
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);
    return {
      accountKey: plan.accountKey,
      dealer: plan.account?.dealer || plan.accountKey,
      baseBudgetGoal: base,
      addedBudgetGoal: added,
      totalBudgetGoal: total,
      actualSpend: actual,
      pacingPct: total > 0 ? actual / total : 0,
      adCount: plan.ads.length,
      period: currentMonth,
    };
  });
  rows.sort((a, b) => b.totalBudgetGoal - a.totalBudgetGoal);
  return rows;
}
