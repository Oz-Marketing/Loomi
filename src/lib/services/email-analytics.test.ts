import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { EngagementGroup } from './email-analytics';

// The engagement numbers every email surface shows — the Blasts list, the
// sent-blast drawer, the Reporting page, the portfolio dashboard — come from
// here, so the definitions are pinned here: a bounce stays in Sent, no rate
// can pass 100%, a date range reaches skipped and failed, an empty scope is
// empty, and totals and rows are cut from the same recipients.
//
// Prisma is mocked: these tests cover the arithmetic and the SQL each call
// asks for. email-analytics.db.test.ts runs that SQL against Postgres.

const queryRaw = vi.fn();
const emailBlastFindMany = vi.fn();
const emailBlastFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    emailBlast: {
      findMany: (...a: unknown[]) => emailBlastFindMany(...a),
      findUnique: (...a: unknown[]) => emailBlastFindUnique(...a),
    },
    // Presence only — the stale-client guard checks the delegates exist.
    emailEvent: {},
    emailSuppression: {},
  },
}));

const {
  rate,
  computeRatios,
  sumEngagementCounts,
  getEngagementReport,
  getCampaignEngagement,
  getCampaignEngagementById,
  EMPTY_ENGAGEMENT_COUNTS,
} = await import('./email-analytics');

/** Rebuild the tagged-template call into the statement Postgres would get. */
function statement(call: unknown[]): Prisma.Sql {
  const [strings, ...values] = call as [TemplateStringsArray, ...Prisma.Sql[]];
  return Prisma.sql(strings, ...values);
}

function statements(): Prisma.Sql[] {
  return queryRaw.mock.calls.map(statement);
}

function cohortStatement(): Prisma.Sql {
  const found = statements().find((s) => s.text.includes('WITH cohort'));
  if (!found) throw new Error('no cohort query was issued');
  return found;
}

/** The 1,000-dispatched example: 120 bounced (30 dropped), 875 delivered. */
const SEPTEMBER_BLAST = {
  key: 'blast-sept',
  sent: 1000,
  delivered: 875,
  uniqueOpens: 400,
  totalOpens: 600,
  uniqueClicks: 50,
  totalClicks: 60,
  bounces: 120,
  dropped: 30,
  spamReports: 1,
  unsubscribes: 7,
  skipped: 4,
  failed: 3,
  lastSentAt: '2026-09-10T15:00:00.000Z',
};

const FLOW_STEP = {
  ...EMPTY_ENGAGEMENT_COUNTS,
  key: 'flow-step',
  sent: 10,
  delivered: 8,
  lastSentAt: '2026-09-15T15:00:00.000Z',
};

beforeEach(() => {
  queryRaw.mockReset();
  emailBlastFindMany.mockReset();
  emailBlastFindUnique.mockReset();
  // Route each statement to canned rows by what it is.
  queryRaw.mockImplementation(async (...call: unknown[]) => {
    const text = statement(call).text;
    if (text.includes('WITH cohort')) return [SEPTEMBER_BLAST, FLOW_STEP];
    return [];
  });
  emailBlastFindMany.mockResolvedValue([
    {
      id: 'blast-sept',
      name: 'September Event',
      accountKeys: '["young-honda"]',
      scheduledFor: null,
      startedAt: new Date('2026-09-10T15:00:00Z'),
      completedAt: new Date('2026-09-10T16:00:00Z'),
    },
    {
      // A flow step's wrapper never gets a start, completion or schedule.
      id: 'flow-step',
      name: 'Welcome · Day 1',
      accountKeys: '["young-honda"]',
      scheduledFor: null,
      startedAt: null,
      completedAt: null,
    },
  ]);
});

describe('rate', () => {
  it('divides into a 0–1 fraction', () => {
    expect(rate(875, 1000)).toBe(0.875);
  });

  it('never passes 100%, whatever the counts say', () => {
    expect(rate(1100, 1000)).toBe(1);
  });

  it('is 0 with nothing to divide by, or nothing sensible to divide', () => {
    expect(rate(5, 0)).toBe(0);
    expect(rate(0, 0)).toBe(0);
    expect(rate(-1, 10)).toBe(0);
    expect(rate(Number.NaN, 10)).toBe(0);
    expect(rate(10, Number.NaN)).toBe(0);
  });
});

describe('computeRatios', () => {
  it('reports 1,000 dispatched / 120 bounced / 875 delivered as 87.5% and 12%', () => {
    const { key: _key, lastSentAt: _at, ...counts } = SEPTEMBER_BLAST;
    void _key;
    void _at;
    const totals = computeRatios(counts);
    expect(totals.sent).toBe(1000);
    expect(totals.deliveryRate).toBe(0.875);
    expect(totals.bounceRate).toBe(0.12);
    expect(totals.openRate).toBeCloseTo(400 / 875, 12);
    expect(totals.clickRate).toBeCloseTo(50 / 875, 12);
    expect(totals.clickToOpenRate).toBeCloseTo(50 / 400, 12);
    expect(totals.unsubscribeRate).toBeCloseTo(7 / 875, 12);
  });

  it('keeps every rate at or under 100% when a numerator outruns its denominator', () => {
    // Opens and deliveries arrive as separate webhook events; a lost
    // 'delivered' must not print a 120% open rate.
    const totals = computeRatios({
      ...EMPTY_ENGAGEMENT_COUNTS,
      sent: 10,
      delivered: 12,
      uniqueOpens: 15,
      uniqueClicks: 20,
      bounces: 11,
      unsubscribes: 13,
    });
    for (const r of [
      totals.deliveryRate,
      totals.openRate,
      totals.clickRate,
      totals.clickToOpenRate,
      totals.bounceRate,
      totals.unsubscribeRate,
    ]) {
      expect(r).toBeLessThanOrEqual(1);
      expect(r).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('sumEngagementCounts', () => {
  it('adds every count, ignoring the group key and date', () => {
    const groups: EngagementGroup[] = [
      { ...SEPTEMBER_BLAST, lastSentAt: null },
      { ...FLOW_STEP, lastSentAt: null },
    ];
    const sum = sumEngagementCounts(groups);
    expect(sum).toEqual({
      ...EMPTY_ENGAGEMENT_COUNTS,
      sent: 1010,
      delivered: 883,
      uniqueOpens: 400,
      totalOpens: 600,
      uniqueClicks: 50,
      totalClicks: 60,
      bounces: 120,
      dropped: 30,
      spamReports: 1,
      unsubscribes: 7,
      skipped: 4,
      failed: 3,
    });
  });
});

describe('getEngagementReport', () => {
  const SEPTEMBER = {
    start: new Date('2026-09-01T00:00:00Z'),
    end: new Date('2026-09-30T23:59:59Z'),
  };

  it('builds the totals and the rows from the same aggregate, so the rows add up', async () => {
    const report = await getEngagementReport({ accountKeys: ['young-honda'], ...SEPTEMBER });
    expect(report.totals.sent).toBe(1010);
    expect(report.totals.delivered).toBe(883);
    expect(report.totals.deliveryRate).toBeCloseTo(883 / 1010, 12);
    expect(report.campaignCount).toBe(2);
    expect(report.campaigns.reduce((n, r) => n + r.sent, 0)).toBe(report.totals.sent);
    expect(report.campaigns.reduce((n, r) => n + r.failed, 0)).toBe(report.totals.failed);
    // Exactly one cohort aggregate — totals and rows share it.
    expect(statements().filter((s) => s.text.includes('WITH cohort'))).toHaveLength(1);
  });

  it('dates a flow step by its latest send, newest row first', async () => {
    const { campaigns } = await getEngagementReport({ accountKeys: ['young-honda'], ...SEPTEMBER });
    expect(campaigns.map((c) => c.campaignId)).toEqual(['flow-step', 'blast-sept']);
    expect(campaigns[0].sentAt?.toISOString()).toBe('2026-09-15T15:00:00.000Z');
    expect(campaigns[1].sentAt?.toISOString()).toBe('2026-09-10T16:00:00.000Z');
  });

  it('dates skipped and failed recipients inside the range, not all-time', async () => {
    await getEngagementReport({ accountKeys: ['young-honda'], ...SEPTEMBER });
    const sql = cohortStatement();
    // One predicate covers every reported status: a dispatched recipient by
    // sentAt, a skipped or failed one (no sentAt) by when that was recorded.
    const text = sql.text.replace(/\s+/g, ' ');
    expect(text).toContain(`r.status IN ('sent', 'bounced', 'failed', 'skipped')`);
    expect(text).toMatch(
      /\( ?\(r\."sentAt" >= \$\d+ AND r\."sentAt" <= \$\d+\) OR \(r\."sentAt" IS NULL AND r\."updatedAt" >= \$\d+ AND r\."updatedAt" <= \$\d+\) ?\)/,
    );
    expect(sql.values).toContainEqual(SEPTEMBER.start);
    expect(sql.values).toContainEqual(SEPTEMBER.end);
  });

  it('applies an open-ended range to the same columns', async () => {
    await getEngagementReport({ accountKeys: ['young-honda'], start: SEPTEMBER.start, end: null });
    const text = cohortStatement().text.replace(/\s+/g, ' ');
    expect(text).toMatch(
      /\( ?\(r\."sentAt" >= \$\d+\) OR \(r\."sentAt" IS NULL AND r\."updatedAt" >= \$\d+\) ?\)/,
    );
    expect(text).not.toContain('<=');
  });

  it('applies no date predicate without a range', async () => {
    await getEngagementReport({ accountKeys: ['young-honda'], start: null, end: null });
    expect(cohortStatement().text).not.toContain('r."updatedAt"');
  });

  it('counts a bounce as sent, and only real opens', async () => {
    await getEngagementReport({ accountKeys: ['young-honda'], ...SEPTEMBER });
    const text = cohortStatement().text;
    expect(text).toContain(`COUNT(*) FILTER (WHERE c.status IN ('sent', 'bounced'))::int AS "sent"`);
    expect(text).toContain(`COUNT(*) FILTER (WHERE c.status = 'bounced')::int AS "bounces"`);
    // A delivered-then-bounced recipient is a bounce, never a delivery.
    expect(text).toContain(`COUNT(*) FILTER (WHERE c.status = 'sent' AND x.delivered)::int AS "delivered"`);
    expect(text).toContain(`COUNT(*) FILTER (WHERE e."eventType" = 'open') AS opens`);
    for (const s of statements()) expect(s.text).not.toContain('machine_open');
  });

  it('applies the source filter to totals, rows, chart and links alike', async () => {
    await getEngagementReport({ accountKeys: ['young-honda'], ...SEPTEMBER, source: 'blasts' });
    const issued = statements();
    expect(issued).toHaveLength(3); // cohort, chart, links
    for (const s of issued) expect(s.text).toContain('b."flowNodeKey" IS NULL');
  });

  it('passes id and key lists as one array parameter, never an IN list', async () => {
    await getEngagementReport({ accountKeys: ['young-honda', 'young-ford'], ...SEPTEMBER });
    const sql = cohortStatement();
    expect(sql.text).toMatch(/r\."accountKey" = ANY\(\$\d+::text\[\]\)/);
    expect(sql.values).toContainEqual(['young-honda', 'young-ford']);
  });

  it('returns nothing — and queries nothing — for an empty account scope', async () => {
    const report = await getEngagementReport({ accountKeys: [], start: null, end: null });
    expect(report.totals).toMatchObject({ sent: 0, delivered: 0, deliveryRate: 0 });
    expect(report.campaigns).toEqual([]);
    expect(report.campaignCount).toBe(0);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(emailBlastFindMany).not.toHaveBeenCalled();
  });

  it('converts bigint counts from Postgres into numbers', async () => {
    queryRaw.mockImplementation(async (...call: unknown[]) =>
      statement(call).text.includes('WITH cohort')
        ? [{ ...SEPTEMBER_BLAST, sent: BigInt(1000), delivered: BigInt(875), bounces: BigInt(120) }]
        : [],
    );
    const { totals } = await getEngagementReport({ accountKeys: ['young-honda'], ...SEPTEMBER });
    expect(totals.sent).toBe(1000);
    expect(totals.deliveryRate).toBe(0.875);
    expect(totals.bounceRate).toBe(0.12);
  });
});

describe('getCampaignEngagement without a range', () => {
  it('aggregates only the campaigns on the list page', async () => {
    await getCampaignEngagement({ accountKeys: ['young-honda'], start: null, end: null });
    const sql = cohortStatement();
    expect(sql.text).toMatch(/r\."campaignId" = ANY\(\$\d+::text\[\]\)/);
    expect(sql.values).toContainEqual(['blast-sept', 'flow-step']);
  });
});

describe('getCampaignEngagementById', () => {
  it('scopes the drawer to the accounts it is given', async () => {
    emailBlastFindUnique.mockResolvedValue({
      id: 'blast-sept',
      name: 'September Event',
      accountKeys: '["young-honda","young-ford"]',
      scheduledFor: null,
      startedAt: null,
      completedAt: new Date('2026-09-10T16:00:00Z'),
    });
    queryRaw.mockResolvedValue([SEPTEMBER_BLAST]);
    const row = await getCampaignEngagementById('blast-sept', ['young-honda']);
    expect(row).toMatchObject({ sent: 1000, delivered: 875, deliveryRate: 0.875, bounceRate: 0.12 });
    expect(cohortStatement().values).toContainEqual(['young-honda']);
  });

  it('reports zeros, not null, for a campaign with nothing sent yet', async () => {
    emailBlastFindUnique.mockResolvedValue({
      id: 'draft',
      name: 'Draft',
      accountKeys: '[]',
      scheduledFor: null,
      startedAt: null,
      completedAt: null,
    });
    queryRaw.mockResolvedValue([]);
    const row = await getCampaignEngagementById('draft');
    expect(row).toMatchObject({ sent: 0, delivered: 0, openRate: 0, sentAt: null });
  });
});
