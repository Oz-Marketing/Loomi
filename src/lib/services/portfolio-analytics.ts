// Cross-account aggregations for the management dashboard.
//
// Each function takes a (possibly null) list of allowed account keys
// + an optional date range, and returns a slice of data sized for one
// widget. All queries hit Postgres — no ESP round-trips. Designed to
// run in parallel from a single /api/dashboard/portfolio handler.

import { prisma } from '@/lib/prisma';

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

  // Email send pipeline: count from recipient rows (the canonical
  // post-202 send log). Mirrors email-analytics service behaviour.
  const emailsSent = await prisma.emailBlastRecipient.count({
    where: {
      accountKey: { in: accountKeys },
      status: 'sent',
      ...(range ? { sentAt: range } : {}),
    },
  });

  // SMS: same shape, status = 'sent' or 'delivered' counts as sent.
  const smsSent = await prisma.smsBlastRecipient.count({
    where: {
      accountKey: { in: accountKeys },
      status: { in: ['sent', 'delivered'] },
      ...(range ? { sentAt: range } : {}),
    },
  });

  // Email event aggregates.
  const emailEventGroups = await prisma.emailEvent.groupBy({
    by: ['eventType'],
    where: {
      accountKey: { in: accountKeys },
      ...(range ? { timestamp: range } : {}),
    },
    _count: { _all: true },
  });
  const emailEventCount = new Map(emailEventGroups.map((g) => [g.eventType, g._count._all]));
  const emailDelivered = emailEventCount.get('delivered') || 0;
  const emailOpens = emailEventCount.get('open') || 0;
  const emailClicks = emailEventCount.get('click') || 0;
  const emailBounces = emailEventCount.get('bounce') || 0;
  const emailSpamReports = emailEventCount.get('spamreport') || 0;
  const emailUnsubscribes =
    (emailEventCount.get('unsubscribe') || 0) + (emailEventCount.get('group_unsubscribe') || 0);

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

  // Suppressions added in range (email + sms).
  const emailSuppressionsAdded = await prisma.emailSuppression.count({
    where: {
      accountKey: { in: accountKeys },
      ...(range ? { createdAt: range } : {}),
    },
  });
  const smsSuppressionsAdded = await prisma.smsSuppression.count({
    where: {
      accountKey: { in: accountKeys },
      ...(range ? { createdAt: range } : {}),
    },
  });

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

  const safe = (num: number, den: number) => (den > 0 ? num / den : 0);

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
    emailDeliveryRate: safe(emailDelivered, emailsSent),
    emailOpenRate: safe(emailOpens, emailDelivered),
    emailClickRate: safe(emailClicks, emailDelivered),
    emailBounceRate: safe(emailBounces, emailsSent),
    emailSpamRate: safe(emailSpamReports, emailDelivered),
    smsDeliveryRate: safe(smsDelivered, smsSent),
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
  const range = dateFilter(start, end);

  const accountKeyWhere = accountKeys && accountKeys.length > 0 ? { accountKey: { in: accountKeys } } : {};

  const emailRows = await prisma.emailEvent.findMany({
    where: {
      ...accountKeyWhere,
      eventType: { in: ['delivered', 'open', 'click', 'bounce'] },
      ...(range ? { timestamp: range } : {}),
    },
    select: { eventType: true, timestamp: true },
    take: 100_000,
  });

  const smsRows = await prisma.smsEvent.findMany({
    where: {
      ...accountKeyWhere,
      eventType: 'delivered',
      ...(range ? { timestamp: range } : {}),
    },
    select: { timestamp: true },
    take: 100_000,
  });

  const buckets = new Map<string, EngagementTimelinePoint>();
  function bucket(day: string): EngagementTimelinePoint {
    let b = buckets.get(day);
    if (!b) {
      b = { date: day, emailDelivered: 0, emailOpens: 0, emailClicks: 0, emailBounces: 0, smsDelivered: 0 };
      buckets.set(day, b);
    }
    return b;
  }

  for (const row of emailRows) {
    const day = row.timestamp.toISOString().slice(0, 10);
    const b = bucket(day);
    if (row.eventType === 'delivered') b.emailDelivered += 1;
    else if (row.eventType === 'open') b.emailOpens += 1;
    else if (row.eventType === 'click') b.emailClicks += 1;
    else if (row.eventType === 'bounce') b.emailBounces += 1;
  }
  for (const row of smsRows) {
    const day = row.timestamp.toISOString().slice(0, 10);
    bucket(day).smsDelivered += 1;
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

  // Email engagement: distinct recipientId where eventType in {open, click}
  // since `since`, joined back to the recipient row to get contactId +
  // accountKey. recipientId IS NULL events (e.g. transactional traffic)
  // are excluded.
  const accountKeyWhere = scope.accountKeys && scope.accountKeys.length > 0 ? { accountKey: { in: scope.accountKeys } } : {};

  const engagedRecipients = await prisma.emailEvent.findMany({
    where: {
      ...accountKeyWhere,
      eventType: { in: ['open', 'click'] },
      recipientId: { not: null },
      timestamp: { gte: since },
    },
    distinct: ['recipientId'],
    select: { recipientId: true },
  });
  const recipientIds = engagedRecipients
    .map((r) => r.recipientId)
    .filter((id): id is string => Boolean(id));

  let engagedRows: Array<{ contactId: string; accountKey: string }> = [];
  if (recipientIds.length > 0) {
    engagedRows = await prisma.emailBlastRecipient.findMany({
      where: { id: { in: recipientIds } },
      select: { contactId: true, accountKey: true },
    });
  }

  // SMS engagement: contacts who replied (eventType = received) in window.
  const smsEngagedRecipients = await prisma.smsEvent.findMany({
    where: {
      ...accountKeyWhere,
      eventType: { in: ['received'] },
      recipientId: { not: null },
      timestamp: { gte: since },
    },
    distinct: ['recipientId'],
    select: { recipientId: true },
  });
  const smsRecipientIds = smsEngagedRecipients
    .map((r) => r.recipientId)
    .filter((id): id is string => Boolean(id));

  let smsEngagedRows: Array<{ contactId: string; accountKey: string }> = [];
  if (smsRecipientIds.length > 0) {
    smsEngagedRows = await prisma.smsBlastRecipient.findMany({
      where: { id: { in: smsRecipientIds } },
      select: { contactId: true, accountKey: true },
    });
  }

  // Dedupe contactId across both channels.
  const perAccount = new Map<string, Set<string>>();
  for (const r of engagedRows) {
    let s = perAccount.get(r.accountKey);
    if (!s) {
      s = new Set();
      perAccount.set(r.accountKey, s);
    }
    s.add(r.contactId);
  }
  for (const r of smsEngagedRows) {
    let s = perAccount.get(r.accountKey);
    if (!s) {
      s = new Set();
      perAccount.set(r.accountKey, s);
    }
    s.add(r.contactId);
  }

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
    const engagedSet = perAccount.get(a.key);
    const engagedCount = engagedSet ? engagedSet.size : 0;
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
          { status: { in: ['failed', 'partial'] }, updatedAt: { gte: sevenDaysAgo } },
        ],
      },
      orderBy: { scheduledFor: 'asc' },
      take: 200,
    }),
    prisma.smsBlast.findMany({
      where: {
        OR: [
          { status: { in: ['scheduled', 'processing', 'queued'] } },
          { status: { in: ['failed', 'partial'] }, updatedAt: { gte: sevenDaysAgo } },
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
    .filter((c) => c.status === 'failed' || c.status === 'partial')
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
  const range = dateFilter(start, end);

  const accounts = await prisma.account.findMany({
    where: { key: { not: { startsWith: '\\_' } }, ...(accountKeys ? { key: { in: accountKeys } } : {}) },
    select: { key: true, dealer: true },
  });
  const allowedKeys = accounts.map((a) => a.key);
  if (allowedKeys.length === 0) return [];

  const [contactCounts, recipientSentGroups, eventGroups, suppressionGroups, lastSentRows] =
    await Promise.all([
      prisma.contact.groupBy({
        by: ['accountKey'],
        where: { accountKey: { in: allowedKeys } },
        _count: { _all: true },
      }),
      prisma.emailBlastRecipient.groupBy({
        by: ['accountKey'],
        where: {
          accountKey: { in: allowedKeys },
          status: 'sent',
          ...(range ? { sentAt: range } : {}),
        },
        _count: { _all: true },
      }),
      prisma.emailEvent.groupBy({
        by: ['accountKey', 'eventType'],
        where: {
          accountKey: { in: allowedKeys },
          ...(range ? { timestamp: range } : {}),
        },
        _count: { _all: true },
      }),
      prisma.emailSuppression.groupBy({
        by: ['accountKey'],
        where: {
          accountKey: { in: allowedKeys },
          ...(range ? { createdAt: range } : {}),
        },
        _count: { _all: true },
      }),
      prisma.emailBlastRecipient.groupBy({
        by: ['accountKey'],
        where: { accountKey: { in: allowedKeys }, status: 'sent' },
        _max: { sentAt: true },
      }),
    ]);

  const contactsByKey = new Map(contactCounts.map((r) => [r.accountKey, r._count._all]));
  const sentByKey = new Map(recipientSentGroups.map((r) => [r.accountKey, r._count._all]));
  const suppressionByKey = new Map(suppressionGroups.map((r) => [r.accountKey, r._count._all]));
  const lastSentByKey = new Map(
    lastSentRows.map((r) => [r.accountKey, r._max.sentAt?.getTime() ?? null]),
  );

  const eventsByKey = new Map<string, Record<string, number>>();
  for (const g of eventGroups) {
    if (!g.accountKey) continue;
    const entry = eventsByKey.get(g.accountKey) || {};
    entry[g.eventType] = g._count._all;
    eventsByKey.set(g.accountKey, entry);
  }

  const now = Date.now();

  const rows: AccountHealthRow[] = accounts.map((a) => {
    const sent = sentByKey.get(a.key) || 0;
    const evt = eventsByKey.get(a.key) || {};
    const delivered = evt['delivered'] || 0;
    const opens = evt['open'] || 0;
    const clicks = evt['click'] || 0;
    const bounces = evt['bounce'] || 0;
    const lastSentMs = lastSentByKey.get(a.key) ?? null;
    const daysSinceLastSend = lastSentMs ? Math.floor((now - lastSentMs) / (24 * 60 * 60 * 1000)) : null;
    const openRate = delivered > 0 ? opens / delivered : 0;
    const clickRate = delivered > 0 ? clicks / delivered : 0;
    const bounceRate = sent > 0 ? bounces / sent : 0;
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

  // 1. Bounce rate spikes (last 7d > 5% on >= 50 sends).
  const [sentLast7d, bouncesLast7d] = await Promise.all([
    prisma.emailBlastRecipient.groupBy({
      by: ['accountKey'],
      where: { ...accountKeyWhere, status: 'sent', sentAt: { gte: sevenDaysAgo } },
      _count: { _all: true },
    }),
    prisma.emailEvent.groupBy({
      by: ['accountKey'],
      where: { ...accountKeyWhere, eventType: 'bounce', timestamp: { gte: sevenDaysAgo } },
      _count: { _all: true },
    }),
  ]);
  const sentByAccount = new Map(sentLast7d.map((r) => [r.accountKey, r._count._all]));
  const bouncesByAccount = new Map(bouncesLast7d.map((r) => [r.accountKey ?? '', r._count._all]));
  for (const [key, sent] of sentByAccount) {
    if (sent < 50) continue;
    const bounces = bouncesByAccount.get(key) || 0;
    const rate = bounces / sent;
    if (rate >= 0.05) {
      alerts.push({
        id: `bounce-spike-${key}`,
        severity: 'critical',
        title: 'Bounce rate spike',
        detail: `${(rate * 100).toFixed(1)}% bounces on ${sent.toLocaleString()} sends (7d).`,
        accountKey: key,
        dealer: dealerByAccount.get(key) || key,
        href: accountHref(key),
        timestamp: new Date().toISOString(),
      });
    } else if (rate >= 0.02) {
      alerts.push({
        id: `bounce-elevated-${key}`,
        severity: 'warning',
        title: 'Elevated bounce rate',
        detail: `${(rate * 100).toFixed(1)}% bounces on ${sent.toLocaleString()} sends (7d).`,
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
    where: { ...accountKeyWhere, status: 'sent' },
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

  // 5. Suppression growth (>5% of contact base in 7d or >= 100 raw).
  const suppressionsLast7d = await prisma.emailSuppression.groupBy({
    by: ['accountKey'],
    where: { ...accountKeyWhere, createdAt: { gte: sevenDaysAgo } },
    _count: { _all: true },
  });
  const contactsByKey = new Map(contactCounts.map((r) => [r.accountKey, r._count._all]));
  for (const r of suppressionsLast7d) {
    const total = contactsByKey.get(r.accountKey) || 0;
    if (total === 0) continue;
    const pct = r._count._all / total;
    if (pct >= 0.05 || r._count._all >= 100) {
      alerts.push({
        id: `suppression-growth-${r.accountKey}`,
        severity: pct >= 0.1 ? 'critical' : 'warning',
        title: 'Suppression list growing fast',
        detail: `${r._count._all.toLocaleString()} new suppressions in 7d (${(pct * 100).toFixed(1)}% of list).`,
        accountKey: r.accountKey,
        dealer: dealerByAccount.get(r.accountKey) || r.accountKey,
        href: '/messaging/settings/suppressions',
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

  const campaigns = await prisma.emailBlast.findMany({
    where,
    select: {
      id: true,
      name: true,
      subject: true,
      accountKeys: true,
      scheduledFor: true,
      startedAt: true,
      completedAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 250,
  });

  const filtered = campaigns.filter((c) => accountsOverlap(parseAccountKeyJson(c.accountKeys), accountKeys));
  if (filtered.length === 0) return [];

  const campaignIds = filtered.map((c) => c.id);

  const [recipientGroups, eventGroups, uniqueOpenRows, uniqueClickRows] = await Promise.all([
    prisma.emailBlastRecipient.groupBy({
      by: ['campaignId', 'status'],
      where: { campaignId: { in: campaignIds } },
      _count: { _all: true },
    }),
    prisma.emailEvent.groupBy({
      by: ['campaignId', 'eventType'],
      where: { campaignId: { in: campaignIds } },
      _count: { _all: true },
    }),
    prisma.emailEvent.findMany({
      where: { campaignId: { in: campaignIds }, eventType: 'open', recipientId: { not: null } },
      distinct: ['campaignId', 'recipientId'],
      select: { campaignId: true, recipientId: true },
    }),
    prisma.emailEvent.findMany({
      where: { campaignId: { in: campaignIds }, eventType: 'click', recipientId: { not: null } },
      distinct: ['campaignId', 'recipientId'],
      select: { campaignId: true, recipientId: true },
    }),
  ]);

  const sentByCampaign = new Map<string, number>();
  for (const g of recipientGroups) {
    if (g.status === 'sent') sentByCampaign.set(g.campaignId, g._count._all);
  }
  const deliveredByCampaign = new Map<string, number>();
  for (const g of eventGroups) {
    if (g.campaignId && g.eventType === 'delivered') deliveredByCampaign.set(g.campaignId, g._count._all);
  }
  const uniqueOpensByCampaign = new Map<string, number>();
  for (const r of uniqueOpenRows) {
    if (!r.campaignId) continue;
    uniqueOpensByCampaign.set(r.campaignId, (uniqueOpensByCampaign.get(r.campaignId) || 0) + 1);
  }
  const uniqueClicksByCampaign = new Map<string, number>();
  for (const r of uniqueClickRows) {
    if (!r.campaignId) continue;
    uniqueClicksByCampaign.set(r.campaignId, (uniqueClicksByCampaign.get(r.campaignId) || 0) + 1);
  }

  const rows: TopCampaignRow[] = filtered
    .map((c) => {
      const sent = sentByCampaign.get(c.id) || 0;
      const delivered = deliveredByCampaign.get(c.id) || 0;
      const uniqueOpens = uniqueOpensByCampaign.get(c.id) || 0;
      const uniqueClicks = uniqueClicksByCampaign.get(c.id) || 0;
      return {
        campaignId: c.id,
        campaignName: c.name || c.subject || 'Untitled campaign',
        channel: 'email' as const,
        accountKeys: parseAccountKeyJson(c.accountKeys),
        sent,
        delivered,
        uniqueOpens,
        uniqueClicks,
        openRate: delivered > 0 ? uniqueOpens / delivered : 0,
        clickRate: delivered > 0 ? uniqueClicks / delivered : 0,
        sentAt: c.completedAt?.toISOString() || c.startedAt?.toISOString() || c.scheduledFor?.toISOString() || null,
      };
    })
    .filter((c) => c.sent >= 25); // only rank campaigns with meaningful denominator

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
      entries.push({
        id: `email-completed-${c.id}`,
        kind: 'campaign-launched',
        title: 'Email campaign sent',
        detail: `${c.name || c.subject} — ${c.sentCount.toLocaleString()} delivered`,
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
      openRate: delivered > 0 ? opens / delivered : 0,
      clickRate: delivered > 0 ? clicks / delivered : 0,
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
  const range = dateFilter(start, end);
  const accountKeyWhere = accountKeys && accountKeys.length > 0 ? { accountKey: { in: accountKeys } } : {};

  const [emailTotal, smsTotal, emailAdded, smsAdded, emailReasonsRaw, smsReasonsRaw] = await Promise.all([
    prisma.emailSuppression.count({ where: accountKeyWhere }),
    prisma.smsSuppression.count({ where: accountKeyWhere }),
    prisma.emailSuppression.count({ where: { ...accountKeyWhere, ...(range ? { createdAt: range } : {}) } }),
    prisma.smsSuppression.count({ where: { ...accountKeyWhere, ...(range ? { createdAt: range } : {}) } }),
    prisma.emailSuppression.groupBy({
      by: ['reason'],
      where: { ...accountKeyWhere, ...(range ? { createdAt: range } : {}) },
      _count: { _all: true },
    }),
    prisma.smsSuppression.groupBy({
      by: ['reason'],
      where: { ...accountKeyWhere, ...(range ? { createdAt: range } : {}) },
      _count: { _all: true },
    }),
  ]);

  const emailReasons = emailReasonsRaw
    .map((r) => ({ reason: r.reason, count: r._count._all }))
    .sort((a, b) => b.count - a.count);
  const smsReasons = smsReasonsRaw
    .map((r) => ({ reason: r.reason, count: r._count._all }))
    .sort((a, b) => b.count - a.count);

  return {
    emailTotal,
    smsTotal,
    emailAddedInPeriod: emailAdded,
    smsAddedInPeriod: smsAdded,
    emailReasons,
    smsReasons,
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
