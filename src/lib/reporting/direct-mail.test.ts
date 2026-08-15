import { describe, it, expect } from 'vitest';
import { withMetrics, withRoi, rollUp, type CampaignRow } from './direct-mail';

const campaign = (o: Partial<CampaignRow> = {}): CampaignRow => ({
  id: 'c1',
  campaignName: 'Spring Service',
  mailerType: 'LS',
  mailedFrom: '2026-03-01',
  mailedTo: '2026-03-05',
  marketed: 0,
  engaged: 0,
  offerRequests: null,
  matchedCustomers: 0,
  matchedRos: 0,
  directMatches: 0,
  indirectMatches: 0,
  customerPay: 0,
  warrantyPay: 0,
  ...o,
});

describe('withMetrics', () => {
  it('derives revenue, rates, and per-unit figures', () => {
    const m = withMetrics(
      campaign({
        marketed: 10_000,
        engaged: 800,
        matchedCustomers: 250,
        matchedRos: 300,
        customerPay: 45_000,
        warrantyPay: 15_000,
      }),
    );
    expect(m.revenue).toBe(60_000);
    expect(m.matchbackRate).toBe(2.5);
    expect(m.engagementRate).toBe(8);
    expect(m.revenuePerRo).toBe(200);
    expect(m.revenuePerPiece).toBe(6);
  });

  it('rates use MATCHED CUSTOMERS, not matched ROs', () => {
    // One customer coming back twice is one person reached, two ROs. Dividing
    // ROs by pieces mailed would report a matchback rate above the number of
    // people who actually responded.
    const m = withMetrics(
      campaign({ marketed: 100, matchedCustomers: 10, matchedRos: 20 }),
    );
    expect(m.matchbackRate).toBe(10);
  });

  it('returns nulls rather than NaN for an unmailed or unmatched campaign', () => {
    const m = withMetrics(campaign({ marketed: 0, matchedRos: 0, customerPay: 0 }));
    expect(m.matchbackRate).toBeNull();
    expect(m.engagementRate).toBeNull();
    expect(m.revenuePerRo).toBeNull();
    expect(m.revenuePerPiece).toBeNull();
    expect(m.revenue).toBe(0);
  });
});

describe('withRoi', () => {
  it('computes net, return, and cost per RO from a supplied cost', () => {
    const r = withRoi(60_000, 300, 12_000);
    expect(r.cost).toBe(12_000);
    expect(r.net).toBe(48_000);
    expect(r.roiPct).toBe(400);
    expect(r.costPerRo).toBe(40);
  });

  it('reports a NULL return when nobody has costed the campaign', () => {
    // ODT called this report "ROI" while having no cost input at all. Null is
    // the honest answer — a fixable data gap, not a number.
    const r = withRoi(60_000, 300, null);
    expect(r.cost).toBeNull();
    expect(r.roiPct).toBeNull();
    expect(r.net).toBeNull();
    expect(r.costPerRo).toBeNull();
  });

  it('treats a zero cost as uncosted rather than as infinite return', () => {
    const r = withRoi(60_000, 300, 0);
    expect(r.roiPct).toBeNull();
    expect(Number.isFinite(r.roiPct ?? 0)).toBe(true);
  });

  it('reports a negative return when the mail lost money', () => {
    const r = withRoi(5_000, 20, 20_000);
    expect(r.net).toBe(-15_000);
    expect(r.roiPct).toBe(-75);
  });

  it('reports a null cost-per-RO when nothing matched', () => {
    const r = withRoi(0, 0, 8_000);
    expect(r.costPerRo).toBeNull();
    expect(r.roiPct).toBe(-100);
  });
});

describe('rollUp', () => {
  it('recomputes rates from summed parts, never averaging across campaigns', () => {
    // A 500-piece campaign at 20% and a 50,000-piece campaign at 1%. Averaging
    // the two rates gives 10.5%; the true blended rate is 1.19%.
    const small = withMetrics(campaign({ id: 'a', marketed: 500, matchedCustomers: 100 }));
    const large = withMetrics(campaign({ id: 'b', marketed: 50_000, matchedCustomers: 500 }));
    const t = rollUp([small, large]);

    expect(t.marketed).toBe(50_500);
    expect(t.matchedCustomers).toBe(600);
    expect(t.matchbackRate).toBe(1.2); // 600 / 50 500 → 1.19 → 1.2
    expect(t.matchbackRate).not.toBe(10.5);
  });

  it('sums revenue and the direct/indirect split', () => {
    const t = rollUp([
      withMetrics(
        campaign({ id: 'a', customerPay: 10_000, warrantyPay: 2_000, directMatches: 5, indirectMatches: 3, matchedRos: 8 }),
      ),
      withMetrics(
        campaign({ id: 'b', customerPay: 20_000, warrantyPay: 0, directMatches: 10, indirectMatches: 2, matchedRos: 12 }),
      ),
    ]);
    expect(t.revenue).toBe(32_000);
    expect(t.directMatches).toBe(15);
    expect(t.indirectMatches).toBe(5);
    // The split accounts for every matched RO.
    expect(t.directMatches + t.indirectMatches).toBe(t.matchedRos);
    expect(t.revenuePerRo).toBe(1_600);
  });

  it('returns an empty roll-up without dividing by zero', () => {
    const t = rollUp([]);
    expect(t.campaigns).toBe(0);
    expect(t.revenue).toBe(0);
    expect(t.matchbackRate).toBeNull();
    expect(t.revenuePerRo).toBeNull();
  });
});
