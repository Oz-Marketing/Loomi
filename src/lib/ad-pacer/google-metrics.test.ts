import { describe, it, expect } from 'vitest';
import {
  campaignMetrics,
  capDelivery,
  isFutileRaise,
  impressionShareState,
  impressionShareText,
  supportsSearchImpressionShare,
} from './google-metrics';
import type { PacerAd } from './types';

const ad = (over: Partial<PacerAd> = {}): PacerAd =>
  ({ id: 'a1', name: 'Brand', platform: 'google', ...over }) as PacerAd;

describe('supportsSearchImpressionShare', () => {
  it('is Search and Shopping only', () => {
    expect(supportsSearchImpressionShare('Search')).toBe(true);
    expect(supportsSearchImpressionShare('Shopping')).toBe(true);
    expect(supportsSearchImpressionShare('PMax')).toBe(false);
    expect(supportsSearchImpressionShare('Demand Gen')).toBe(false);
    expect(supportsSearchImpressionShare('Display')).toBe(false);
    expect(supportsSearchImpressionShare('Video')).toBe(false);
    expect(supportsSearchImpressionShare(null)).toBe(false);
  });
});

/**
 * The distinction the whole move decision rests on. "0% lost to budget" says
 * don't feed this campaign; "we can't measure it here" says look at the bars
 * instead. They must never render the same way.
 */
describe('impressionShareState', () => {
  it('separates unsupported campaign types from missing readings', () => {
    expect(impressionShareState(0.4, 'PMax')).toEqual({ kind: 'unsupported' });
    // Supported type, Google withheld it (under the reporting threshold).
    expect(impressionShareState(null, 'Search')).toEqual({ kind: 'no_data' });
    expect(impressionShareState('', 'Search')).toEqual({ kind: 'no_data' });
  });

  it('reports a real zero as a value, not as missing', () => {
    // A Search campaign losing nothing to budget is a genuine, actionable
    // reading: it cannot absorb more money.
    expect(impressionShareState('0', 'Search')).toEqual({
      kind: 'value',
      value: 0,
      capped: false,
    });
  });

  it("flags Google's >90% sentinel so it isn't rendered as an exact 90%", () => {
    expect(impressionShareState(0.9, 'Search')).toEqual({
      kind: 'value',
      value: 0.9,
      capped: true,
    });
    expect(impressionShareState(0.89, 'Search')).toMatchObject({ capped: false });
  });
});

describe('impressionShareText — the expander and Compare must read alike', () => {
  it('renders the two non-figures as muted states, never as a number', () => {
    // A zero here would invert the move decision: "0% lost to budget" means the
    // campaign cannot absorb more money, while "no reading" means look at the
    // bars instead. They must never collapse into the same cell.
    expect(impressionShareText({ kind: 'unsupported' })).toEqual({
      text: 'Not available',
      muted: true,
    });
    expect(impressionShareText({ kind: 'no_data' })).toEqual({ text: 'No data', muted: true });
  });

  it('renders a real reading as a whole percent, and Google\'s 0.9 sentinel as ≥90%', () => {
    expect(impressionShareText({ kind: 'value', value: 0.6234, capped: false })).toEqual({
      text: '62%',
      muted: false,
    });
    expect(impressionShareText({ kind: 'value', value: 0.9, capped: true })).toEqual({
      text: '≥90%',
      muted: false,
    });
    // A genuine zero IS a figure, and must not be muted alongside the states.
    expect(impressionShareText({ kind: 'value', value: 0, capped: false })).toEqual({
      text: '0%',
      muted: false,
    });
  });
});

describe('campaignMetrics', () => {
  it('derives the cost ratios from the same spend the panel prints', () => {
    const m = campaignMetrics(
      ad({
        googleImpressions: 12400,
        googleClicks: 860,
        googleConversions: '14',
        googleConvRate: '0.0163',
        googleChannelType: 'Search',
        googleSearchBudgetLostIs: '0.31',
        googleSearchRankLostIs: '0.12',
        googleMetricsAsOf: '2026-08-11',
      }),
      539.04,
    );

    expect(m.ctr).toBeCloseTo(860 / 12400, 10);
    expect(m.avgCpc).toBeCloseTo(539.04 / 860, 10);
    expect(m.costPerConversion).toBeCloseTo(539.04 / 14, 10);
    expect(m.convRate).toBe(0.0163);
    expect(m.budgetLostIs).toMatchObject({ kind: 'value', value: 0.31 });
    expect(m.asOf).toBe('2026-08-11');
    expect(m.neverSynced).toBe(false);
  });

  it('withholds BOTH conversion figures below the floor', () => {
    // Two conversions on $539 is a $269 CPA that one more lead would halve.
    const thin = campaignMetrics(
      ad({ googleClicks: 400, googleConversions: '2', googleConvRate: '0.005' }),
      539.04,
    );
    expect(thin.costPerConversion).toBeNull();
    expect(thin.convRate).toBeNull();
    // The raw count is still shown — it is a fact, unlike the ratio built on it.
    expect(thin.conversions).toBe(2);
    // Non-conversion figures are unaffected by the floor.
    expect(thin.avgCpc).toBeCloseTo(539.04 / 400, 10);
  });

  it('reports the floor boundary inclusively', () => {
    const at = campaignMetrics(ad({ googleConversions: '3' }), 300);
    expect(at.costPerConversion).toBe(100);
  });

  it('returns null rather than Infinity when a denominator is zero', () => {
    const zero = campaignMetrics(
      ad({ googleImpressions: 0, googleClicks: 0, googleConversions: '0' }),
      0,
    );
    expect(zero.ctr).toBeNull();
    expect(zero.avgCpc).toBeNull();
    expect(zero.costPerConversion).toBeNull();
    // Synced with real zeros — not the same as never having synced.
    expect(zero.conversions).toBe(0);
  });

  it('distinguishes a never-synced row from one that measured zero', () => {
    expect(campaignMetrics(ad(), 0).neverSynced).toBe(true);
    expect(campaignMetrics(undefined, 0).neverSynced).toBe(true);
    expect(
      campaignMetrics(ad({ googleMetricsAsOf: '2026-08-11', googleImpressions: 0 }), 0)
        .neverSynced,
    ).toBe(false);
  });

  it('marks impression share unsupported on a PMax row even if a value is stored', () => {
    const pmax = campaignMetrics(
      ad({ googleChannelType: 'PMax', googleSearchBudgetLostIs: '0.5' }),
      100,
    );
    expect(pmax.budgetLostIs).toEqual({ kind: 'unsupported' });
    expect(pmax.rankLostIs).toEqual({ kind: 'unsupported' });
  });
});

/**
 * The retag (§8). The case that motivated it: a Search campaign Google flagged
 * BUDGET_CONSTRAINED while it averaged ~$37–47/day against a $64 cap. The old
 * tag believed the flag, told the desk the campaign "spends its full daily every
 * day", and the obvious response — give it more money — was the exact wrong one.
 */
describe('isFutileRaise (§14)', () => {
  const atCap = { atCap: true, basis: 'budget_lost_is' as const, budgetLostIs: 0.4, ratio: null };
  const notAtCap = {
    atCap: false,
    basis: 'budget_lost_is' as const,
    budgetLostIs: 0.01,
    ratio: null,
  };
  const noEvidence = {
    atCap: false,
    basis: 'unknown' as const,
    budgetLostIs: null,
    ratio: null,
  };

  it('flags a raise on a campaign that is not filling the cap it already has', () => {
    // Price Point: $47/day actual against a $64 cap, told to go to $63. The
    // constraint is demand, so the raise changes the number and nothing else.
    expect(
      isFutileRaise({ currentDaily: 47, recommendedDaily: 63, delivery: notAtCap }),
    ).toBe(true);
  });

  it('stays quiet when the campaign IS pinned to its cap — that raise works', () => {
    expect(isFutileRaise({ currentDaily: 47, recommendedDaily: 63, delivery: atCap })).toBe(false);
  });

  it('never flags a cut: a cut always takes effect', () => {
    // This is the case that frees money for the campaigns that can spend it, so
    // discouraging it would invert the advice.
    expect(isFutileRaise({ currentDaily: 75, recommendedDaily: 38.55, delivery: notAtCap })).toBe(
      false,
    );
    expect(isFutileRaise({ currentDaily: 50, recommendedDaily: 50, delivery: notAtCap })).toBe(
      false,
    );
  });

  it('says nothing when there is no evidence either way', () => {
    // No impression share AND no finalized bars — guessing at the ceiling here
    // would put a warning on a brand-new campaign that has simply not run yet.
    expect(isFutileRaise({ currentDaily: 20, recommendedDaily: 60, delivery: noEvidence })).toBe(
      false,
    );
  });

  it('says nothing when there is no current daily to compare against', () => {
    expect(isFutileRaise({ currentDaily: 0, recommendedDaily: 60, delivery: notAtCap })).toBe(
      false,
    );
  });
});

describe('capDelivery', () => {
  const bars = (...spends: number[]) =>
    spends.map((spend, i) => ({ date: `2026-08-0${i + 1}`, spend }));
  const base = {
    channelType: 'Search',
    series: bars(60, 62, 61, 63),
    cap: 64,
    dataEdgeIso: '2026-08-04',
  };

  it('needs BOTH the flag and real lost impression share on Search', () => {
    const real = capDelivery({ ...base, budgetConstrained: true, budgetLostIsRaw: '0.31' });
    expect(real).toMatchObject({ atCap: true, basis: 'budget_lost_is', budgetLostIs: 0.31 });

    // The Price Point case: Google says budget-constrained, impression share
    // says almost nothing is being lost to budget. The tag comes off.
    const flagOnly = capDelivery({ ...base, budgetConstrained: true, budgetLostIsRaw: '0.01' });
    expect(flagOnly.atCap).toBe(false);
    expect(flagOnly.basis).toBe('budget_lost_is');

    // And high IS without the flag is not enough either.
    expect(
      capDelivery({ ...base, budgetConstrained: false, budgetLostIsRaw: '0.31' }).atCap,
    ).toBe(false);
  });

  it('ignores the bars entirely when impression share is available', () => {
    // Bars pinned to the cap, but Google says nothing is lost to budget — the
    // real signal wins, because the campaign is simply small, not throttled.
    const pinned = capDelivery({
      ...base,
      series: bars(64, 64, 64),
      budgetConstrained: true,
      budgetLostIsRaw: '0',
    });
    expect(pinned.atCap).toBe(false);
    expect(pinned.ratio).toBeNull();
  });

  it('falls back to the bars for PMax, which reports no impression share', () => {
    const atCap = capDelivery({
      ...base,
      channelType: 'PMax',
      series: bars(60, 62, 61, 63),
      budgetConstrained: true,
      budgetLostIsRaw: null,
    });
    expect(atCap).toMatchObject({ atCap: true, basis: 'bars' });

    const wellUnder = capDelivery({
      ...base,
      channelType: 'PMax',
      series: bars(37, 42, 47, 40),
      budgetConstrained: true,
      budgetLostIsRaw: null,
    });
    expect(wellUnder.atCap).toBe(false);
    expect(wellUnder.ratio).toBeCloseTo(41.5 / 64, 5);
  });

  it('falls back to the bars on Search too when Google withheld the reading', () => {
    const noIs = capDelivery({ ...base, budgetConstrained: true, budgetLostIsRaw: null });
    expect(noIs.basis).toBe('bars');
    expect(noIs.atCap).toBe(true);
  });

  it("keeps today's partial day out of the bars average", () => {
    // Four full days at cap plus a partial today. Counting today would drag the
    // average to 51.2 and take the tag off a campaign that is at cap.
    const withToday = capDelivery({
      ...base,
      channelType: 'PMax',
      series: [...bars(64, 64, 64, 64), { date: '2026-08-05', spend: 9 }],
      dataEdgeIso: '2026-08-04',
      budgetConstrained: true,
      budgetLostIsRaw: null,
    });
    expect(withToday.atCap).toBe(true);
    expect(withToday.ratio).toBe(1);
  });

  it('says "unknown" rather than guessing with no cap or no history', () => {
    expect(
      capDelivery({ ...base, channelType: 'PMax', cap: 0, budgetConstrained: true, budgetLostIsRaw: null }),
    ).toMatchObject({ atCap: false, basis: 'unknown' });
    expect(
      capDelivery({ ...base, channelType: 'PMax', series: [], budgetConstrained: true, budgetLostIsRaw: null }),
    ).toMatchObject({ atCap: false, basis: 'unknown' });
  });
});
