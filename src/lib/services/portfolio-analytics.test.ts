import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

// The portfolio dashboard's email figures, with Prisma mocked. Two
// regressions are pinned:
//   - the open rate divided EVERY open event, repeats included, by deliveries,
//     so a list of habitual re-openers read well past 100%;
//   - suppression growth counted rows, so one group-wide opt-out — copied to
//     every account in the group — read as growth at every account.
// portfolio-analytics.db.test.ts runs the same SQL against Postgres.

const queryRaw = vi.fn();
const accountFindMany = vi.fn();
const userFindMany = vi.fn();

const zeroGroupBy = vi.fn(async () => []);
const zeroCount = vi.fn(async () => 0);

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    account: { findMany: (...a: unknown[]) => accountFindMany(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    contact: { count: zeroCount, groupBy: zeroGroupBy },
    emailBlastRecipient: { groupBy: zeroGroupBy },
    smsBlastRecipient: { count: zeroCount, groupBy: zeroGroupBy },
    smsEvent: { groupBy: zeroGroupBy },
    emailBlast: { findMany: vi.fn(async () => []) },
    emailEvent: {},
    emailSuppression: {},
  },
}));

const { getPortfolioKpis, getAccountHealth, getRepPerformance } = await import('./portfolio-analytics');

function statement(call: unknown[]): Prisma.Sql {
  const [strings, ...values] = call as [TemplateStringsArray, ...Prisma.Sql[]];
  return Prisma.sql(strings, ...values);
}

/** An account whose 400 openers opened 3,000 times between them. */
const REOPENERS = {
  key: 'young-honda',
  sent: 1000,
  delivered: 875,
  uniqueOpens: 400,
  totalOpens: 3000,
  uniqueClicks: 50,
  totalClicks: 90,
  bounces: 120,
  dropped: 30,
  spamReports: 0,
  unsubscribes: 2,
  skipped: 0,
  failed: 0,
  lastSentAt: '2026-09-10T15:00:00.000Z',
};

const RANGE = {
  start: new Date('2026-09-01T00:00:00Z'),
  end: new Date('2026-09-30T23:59:59Z'),
};

let originRows: Record<'EmailSuppression' | 'SmsSuppression', Array<{ key: string; added: number }>>;

beforeEach(() => {
  queryRaw.mockReset();
  accountFindMany.mockReset().mockResolvedValue([
    { key: 'young-honda', dealer: 'Young Honda', accountRepId: null },
  ]);
  userFindMany.mockReset().mockResolvedValue([]);
  originRows = { EmailSuppression: [], SmsSuppression: [] };
  queryRaw.mockImplementation(async (...call: unknown[]) => {
    const text = statement(call).text;
    if (text.includes('WITH cohort')) return [REOPENERS];
    if (text.includes('NOT EXISTS')) {
      return text.includes('"SmsSuppression"') ? originRows.SmsSuppression : originRows.EmailSuppression;
    }
    return [];
  });
});

describe('portfolio open rate', () => {
  it('is unique opens over deliveries — repeat opens never push it past 100%', async () => {
    const kpis = await getPortfolioKpis({ accountKeys: ['young-honda'], ...RANGE });
    expect(kpis.emailOpens).toBe(400);
    expect(kpis.emailOpenRate).toBeCloseTo(400 / 875, 12);
    expect(kpis.emailOpenRate).toBeLessThanOrEqual(1);
    // A bounce is still a send: 1,000 dispatched, 12% bounced.
    expect(kpis.emailsSent).toBe(1000);
    expect(kpis.emailBounceRate).toBe(0.12);
    expect(kpis.emailDeliveryRate).toBe(0.875);
  });

  it('is the same unique rate per account and per rep', async () => {
    const [health] = await getAccountHealth({ accountKeys: ['young-honda'], ...RANGE });
    expect(health.opensInPeriod).toBe(400);
    expect(health.openRate).toBeCloseTo(400 / 875, 12);
    expect(health.bounceRate).toBe(0.12);

    const [rep] = await getRepPerformance({ accountKeys: ['young-honda'], ...RANGE });
    expect(rep.openRate).toBeCloseTo(400 / 875, 12);
    expect(rep.openRate).toBeLessThanOrEqual(1);
  });
});

describe('portfolio suppression growth', () => {
  it('asks for opt-outs where they started, and sums those — not every copied row', async () => {
    originRows.EmailSuppression = [{ key: 'young-honda', added: 3 }];
    originRows.SmsSuppression = [{ key: 'young-honda', added: 1 }];
    const kpis = await getPortfolioKpis({ accountKeys: ['young-honda'], ...RANGE });
    expect(kpis.suppressionsAdded).toBe(4);

    const suppressionSql = queryRaw.mock.calls
      .map(statement)
      .filter((s) => s.text.includes('NOT EXISTS'));
    expect(suppressionSql).toHaveLength(2);
    for (const s of suppressionSql) {
      // A row is a copy when another account's row for the same address was
      // written at or just before it.
      expect(s.text).toContain(`o."accountKey" <> s."accountKey"`);
      expect(s.text).toContain(`o."createdAt" >= s."createdAt" - INTERVAL '1 minute'`);
      expect(s.values).toContainEqual(RANGE.start);
      expect(s.values).toContainEqual(RANGE.end);
    }
  });

  it('feeds the health score the per-account origin count', async () => {
    originRows.EmailSuppression = [{ key: 'young-honda', added: 2 }];
    const [health] = await getAccountHealth({ accountKeys: ['young-honda'], ...RANGE });
    expect(health.suppressionGrowth).toBe(2);
  });
});
