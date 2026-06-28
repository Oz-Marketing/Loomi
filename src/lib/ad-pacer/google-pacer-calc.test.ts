import { describe, it, expect } from 'vitest';
import {
  mapChannelGroup,
  mapGoogleBudgetType,
  groupByChannel,
  accountDailyRollup,
  reconcileImport,
  type ImportedGoogleCampaign,
} from './google-pacer-calc';
import type { PacerAd } from './types';

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
  it('keeps PMax its own group (never decomposed) and is case-insensitive', () => {
    expect(mapChannelGroup('performance_max')).toBe('PMax');
  });
  it('falls unknown/empty to Other rather than guessing', () => {
    expect(mapChannelGroup('DEMAND_GEN')).toBe('Other');
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
    {
      id: 'C1',
      name: 'Search Brand',
      status: 'ENABLED',
      channelType: 'SEARCH',
      dailyBudget: 50,
      totalBudget: null,
      budgetResourceName: 'b1',
      startDate: '2026-06-01',
      endDate: null,
    },
    {
      id: 'C2',
      name: 'PMax Renamed',
      status: 'ENABLED',
      channelType: 'PERFORMANCE_MAX',
      dailyBudget: 100,
      totalBudget: null,
      budgetResourceName: 'b2',
      startDate: '2026-06-01',
      endDate: null,
    },
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
