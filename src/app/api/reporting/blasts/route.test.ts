import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * GET /api/reporting/blasts is client-facing: Reporting admits the client
 * role. The route builds every object it returns field by field, so anything a
 * service adds upstream stays out until someone opts it in. This walks the
 * whole response for banned keys AND for sentinel values smuggled in under
 * innocent names — the same leak test as lib/reporting/budget-view.test.ts.
 *
 * It also pins the counting choices: one-off blasts only (flows have their own
 * section on the page), "Sends" from the uncapped campaign count, and no rate
 * over 100% even when the previous provider's own figures disagree.
 */

const getEngagementReport = vi.fn();
const getTextTotals = vi.fn();
const getTextBlasts = vi.fn();
const getGhlCredentials = vi.fn();
const getEmailBlastsNormalized = vi.fn();

vi.mock('../_lib/guard', () => ({
  requireReportingAccess: async () => ({
    ctx: { accountKeys: ['young-honda'], canViewSpend: false, user: { id: 'u1', role: 'client' } },
    error: null,
  }),
}));
vi.mock('@/lib/api-auth', () => ({
  canAccessAccount: (scope: string[] | null, key: string) => !scope || scope.includes(key),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { account: { findUnique: async () => ({ dealer: 'Young Honda' }) } },
}));
vi.mock('@/lib/integrations/gohighlevel', () => {
  class GhlError extends Error {
    constructor(public code: string) {
      super(code);
    }
  }
  return {
    GhlError,
    getGhlCredentials: (...a: unknown[]) => getGhlCredentials(...a),
    getEmailBlastsNormalized: (...a: unknown[]) => getEmailBlastsNormalized(...a),
  };
});
vi.mock('@/lib/services/email-analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/email-analytics')>();
  return { ...actual, getEngagementReport: (...a: unknown[]) => getEngagementReport(...a) };
});
vi.mock('@/lib/services/sms-analytics', () => ({
  getTextTotals: (...a: unknown[]) => getTextTotals(...a),
  getTextBlasts: (...a: unknown[]) => getTextBlasts(...a),
}));

const { GET } = await import('./route');

/** Values that must never reach a client, under any key. */
const SENTINELS = [4444.44, 3333.33, 7777.77, 0.7711];
const BANNED_KEYS = [
  'cost',
  'revenue',
  'byLineType',
  'knownRevenue',
  'uncostedAmount',
  'defaultMarkup',
  'markup',
  'markupSnapshot',
  'spendTarget',
  'actual_spend',
];

function walk(value: unknown, visit: (key: string | null, v: unknown) => void, key: string | null = null) {
  visit(key, value);
  if (Array.isArray(value)) value.forEach((v) => walk(v, visit));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(v, visit, k);
  }
}

const loomiTotals = {
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
  deliveryRate: 0.875,
  openRate: 400 / 875,
  clickRate: 50 / 875,
  clickToOpenRate: 50 / 400,
  bounceRate: 0.12,
  unsubscribeRate: 7 / 875,
  // Smuggled: a service that one day adds margin to its totals.
  cost: SENTINELS[0],
};

beforeEach(() => {
  getEngagementReport.mockReset().mockResolvedValue({
    totals: loomiTotals,
    campaigns: [
      {
        ...loomiTotals,
        campaignId: 'blast-sept',
        campaignName: 'September Event',
        sentAt: new Date('2026-09-10T16:00:00Z'),
        spendTarget: SENTINELS[2],
      },
    ],
    // More blasts in the window than the row list carries.
    campaignCount: 612,
    series: [
      { date: '2026-09-10', delivered: 875, opens: 400, clicks: 50, bounces: 120, revenue: SENTINELS[1] },
    ],
    topUrls: [{ url: 'https://a.example/x', clicks: 40, markup: SENTINELS[3] }],
  });
  getTextTotals.mockReset().mockResolvedValue({
    campaigns: 1,
    sent: 10,
    delivered: 9,
    failed: 1,
    optOuts: 0,
    cost: SENTINELS[0],
  });
  getTextBlasts.mockReset().mockResolvedValue([
    {
      campaignId: 'text-1',
      campaignName: 'Text',
      sentAt: new Date('2026-09-11T16:00:00Z'),
      sent: 10,
      delivered: 9,
      failed: 1,
      optOuts: 0,
    },
  ]);
  getGhlCredentials.mockReset().mockResolvedValue({ token: 't' });
  // The previous provider reporting more opens than deliveries.
  getEmailBlastsNormalized.mockReset().mockResolvedValue([
    {
      id: 'ghl-1',
      name: 'Old newsletter',
      scheduled_at: '2026-09-05T15:00:00',
      sent: 100,
      delivered: 100,
      opened: 150,
      clicked: 20,
      bounced: 0,
      failed: 0,
      errors: 0,
      unsubscribed: 0,
    },
  ]);
});

async function get(query = 'accountKey=young-honda&start_date=2026-09-01&end_date=2026-09-30') {
  const res = await GET(new NextRequest(`https://studio.loomilm.com/api/reporting/blasts?${query}`));
  expect(res.status).toBe(200);
  return res.json();
}

describe('GET /api/reporting/blasts', () => {
  it('returns no banned key and no smuggled value anywhere in the payload', async () => {
    const body = await get();
    walk(body, (key, v) => {
      if (key) expect(BANNED_KEYS).not.toContain(key);
      if (typeof v === 'number') expect(SENTINELS).not.toContain(v);
    });
  });

  it('projects the chart and the link list to their known fields', async () => {
    const body = await get();
    expect(body.series).toEqual([
      { date: '2026-09-10', delivered: 875, opens: 400, clicks: 50, bounces: 120 },
    ]);
    expect(body.topUrls).toEqual([{ url: 'https://a.example/x', clicks: 40 }]);
  });

  it('counts one-off blasts only — flows have their own section', async () => {
    await get();
    expect(getEngagementReport).toHaveBeenCalledWith(
      expect.objectContaining({ accountKeys: ['young-honda'], source: 'blasts' }),
    );
  });

  it('counts every blast in the window as a send, not just the rows it lists', async () => {
    const body = await get();
    expect(body.byChannel.loomiEmail.campaigns).toBe(612);
    // 612 Loomi email + 1 historical email + 1 text.
    expect(body.summary.sends).toBe(614);
  });

  it('keeps every rate at or under 100%, even the previous provider’s', async () => {
    const body = await get();
    const history = body.blasts.find((b: { id: string }) => b.id === 'other-email:ghl-1');
    expect(history.openRate).toBe(1);
    walk(body, (key, v) => {
      if (key && /rate$/i.test(key) && typeof v === 'number') {
        expect(v).toBeLessThanOrEqual(1);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    });
    expect(body.byChannel.historicalEmail.openRate).toBe(1);
  });

  it('reports the Loomi email rates the service computed — 87.5% delivered, 12% bounced', async () => {
    const body = await get();
    expect(body.byChannel.loomiEmail).toMatchObject({
      sent: 1000,
      delivered: 875,
      bounces: 120,
      deliveryRate: 0.875,
      bounceRate: 0.12,
    });
    const row = body.blasts.find((b: { id: string }) => b.id === 'loomi-email:blast-sept');
    expect(row).toMatchObject({ sent: 1000, delivered: 875, deliveryRate: 0.875 });
  });
});
