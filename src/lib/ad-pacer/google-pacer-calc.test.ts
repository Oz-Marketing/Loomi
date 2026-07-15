import { describe, it, expect } from 'vitest';
import {
  mapChannelGroup,
  mapGoogleBudgetType,
  googlePacingTypeLabel,
  isSharedBudget,
  computeProratedCeiling,
  buildGooglePacingCard,
  groupByChannel,
  accountDailyRollup,
  reconcileImport,
  type ImportedGoogleCampaign,
} from './google-pacer-calc';
import type { PacerAd } from './types';

// ImportedGoogleCampaign factory with the §2/§5 fields defaulted.
function imp(overrides: Partial<ImportedGoogleCampaign>): ImportedGoogleCampaign {
  return {
    id: 'C',
    name: 'Campaign',
    status: 'ENABLED',
    channelType: 'SEARCH',
    dailyBudget: 50,
    totalBudget: null,
    budgetResourceName: 'b1',
    startDate: '2026-06-01',
    endDate: null,
    budgetReferenceCount: 1,
    budgetExplicitlyShared: false,
    budgetPeriod: 'DAILY',
    primaryStatus: 'ELIGIBLE',
    budgetConstrained: false,
    adsDisapproved: false,
    ...overrides,
  };
}

const NOW = Date.UTC(2026, 5, 15, 18, 0, 0); // 2026-06-15 12:00 MDT
const TZ = 'America/Denver';

// Minimal Google PacerAd. buildAdCalc/isEligibleForLivePacing read status, budget
// type, flight dates, allocation, pacerActual, pacerDailyBudget — set enough.
function gAd(overrides: Partial<PacerAd>): PacerAd {
  return {
    id: 'ad' + Math.round((overrides.allocation ? Number(overrides.allocation) : 0)),
    name: 'Campaign',
    platform: 'google',
    adStatus: 'Live',
    budgetType: 'Daily',
    period: '2026-06',
    flightStart: '2026-06-01',
    flightEnd: '2026-06-30',
    metaStartDate: null,
    metaEndDate: null,
    liveDate: null,
    allocation: '1000',
    pacerActual: '300',
    pacerDailyBudget: '50',
    googleChannelType: 'SEARCH',
    googleBudgetResourceName: null,
    fullRunAppliedToMonth: null,
    ...overrides,
  } as unknown as PacerAd;
}

describe('mapChannelGroup (§8 — PMax its own group)', () => {
  it('maps the known channel types', () => {
    expect(mapChannelGroup('SEARCH')).toBe('Search');
    expect(mapChannelGroup('DISPLAY')).toBe('Display');
    expect(mapChannelGroup('VIDEO')).toBe('Video');
    expect(mapChannelGroup('SHOPPING')).toBe('Shopping');
    expect(mapChannelGroup('PERFORMANCE_MAX')).toBe('PMax');
  });
  it('keeps PMax + Demand Gen their own groups (never decomposed), case-insensitive', () => {
    expect(mapChannelGroup('performance_max')).toBe('PMax');
    expect(mapChannelGroup('DEMAND_GEN')).toBe('Demand Gen');
    expect(mapChannelGroup('demand_gen')).toBe('Demand Gen');
  });
  it('falls unknown/empty to Other rather than guessing', () => {
    expect(mapChannelGroup('UNKNOWN_TYPE')).toBe('Other');
    expect(mapChannelGroup('')).toBe('Other');
    expect(mapChannelGroup(null)).toBe('Other');
  });
});

describe('mapGoogleBudgetType', () => {
  it('total budget → Lifetime, else Daily', () => {
    expect(mapGoogleBudgetType(50, null)).toBe('Daily');
    expect(mapGoogleBudgetType(null, 5000)).toBe('Lifetime');
    expect(mapGoogleBudgetType(null, 0)).toBe('Daily'); // 0 total is not lifetime
    expect(mapGoogleBudgetType(null, null)).toBe('Daily');
  });
});

describe('groupByChannel (display rollup)', () => {
  it('groups Google lines by channel, sums allocation/actual, skips non-google', () => {
    const ads = [
      gAd({ googleChannelType: 'SEARCH', allocation: '100', pacerActual: '40' }),
      gAd({ googleChannelType: 'SEARCH', allocation: '200', pacerActual: '60' }),
      gAd({ googleChannelType: 'PERFORMANCE_MAX', allocation: '500', pacerActual: '300' }),
      gAd({ platform: 'meta', googleChannelType: null, allocation: '999' }),
    ];
    const groups = groupByChannel(ads);
    const search = groups.find((g) => g.group === 'Search');
    const pmax = groups.find((g) => g.group === 'PMax');
    expect(search).toMatchObject({ count: 2, allocation: 300, actual: 100 });
    expect(pmax).toMatchObject({ count: 1, allocation: 500, actual: 300 });
    // the Meta line is not grouped
    expect(groups.reduce((s, g) => s + g.count, 0)).toBe(3);
  });
});

describe('accountDailyRollup (§8 daily set vs needed)', () => {
  it('sums distinct daily budgets (dedupes shared budgets) for daily-set', () => {
    const ads = [
      gAd({ pacerDailyBudget: '50', googleBudgetResourceName: 'b1' }),
      gAd({ pacerDailyBudget: '30', googleBudgetResourceName: 'b1' }), // shares b1 → not double-counted
      gAd({ pacerDailyBudget: '20', googleBudgetResourceName: 'b2' }),
    ];
    const r = accountDailyRollup(ads, NOW, TZ);
    expect(r.dailySet).toBeCloseTo(70); // 50 (b1, once) + 20 (b2)
    expect(r.eligibleCount).toBe(3);
    expect(r.monthlyCeiling).toBeCloseTo(70 * 30.4);
  });

  it('excludes imported-but-unallocated lines (allocation 0)', () => {
    const ads = [
      gAd({ allocation: '0', pacerDailyBudget: '50', googleBudgetResourceName: 'b1' }),
    ];
    const r = accountDailyRollup(ads, NOW, TZ);
    expect(r.eligibleCount).toBe(0);
    expect(r.dailySet).toBe(0);
  });

  it('excludes not-started and non-Google lines', () => {
    const ads = [
      gAd({ flightStart: '2026-06-25', pacerDailyBudget: '50' }), // not started
      gAd({ platform: 'meta', pacerDailyBudget: '99' }), // not Google
    ];
    expect(accountDailyRollup(ads, NOW, TZ).eligibleCount).toBe(0);
  });

  it('folds an in-progress lifetime campaign in as an implied daily', () => {
    const ads = [
      gAd({
        budgetType: 'Lifetime',
        allocation: '300',
        pacerDailyBudget: null,
        googleBudgetResourceName: 'b3',
      }),
    ];
    const r = accountDailyRollup(ads, NOW, TZ);
    expect(r.eligibleCount).toBe(1);
    // implied daily = allocation ÷ flight days (~30) — positive, far below the total
    expect(r.dailySet).toBeGreaterThan(0);
    expect(r.dailySet).toBeLessThan(300);
  });

  it('daily-needed rises when a campaign is underspending', () => {
    const behind = accountDailyRollup(
      [gAd({ allocation: '3000', pacerActual: '100', pacerDailyBudget: '50' })],
      NOW,
      TZ,
    );
    expect(behind.dailyNeeded).toBeGreaterThan(0);
  });
});

describe('reconcileImport (adds / removes / changes, never overwrites)', () => {
  const imported: ImportedGoogleCampaign[] = [
    imp({ id: 'C1', name: 'Search Brand', channelType: 'SEARCH', dailyBudget: 50, budgetResourceName: 'b1' }),
    imp({
      id: 'C2',
      name: 'PMax Renamed',
      channelType: 'PERFORMANCE_MAX',
      dailyBudget: 100,
      budgetResourceName: 'b2',
    }),
  ];

  it('flags a new campaign as an add', () => {
    const diff = reconcileImport(imported, []);
    expect(diff.adds.map((c) => c.id).sort()).toEqual(['C1', 'C2']);
    expect(diff.removes).toHaveLength(0);
  });

  it('flags a renamed campaign as a change, not an add', () => {
    const existing = [
      gAd({ id: 'a2', name: 'PMax Original', googleCampaignId: 'C2' }),
    ];
    const diff = reconcileImport(imported, existing);
    expect(diff.adds.map((c) => c.id)).toEqual(['C1']); // C2 already linked
    const nameChange = diff.changes.find((c) => c.googleCampaignId === 'C2' && c.field === 'name');
    expect(nameChange).toMatchObject({ from: 'PMax Original', to: 'PMax Renamed' });
  });

  it('flags a linked card whose campaign vanished as a remove', () => {
    const existing = [gAd({ id: 'a9', name: 'Gone', googleCampaignId: 'C9' })];
    const diff = reconcileImport(imported, existing);
    expect(diff.removes).toEqual([{ adId: 'a9', name: 'Gone', googleCampaignId: 'C9' }]);
  });

  it('ignores Meta lines entirely', () => {
    const existing = [gAd({ id: 'm1', platform: 'meta', googleCampaignId: null })];
    const diff = reconcileImport(imported, existing);
    expect(diff.removes).toHaveLength(0); // the Meta line is not a Google card
    expect(diff.adds).toHaveLength(2);
  });
});

describe('googlePacingTypeLabel (§2 Daily/Total)', () => {
  it('prefers the platform period when present', () => {
    expect(googlePacingTypeLabel('CUSTOM_PERIOD', 'Daily')).toBe('Total');
    expect(googlePacingTypeLabel('DAILY', 'Lifetime')).toBe('Daily');
  });
  it('falls back to the budget type when period is absent', () => {
    expect(googlePacingTypeLabel(null, 'Lifetime')).toBe('Total');
    expect(googlePacingTypeLabel(undefined, 'Daily')).toBe('Daily');
  });
});

describe('isSharedBudget (§2 — keys off reference_count > 1)', () => {
  it('only flags genuinely-shared budgets', () => {
    expect(isSharedBudget(1)).toBe(false); // shareable-but-single is NOT shared
    expect(isSharedBudget(2)).toBe(true);
    expect(isSharedBudget(0)).toBe(false);
    expect(isSharedBudget(null)).toBe(false);
  });
});

describe('computeProratedCeiling (§9)', () => {
  it('constant rate → daily × 30.4', () => {
    expect(computeProratedCeiling([], 50, '2026-06-01', '2026-06-30')).toBeCloseTo(50 * 30.4);
  });
  it('reprorates a mid-month change by calendar-day weight', () => {
    // $50/day for the first 15 days, $100/day for the last 15 → avg $75 → ×30.4.
    const ceiling = computeProratedCeiling(
      [
        { date: '2026-06-01', dailyRate: 50 },
        { date: '2026-06-16', dailyRate: 100 },
      ],
      100,
      '2026-06-01',
      '2026-06-30',
    );
    expect(ceiling).toBeCloseTo(75 * 30.4);
  });
});

describe('buildGooglePacingCard (§5 ceiling card + status)', () => {
  it('daily campaign: ceiling = daily × 30.4, rec = the CATCH-UP rate', () => {
    const card = buildGooglePacingCard(gAd({}), NOW, TZ);
    expect(card.pacingType).toBe('Daily');
    expect(card.shared).toBe(false);
    expect(card.monthlyCeiling).toBeCloseTo(50 * 30.4);
    // (target − actual) ÷ remaining calendar days — (1000 − 300) / 15.5 —
    // NOT target / 30.4 (only correct at the very start of the month).
    expect(card.recommendedDaily).toBeCloseTo(700 / 15.5, 2);
    // $300 in 14.5 days is a ~$20.7/day run rate against a $1,520 ceiling —
    // the campaign can't spend its budget, so it reads delivery-limited/under
    // (the old projection-vs-target band hid this).
    expect(card.recommendation?.state).toBe('delivery_limited');
    expect(card.status).toBe('under');
  });

  it('on-track daily campaign: ceiling matches target and it is delivering', () => {
    // Ceiling 33 × 30.4 = 1003.20 ≈ target 1000; delivering to expected-to-date.
    const card = buildGooglePacingCard(
      gAd({ pacerDailyBudget: '33', pacerActual: '485' }),
      NOW,
      TZ,
    );
    expect(card.recommendation?.state).toBe('on_track');
    expect(card.status).toBe('on-track');
  });

  it('over-funded + delivering → trim to the catch-up rate, reads over', () => {
    // Ceiling 1520 well above target 1000, spend tracking the ceiling pace.
    const card = buildGooglePacingCard(gAd({ pacerActual: '735' }), NOW, TZ);
    expect(card.recommendation?.state).toBe('adjust');
    expect(card.recommendation?.direction).toBe('trim');
    expect(card.status).toBe('over');
  });

  it('prefers the server-reprorated ceiling; a ceiling under target reads under (raise), not "over"', () => {
    const card = buildGooglePacingCard(
      gAd({ googleProratedCeiling: '500', pacerDailyBudget: '40' }),
      NOW,
      TZ,
    );
    expect(card.monthlyCeiling).toBeCloseTo(500);
    // Old logic flagged "over" because the linear projection exceeded the
    // ceiling — an artifact, per spec §5. The real signal is ceiling ($500)
    // vs target ($1000): underfunded → raise to the catch-up rate
    // ((1000 − 300) / 15.5 ≈ $45.16 > current $40).
    expect(card.recommendation?.state).toBe('adjust');
    expect(card.recommendation?.direction).toBe('raise');
    expect(card.status).toBe('under');
  });

  it('caps the projection at the monthly ceiling (Google never bills past it)', () => {
    // Delivering at/above ceiling pace: linear extrapolation would exceed the
    // ceiling; the card must not show a figure Google will not charge.
    const card = buildGooglePacingCard(gAd({ pacerActual: '760' }), NOW, TZ);
    expect(card.projected).toBeLessThanOrEqual(card.monthlyCeiling + 0.005);
  });

  it('disapproved underspender → under + disapproved flag (fix ads, not budget)', () => {
    const card = buildGooglePacingCard(
      gAd({ pacerActual: '100', pacerDailyBudget: '10', googleAdsDisapproved: true }),
      NOW,
      TZ,
    );
    expect(card.status).toBe('under');
    expect(card.disapproved).toBe(true);
  });

  it('budget-limited: ceiling under target → ceilingShortOfTarget + budgetLimited', () => {
    const card = buildGooglePacingCard(
      gAd({ pacerDailyBudget: '20', googleBudgetConstrained: true }),
      NOW,
      TZ,
    );
    expect(card.ceilingShortOfTarget).toBe(true); // 20 × 30.4 = 608 < 1000 target
    expect(card.budgetLimited).toBe(true);
  });

  it('shared budget surfaces the group size', () => {
    const card = buildGooglePacingCard(gAd({ googleBudgetReferenceCount: 3 }), NOW, TZ);
    expect(card.shared).toBe(true);
    expect(card.sharedCount).toBe(3);
  });

  it('total-budget campaign never reads "over" (paces to its own end date)', () => {
    const onTrack = buildGooglePacingCard(
      gAd({ budgetType: 'Lifetime', googleBudgetPeriod: 'CUSTOM_PERIOD', pacerActual: '950', pacerDailyBudget: null }),
      NOW,
      TZ,
    );
    expect(onTrack.pacingType).toBe('Total');
    expect(onTrack.status).toBe('on-track');
    const interrupted = buildGooglePacingCard(
      gAd({ budgetType: 'Lifetime', googleBudgetPeriod: 'CUSTOM_PERIOD', pacerActual: '100', pacerDailyBudget: null }),
      NOW,
      TZ,
    );
    expect(interrupted.status).toBe('under');
  });
});
