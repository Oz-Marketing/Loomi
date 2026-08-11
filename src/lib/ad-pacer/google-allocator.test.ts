import { describe, it, expect } from 'vitest';
import {
  balance,
  buildAllocatorLine,
  buildAllocatorView,
  buildPushPlan,
  convertMode,
  deliveryVerdict,
  flightDayCounts,
  planMove,
  resolveClock,
  resolveFlight,
  resolvePayable,
  sourceAvailable,
  targetOf,
  type AllocationMode,
  type AllocatorLine,
} from './google-allocator';
import type { PacerAd } from './types';

// The mockup's scenario, so the numbers here are checkable against the spec's own
// worked example: August 2026 (31 days), data through Aug 7, viewed on Aug 8.
const PERIOD = '2026-08';
const TODAY = '2026-08-08';
const PAYABLE = 3529.73;

/** Series covering Aug 1–7 — makes the data edge the 7th. */
const SERIES_TO_7 = Array.from({ length: 7 }, (_, i) => `2026-08-0${i + 1}`);

function mk(overrides: Partial<PacerAd> = {}): PacerAd {
  return {
    id: overrides.id ?? 'a1',
    name: 'Yamaha',
    period: PERIOD,
    platform: 'google',
    adStatus: 'Live',
    budgetType: 'Daily',
    googleBudgetPeriod: 'DAILY',
    allocation: null,
    allocationPercent: null,
    pacerActual: null,
    pacerDailyBudget: null,
    pacerLocked: false,
    pacerTags: null,
    flightStart: null,
    flightEnd: null,
    liveDate: null,
    metaStartDate: null,
    metaEndDate: null,
    googleStartDate: null,
    googleEndDate: null,
    googleFlightStartOverride: null,
    googleFlightEndOverride: null,
    ...overrides,
  } as unknown as PacerAd;
}

const CLOCK = resolveClock(PERIOD, TODAY, SERIES_TO_7);

/** Build a line straight from numbers, for the algebra-only checks. */
function line(overrides: Partial<AllocatorLine> & { id: string }): AllocatorLine {
  return {
    name: overrides.id,
    colorIndex: 0,
    input: 0,
    target: 0,
    percentOfPayable: 0,
    spentMTD: 0,
    expectedToDate: 0,
    paceDelta: 0,
    paceRatio: null,
    paceStatus: 'none',
    evenDaily: 0,
    recommendedDaily: 0,
    remainingBudget: 0,
    projectedSpend: null,
    currentDaily: 0,
    flight: flightDayCounts(1, 31, 7, 31),
    locked: false,
    tags: [],
    pacingType: 'Daily',
    shared: false,
    sharedCount: null,
    hasAdSchedule: false,
    budgetLimited: false,
    disapproved: false,
    dailyControllable: true,
    ...overrides,
  } as AllocatorLine;
}

describe('resolvePayable (§2)', () => {
  it("is client gross × markup — the mockup's $4,396 → $3,529.73", () => {
    // The mockup's own pair implies a 0.80294 markup, which is what makes
    // "total budget" and "adjusted payable" the gross/spend pair they look like.
    const { totalBudget, payable } = resolvePayable({
      baseBudgetGoal: '4396',
      addedBudgetGoal: null,
      markup: 0.80294,
    });
    expect(totalBudget).toBe(4396);
    expect(payable).toBeCloseTo(3529.73, 1);
  });

  it('sums the base and added goals', () => {
    const { totalBudget, payable } = resolvePayable({
      baseBudgetGoal: '3000',
      addedBudgetGoal: '1000',
      markup: 0.8,
    });
    expect(totalBudget).toBe(4000);
    expect(payable).toBe(3200);
  });

  it('never folds in a carryover — the payable is the typed budget only', () => {
    // Regression guard for the deliberate divergence from the Planner's budget
    // panels: prior-month over/under is applied by hand into the goal, so an
    // allocator that also added it would double-count it.
    const { payable } = resolvePayable({
      baseBudgetGoal: '1000',
      addedBudgetGoal: null,
      markup: 1,
    });
    expect(payable).toBe(1000);
  });

  it('treats an unset markup as 0 rather than silently assuming 1', () => {
    expect(resolvePayable({ baseBudgetGoal: '1000', addedBudgetGoal: null, markup: null }).payable)
      .toBe(0);
  });
});

describe('resolveClock — the data edge (§2/§10)', () => {
  it('is the last settled day: data through Aug 7, viewed on Aug 8', () => {
    expect(CLOCK.dataEdgeDay).toBe(7);
    expect(CLOCK.dataEdgeIso).toBe('2026-08-07');
    expect(CLOCK.todayDay).toBe(8);
    expect(CLOCK.daysInMonth).toBe(31);
    expect(CLOCK.stale).toBe(false);
  });

  it('caps at yesterday even when the series already has a partial today', () => {
    const clock = resolveClock(PERIOD, TODAY, [...SERIES_TO_7, '2026-08-08']);
    expect(clock.dataEdgeDay).toBe(7);
  });

  it('follows a LAGGING series rather than assuming yesterday (§10)', () => {
    // Sync is three days behind. Spend and days must stop at the same instant,
    // so the edge is the series edge, and the card can say it is stale.
    const clock = resolveClock(PERIOD, TODAY, ['2026-08-01', '2026-08-02', '2026-08-04']);
    expect(clock.dataEdgeDay).toBe(4);
    expect(clock.stale).toBe(true);
  });

  it('has no settled day on the 1st of the month', () => {
    const clock = resolveClock(PERIOD, '2026-08-01', []);
    expect(clock.dataEdgeDay).toBe(0);
    expect(clock.dataEdgeIso).toBeNull();
  });

  it('treats a past month as fully settled', () => {
    const clock = resolveClock('2026-07', TODAY, []);
    expect(clock.dataEdgeDay).toBe(31);
    expect(clock.todayDay).toBeNull();
  });

  it('treats a future month as not started', () => {
    const clock = resolveClock('2026-09', TODAY, []);
    expect(clock.dataEdgeDay).toBe(0);
  });

  it('is stable across a day with no new settled data (AC 7)', () => {
    // Same series, three different moments on Aug 8 — the edge cannot move,
    // which is what removes the intra-day sawtooth.
    const morning = resolveClock(PERIOD, TODAY, SERIES_TO_7);
    const evening = resolveClock(PERIOD, TODAY, SERIES_TO_7);
    expect(morning.dataEdgeDay).toBe(evening.dataEdgeDay);
    expect(morning.dataEdgeDay).toBe(7);
  });
});

describe('flightDayCounts (§6)', () => {
  it('full month with the edge at 7: 31 total, 7 elapsed, 24 remaining', () => {
    expect(flightDayCounts(1, 31, 7, 31)).toMatchObject({
      total: 31,
      elapsed: 7,
      remaining: 24,
      fullMonth: true,
    });
  });

  it('a mid-month launch paces its OWN window (AC 4)', () => {
    // Started the 6th: 26 flight days, 2 of them settled, still 24 to go.
    expect(flightDayCounts(6, 31, 7, 31)).toMatchObject({
      total: 26,
      elapsed: 2,
      remaining: 24,
      fullMonth: false,
    });
  });

  it('a flight ending mid-month stops counting at its end', () => {
    expect(flightDayCounts(1, 15, 7, 31)).toMatchObject({
      total: 15,
      elapsed: 7,
      remaining: 8,
    });
  });

  it('a finished flight has no remaining days', () => {
    expect(flightDayCounts(1, 5, 7, 31)).toMatchObject({
      total: 5,
      elapsed: 5,
      remaining: 0,
    });
  });

  it('a not-yet-started flight has nothing elapsed and its whole window left', () => {
    expect(flightDayCounts(20, 31, 7, 31)).toMatchObject({
      total: 12,
      elapsed: 0,
      remaining: 12,
    });
  });

  it('nothing is elapsed before the first settled day', () => {
    expect(flightDayCounts(1, 31, 0, 31)).toMatchObject({
      total: 31,
      elapsed: 0,
      remaining: 31,
    });
  });
});

describe('resolveFlight — month clamping (§6, AC 5)', () => {
  it('gives a long-running campaign the full month, not its lifetime start', () => {
    const flight = resolveFlight(mk({ googleStartDate: '2024-03-11' }), CLOCK);
    expect(flight).toMatchObject({ startDay: 1, endDay: 31, total: 31, fullMonth: true });
  });

  it("uses the campaign's own start when it launched this month", () => {
    const flight = resolveFlight(mk({ googleStartDate: '2026-08-06' }), CLOCK);
    expect(flight).toMatchObject({ startDay: 6, total: 26, elapsed: 2, remaining: 24 });
  });

  it('honors a manual funding-window override', () => {
    const flight = resolveFlight(
      mk({ googleStartDate: '2026-08-01', googleFlightStartOverride: '2026-08-12' }),
      CLOCK,
    );
    expect(flight.startDay).toBe(12);
  });
});

describe('buildAllocatorLine — pacing math (§5)', () => {
  const ctx = { mode: 'pct' as AllocationMode, payable: PAYABLE, clock: CLOCK };

  it('percent mode: target is percent of PAYABLE', () => {
    const l = buildAllocatorLine(mk({ allocationPercent: '13', pacerActual: '105' }), 0, ctx);
    expect(l.target).toBeCloseTo(458.86, 2); // 13% of 3529.73
    expect(l.percentOfPayable).toBeCloseTo(13, 2);
  });

  it('expected-to-date is target × elapsed ÷ total flight days', () => {
    const l = buildAllocatorLine(mk({ allocationPercent: '13', pacerActual: '105' }), 0, ctx);
    // 458.86 × 7/31 = 103.62
    expect(l.expectedToDate).toBeCloseTo(103.62, 1);
    expect(l.paceDelta).toBeCloseTo(1.38, 1); // spent 105 − expected 103.62
  });

  it('recommended daily is remaining budget ÷ remaining whole flight days', () => {
    const l = buildAllocatorLine(mk({ allocationPercent: '13', pacerActual: '105' }), 0, ctx);
    // (458.86 − 105) ÷ 24
    expect(l.recommendedDaily).toBeCloseTo(14.74, 2);
  });

  it('even pace ignores spend entirely (target ÷ flight days)', () => {
    const l = buildAllocatorLine(mk({ allocationPercent: '13', pacerActual: '9999' }), 0, ctx);
    expect(l.evenDaily).toBeCloseTo(458.86 / 31, 2);
  });

  it('a mid-month campaign divides by ITS remaining days, not the month\'s (AC 4)', () => {
    const l = buildAllocatorLine(
      mk({ allocationPercent: '13', pacerActual: '35', googleStartDate: '2026-08-06' }),
      0,
      ctx,
    );
    expect(l.flight.remaining).toBe(24);
    expect(l.recommendedDaily).toBeCloseTo((458.86 - 35) / 24, 1);
  });

  it('a mid-month campaign on pace for its own window reads on-track (AC 4)', () => {
    // Flight 6–31 (26 days), 2 settled. Even pace over its own window would be
    // 458.86 × 2/26 = $35.30 — spending that much is on track, even though it is
    // far below the account's 7/31 elapsed fraction.
    const l = buildAllocatorLine(
      mk({ allocationPercent: '13', pacerActual: '35.30', googleStartDate: '2026-08-06' }),
      0,
      ctx,
    );
    expect(l.paceStatus).toBe('on');
  });

  it('bands over/under at 1.12 / 0.88 of expected', () => {
    const spentFor = (ratio: number) => (458.86 * (7 / 31) * ratio).toFixed(2);
    const at = (ratio: number) =>
      buildAllocatorLine(
        mk({ allocationPercent: '13', pacerActual: spentFor(ratio) }),
        0,
        ctx,
      ).paceStatus;
    expect(at(1.3)).toBe('over');
    expect(at(1.05)).toBe('on');
    expect(at(0.95)).toBe('on');
    expect(at(0.5)).toBe('under');
  });

  it('reports no pace at all when nothing is expected yet', () => {
    const l = buildAllocatorLine(
      mk({ allocationPercent: '13' }),
      0,
      { ...ctx, clock: resolveClock(PERIOD, '2026-08-01', []) },
    );
    expect(l.paceRatio).toBeNull();
    expect(l.paceStatus).toBe('none');
  });

  it('dollar mode reads the stored dollars and still reports percent-of-payable', () => {
    const l = buildAllocatorLine(mk({ allocation: '458.86' }), 0, {
      ...ctx,
      mode: 'amt',
    });
    expect(l.target).toBeCloseTo(458.86, 2);
    expect(l.percentOfPayable).toBeCloseTo(13, 1);
  });

  it('infers a percent from stored dollars for rows predating percent mode', () => {
    const l = buildAllocatorLine(mk({ allocation: '352.97', allocationPercent: null }), 0, ctx);
    expect(l.input).toBeCloseTo(10, 1);
  });

  it('a Total-budget campaign is not daily-controllable', () => {
    const l = buildAllocatorLine(
      mk({ googleBudgetPeriod: 'CUSTOM_PERIOD', budgetType: 'Lifetime', allocation: '500' }),
      0,
      { ...ctx, mode: 'amt' },
    );
    expect(l.pacingType).toBe('Total');
    expect(l.dailyControllable).toBe(false);
  });

  it('projects where the CURRENT daily lands it, not the recommendation', () => {
    // $14.80/day already set, 24 flight days left, $105 spent.
    const l = buildAllocatorLine(
      mk({ allocationPercent: '13', pacerActual: '105', pacerDailyBudget: '14.80' }),
      0,
      ctx,
    );
    expect(l.projectedSpend).toBeCloseTo(105 + 14.8 * 24, 2);
  });

  it('withholds a projection when no daily has synced', () => {
    // A zero rate would project "will spend nothing", when the truth is that we
    // do not know the rate yet.
    const l = buildAllocatorLine(mk({ allocationPercent: '13', pacerActual: '105' }), 0, ctx);
    expect(l.projectedSpend).toBeNull();
  });

  it('reports the target still unspent, floored at zero', () => {
    const under = buildAllocatorLine(mk({ allocationPercent: '13', pacerActual: '105' }), 0, ctx);
    expect(under.remainingBudget).toBeCloseTo(458.86 - 105, 1);
    const over = buildAllocatorLine(mk({ allocationPercent: '1', pacerActual: '9999' }), 0, ctx);
    expect(over.remainingBudget).toBe(0);
  });

  it('never recommends a negative daily on an overspent campaign', () => {
    const l = buildAllocatorLine(mk({ allocationPercent: '1', pacerActual: '9999' }), 0, ctx);
    expect(l.recommendedDaily).toBe(0);
  });
});

describe('convertMode (§3, AC 2)', () => {
  it('pct → amt writes the dollars the percent already meant', () => {
    const rows = convertMode([{ id: 'a', input: 13 }], 'pct', 'amt', PAYABLE);
    expect(rows[0].input).toBeCloseTo(458.86, 2);
    expect(rows[0].target).toBeCloseTo(458.86, 2);
  });

  it('amt → pct writes the percent those dollars already were', () => {
    const rows = convertMode([{ id: 'a', input: 458.86 }], 'amt', 'pct', PAYABLE);
    expect(rows[0].input).toBeCloseTo(13, 2);
  });

  it('a round trip leaves every dollar target where it started (AC 2)', () => {
    const start = [
      { id: 'a', input: 13 },
      { id: 'b', input: 17 },
      { id: 'c', input: 4 },
    ];
    const before = start.map((l) => targetOf(l.input, 'pct', PAYABLE));
    const toAmt = convertMode(start, 'pct', 'amt', PAYABLE);
    const backToPct = convertMode(toAmt, 'amt', 'pct', PAYABLE);
    const after = backToPct.map((l) => targetOf(l.input, 'pct', PAYABLE));
    after.forEach((v, i) => expect(v).toBeCloseTo(before[i], 1));
  });

  it('switching one line\'s unit cannot change another line (AC 2)', () => {
    const rows = convertMode(
      [
        { id: 'a', input: 13 },
        { id: 'b', input: 17 },
      ],
      'pct',
      'amt',
      PAYABLE,
    );
    // Each output depends only on its own input — b's dollars are 17% of payable
    // regardless of what happened to a.
    expect(rows[1].input).toBeCloseTo(PAYABLE * 0.17, 2);
  });

  it('holds at zero instead of dividing by a zero payable', () => {
    const rows = convertMode([{ id: 'a', input: 100 }], 'amt', 'pct', 0);
    expect(rows[0].input).toBe(0);
  });
});

describe('balance (§12, AC 3)', () => {
  const lines = [
    { id: 'a', input: 20, locked: false },
    { id: 'b', input: 30, locked: false },
    { id: 'c', input: 11, locked: true },
  ];

  it('proportional fills the room left by locked lines, keeping their shape', () => {
    const out = balance(lines, 100, 'proportional');
    // room = 100 − 11 = 89, split 20:30 → 35.6 / 53.4
    expect(out.get('a')).toBeCloseTo(35.6, 1);
    expect(out.get('b')).toBeCloseTo(53.4, 1);
    expect(out.get('a')! + out.get('b')!).toBeCloseTo(89, 2);
  });

  it('even splits the room equally across unlocked lines', () => {
    const out = balance(lines, 100, 'even');
    expect(out.get('a')).toBeCloseTo(44.5, 2);
    expect(out.get('b')).toBeCloseTo(44.5, 2);
  });

  it('never touches a locked line (AC 3)', () => {
    expect(balance(lines, 100, 'proportional').has('c')).toBe(false);
    expect(balance(lines, 100, 'even').has('c')).toBe(false);
  });

  it('balances dollar mode against payable minus the locked dollars', () => {
    const out = balance(
      [
        { id: 'a', input: 1000, locked: false },
        { id: 'b', input: 1000, locked: false },
        { id: 'c', input: 500, locked: true },
      ],
      3000,
      'even',
    );
    expect(out.get('a')! + out.get('b')!).toBeCloseTo(2500, 2);
  });

  it('falls back to an even split when the unlocked lines are all zero', () => {
    const out = balance(
      [
        { id: 'a', input: 0, locked: false },
        { id: 'b', input: 0, locked: false },
      ],
      100,
      'proportional',
    );
    expect(out.get('a')).toBeCloseTo(50, 2);
    expect(out.get('b')).toBeCloseTo(50, 2);
  });

  it('gives no room away when the locks already exceed the denominator', () => {
    const out = balance(
      [
        { id: 'a', input: 10, locked: false },
        { id: 'c', input: 120, locked: true },
      ],
      100,
      'proportional',
    );
    expect(out.get('a')).toBe(0);
  });

  it('lands exactly on the room, to the cent, across many lines', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      id: `l${i}`,
      input: 10,
      locked: false,
    }));
    const out = balance(many, 100, 'even');
    const sum = [...out.values()].reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(100, 6);
  });

  it('balances a filtered subset to the label\'s share, not to 100% (§9)', () => {
    // Two event campaigns holding 30 points between them, an $800 event budget on
    // a $4,000 payable = 20 points. Balancing the LABEL must land on 20, not 100 —
    // deriving the denominator from the mode is exactly the bug this guards.
    const out = balance(
      [
        { id: 'a', input: 20, locked: false },
        { id: 'b', input: 10, locked: false },
      ],
      (800 / 4000) * 100,
      'proportional',
    );
    const sum = [...out.values()].reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(20, 6);
    // Shape preserved: still ~2:1. The total is exact to the cent (13.33 + 6.67),
    // so the ratio carries a rounding artifact — the total is what has to be
    // exact, not the ratio.
    expect(out.get('a')! / out.get('b')!).toBeCloseTo(2, 2);
  });
});

describe('planMove (§8, AC 9)', () => {
  const lines = [
    line({ id: 'src', name: 'Polaris', input: 600, target: 600, spentMTD: 200 }),
    line({ id: 'd1', name: 'Service', input: 300, target: 300, spentMTD: 100 }),
    line({ id: 'd2', name: 'Display', input: 100, target: 100, spentMTD: 20 }),
    line({ id: 'locked', name: 'MV Agusta', input: 400, target: 400, locked: true }),
  ];
  const base = {
    lines,
    mode: 'amt' as AllocationMode,
    payable: 2000,
    denominator: 2000,
  };

  it('conserves the total on an even split', () => {
    const plan = planMove({
      ...base,
      source: { kind: 'campaign', id: 'src' },
      destinationIds: ['d1', 'd2'],
      method: 'even',
      evenTotal: 100,
    });
    expect(plan.ok).toBe(true);
    expect(plan.allocations.map((a) => a.amount)).toEqual([50, 50]);
    expect(plan.source!.targetAfter).toBe(500);
    const delta =
      plan.allocations.reduce((s, a) => s + (a.targetAfter - a.targetBefore), 0) +
      (plan.source!.targetAfter - plan.source!.targetBefore);
    expect(delta).toBeCloseTo(0, 6);
  });

  it('conserves the total on custom amounts', () => {
    const plan = planMove({
      ...base,
      source: { kind: 'campaign', id: 'src' },
      destinationIds: ['d1', 'd2'],
      method: 'custom',
      customAmounts: { d1: 70, d2: 30 },
    });
    expect(plan.total).toBe(100);
    expect(plan.source!.targetAfter).toBe(500);
    expect(plan.allocations.find((a) => a.id === 'd1')!.targetAfter).toBe(370);
  });

  it('caps at what the source actually has', () => {
    const plan = planMove({
      ...base,
      source: { kind: 'campaign', id: 'd2' },
      destinationIds: ['d1'],
      method: 'even',
      evenTotal: 500,
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toContain('only has $100.00');
  });

  it('refuses a locked source and drops a locked destination (§4)', () => {
    const asSource = planMove({
      ...base,
      source: { kind: 'campaign', id: 'locked' },
      destinationIds: ['d1'],
      method: 'even',
      evenTotal: 50,
    });
    expect(asSource.ok).toBe(false);
    expect(asSource.error).toContain('locked');

    const asDest = planMove({
      ...base,
      source: { kind: 'campaign', id: 'src' },
      destinationIds: ['locked'],
      method: 'even',
      evenTotal: 50,
    });
    expect(asDest.ok).toBe(false);
    expect(asDest.allocations).toHaveLength(0);
  });

  it('an Unallocated source consumes leftover without subtracting anywhere', () => {
    // Allocated = 1400 of 2000 → 600 leftover.
    const plan = planMove({
      ...base,
      source: { kind: 'unallocated' },
      destinationIds: ['d1'],
      method: 'even',
      evenTotal: 600,
    });
    expect(plan.ok).toBe(true);
    expect(plan.available).toBe(600);
    expect(plan.inputs.get('d1')).toBe(900);
    // No campaign lost anything — the plan writes exactly one line.
    expect(plan.inputs.size).toBe(1);
  });

  it('caps an Unallocated move at the leftover', () => {
    const plan = planMove({
      ...base,
      source: { kind: 'unallocated' },
      destinationIds: ['d1'],
      method: 'even',
      evenTotal: 900,
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toContain('Unallocated only has $600.00');
  });

  it('conserves in PERCENT mode too, expressing the move as points of payable', () => {
    const pctLines = [
      line({ id: 'src', input: 30, target: 600, spentMTD: 200 }),
      line({ id: 'd1', input: 15, target: 300, spentMTD: 100 }),
    ];
    const plan = planMove({
      lines: pctLines,
      mode: 'pct',
      payable: 2000,
      denominator: 2000,
      source: { kind: 'campaign', id: 'src' },
      destinationIds: ['d1'],
      method: 'even',
      evenTotal: 200, // $200 = 10 points of a $2,000 payable
    });
    expect(plan.inputs.get('src')).toBeCloseTo(20, 6);
    expect(plan.inputs.get('d1')).toBeCloseTo(25, 6);
    const total = [...plan.inputs.values()].reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(45, 6); // 30 + 15, unchanged
  });

  it('previews the new recommended daily for every side of the move', () => {
    const plan = planMove({
      ...base,
      source: { kind: 'campaign', id: 'src' },
      destinationIds: ['d1'],
      method: 'even',
      evenTotal: 120,
    });
    // src: (480 − 200) ÷ 24; d1: (420 − 100) ÷ 24
    expect(plan.source!.recommendedDailyAfter).toBeCloseTo(280 / 24, 6);
    expect(plan.allocations[0].recommendedDailyAfter).toBeCloseTo(320 / 24, 6);
  });

  it('excludes the source from its own destination list', () => {
    const plan = planMove({
      ...base,
      source: { kind: 'campaign', id: 'src' },
      destinationIds: ['src', 'd1'],
      method: 'even',
      evenTotal: 100,
    });
    expect(plan.allocations.map((a) => a.id)).toEqual(['d1']);
  });

  it('sourceAvailable reads the leftover for Unallocated and the target for a campaign', () => {
    expect(sourceAvailable({ lines, source: { kind: 'unallocated' }, denominator: 2000 })).toBe(600);
    expect(
      sourceAvailable({ lines, source: { kind: 'campaign', id: 'd1' }, denominator: 2000 }),
    ).toBe(300);
  });
});

describe('buildAllocatorView — totals, meter, filter (§9, AC 1 & 10)', () => {
  const ads = [
    mk({ id: 'a', name: 'Yamaha', allocationPercent: '40', pacerActual: '105', pacerTags: '["Branding"]' }),
    mk({ id: 'b', name: 'Polaris', allocationPercent: '40', pacerActual: '198', pacerTags: '["Summer Sales Event"]' }),
    mk({ id: 'c', name: 'Service', allocationPercent: '20', pacerActual: '116', pacerTags: '["Summer Sales Event"]' }),
  ];
  const view = buildAllocatorView({ ads, mode: 'pct', payable: 1000, clock: CLOCK });

  it('sums to the payable and reports fully allocated', () => {
    expect(view.totals.allocated).toBeCloseTo(1000, 2);
    expect(view.totals.unallocated).toBeCloseTo(0, 2);
    expect(view.totals.fullyAllocated).toBe(true);
    expect(view.denominatorKind).toBe('payable');
  });

  it('account daily total equals (payable − spent) ÷ remaining days when fully allocated (AC 1)', () => {
    // Every line shares the full-month flight, so Σ(remaining ÷ 24) collapses to
    // the account identity the spec asserts.
    const spent = view.totals.spent;
    expect(view.totals.accountDaily).toBeCloseTo((1000 - spent) / 24, 6);
  });

  it('flags an under-allocated plan with the dollar gap', () => {
    const partial = buildAllocatorView({
      ads: [mk({ id: 'a', allocationPercent: '60' })],
      mode: 'pct',
      payable: 1000,
      clock: CLOCK,
    });
    expect(partial.totals.unallocated).toBeCloseTo(400, 2);
    expect(partial.totals.fullyAllocated).toBe(false);
  });

  it('flags an over-allocated plan with a negative gap', () => {
    const over = buildAllocatorView({
      ads: [mk({ id: 'a', allocationPercent: '120' })],
      mode: 'pct',
      payable: 1000,
      clock: CLOCK,
    });
    expect(over.totals.unallocated).toBeCloseTo(-200, 2);
  });

  it('rescopes EVERY total to the filtered subset (AC 10)', () => {
    const filtered = buildAllocatorView({
      ads,
      mode: 'pct',
      payable: 1000,
      clock: CLOCK,
      activeLabel: 'Summer Sales Event',
    });
    expect(filtered.visible.map((l) => l.name)).toEqual(['Polaris', 'Service']);
    expect(filtered.totals.allocated).toBeCloseTo(600, 2); // 40% + 20%
    expect(filtered.totals.spent).toBeCloseTo(314, 2); // 198 + 116
    expect(filtered.totals.accountDaily).toBeCloseTo((600 - 314) / 24, 6);
  });

  it('checks a filtered subset against its event budget when one is set (AC 10)', () => {
    const filtered = buildAllocatorView({
      ads,
      mode: 'pct',
      payable: 1000,
      clock: CLOCK,
      activeLabel: 'Summer Sales Event',
      eventBudgets: { 'Summer Sales Event': 800 },
    });
    expect(filtered.denominatorKind).toBe('eventBudget');
    expect(filtered.totals.denominator).toBe(800);
    // $600 allocated against $800 intended — 200 of the event money is unplaced.
    expect(filtered.totals.unallocated).toBeCloseTo(200, 2);
    expect(filtered.totals.fullyAllocated).toBe(false);
  });

  it('falls back to the subset\'s own total when no event budget is set', () => {
    const filtered = buildAllocatorView({
      ads,
      mode: 'pct',
      payable: 1000,
      clock: CLOCK,
      activeLabel: 'Branding',
    });
    expect(filtered.denominatorKind).toBe('subsetTotal');
    expect(filtered.totals.fullyAllocated).toBe(true);
  });

  it('matches an event budget case-insensitively', () => {
    const filtered = buildAllocatorView({
      ads,
      mode: 'pct',
      payable: 1000,
      clock: CLOCK,
      activeLabel: 'Summer Sales Event',
      eventBudgets: { 'summer sales event': 600 },
    });
    expect(filtered.totals.denominator).toBe(600);
    expect(filtered.totals.fullyAllocated).toBe(true);
  });

  it('keeps a Total-budget line in the meter but out of the account daily', () => {
    const withTotal = buildAllocatorView({
      ads: [
        mk({ id: 'a', allocation: '500', pacerActual: '100' }),
        mk({
          id: 'b',
          allocation: '500',
          pacerActual: '100',
          googleBudgetPeriod: 'CUSTOM_PERIOD',
          budgetType: 'Lifetime',
        }),
      ],
      mode: 'amt',
      payable: 1000,
      clock: CLOCK,
    });
    expect(withTotal.totals.allocated).toBeCloseTo(1000, 2);
    // Only the daily line contributes a controllable rate.
    expect(withTotal.totals.accountDaily).toBeCloseTo(400 / 24, 6);
  });

  it('reports the account pace off the visible set', () => {
    expect(view.totals.paceRatio).toBeCloseTo(
      view.totals.spent / view.totals.expected,
      6,
    );
  });
});

describe('deliveryVerdict (§7, AC 8)', () => {
  const flat = (n: number, count = 7) =>
    Array.from({ length: count }, (_, i) => ({ date: `d${i}`, spend: n }));

  it('distinguishes "behind but delivering to cap" from "underdelivering" (AC 8)', () => {
    // Same pace badge (under), opposite remedies.
    const deliveringToCap = deliveryVerdict(flat(10), 10, 7, 'under');
    const cannotSpend = deliveryVerdict(flat(3), 10, 7, 'under');
    expect(deliveringToCap.kind).toBe('at_cap');
    expect(cannotSpend.kind).toBe('underdelivering');
  });

  it('separates at-cap-and-ahead from at-cap-and-behind', () => {
    expect(deliveryVerdict(flat(10), 10, 7, 'over').kind).toBe('at_cap_ahead');
    expect(deliveryVerdict(flat(10), 10, 7, 'on').kind).toBe('at_cap');
  });

  it('calls 50–90% of cap "room to spend"', () => {
    expect(deliveryVerdict(flat(7), 10, 7, 'under').kind).toBe('room');
  });

  it('averages over the days it HAS, not the days requested', () => {
    // 4 days of history, asked for 7: a young campaign delivering its full cap
    // must not read as underdelivering.
    const v = deliveryVerdict(flat(10, 4), 10, 7, 'on');
    expect(v.avgDaily).toBe(10);
    expect(v.kind).toBe('at_cap');
  });

  it('takes the LAST n days for the window', () => {
    const series = [
      ...flat(1, 20),
      ...flat(10, 7),
    ];
    expect(deliveryVerdict(series, 10, 7, 'on').avgDaily).toBe(10);
  });

  it('withholds a ratio when there is no cap to measure against', () => {
    const v = deliveryVerdict(flat(5), 0, 7, 'on');
    expect(v.ratio).toBeNull();
    expect(v.kind).toBe('room');
  });
});

describe('buildPushPlan (§8, AC 11)', () => {
  const resources = new Map<string, string | null>([
    ['ok', 'customers/1/campaignBudgets/1'],
    ['tiny', 'customers/1/campaignBudgets/2'],
    ['shared', 'customers/1/campaignBudgets/3'],
    ['total', 'customers/1/campaignBudgets/4'],
    ['unlinked', null],
    ['locked', 'customers/1/campaignBudgets/5'],
  ]);

  it('pushes only lines whose drift clears the threshold', () => {
    const plan = buildPushPlan(
      [
        line({ id: 'ok', target: 600, currentDaily: 10, recommendedDaily: 20 }),
        line({ id: 'tiny', target: 600, currentDaily: 20, recommendedDaily: 20.4 }),
      ],
      resources,
    );
    expect(plan.candidates.map((c) => c.id)).toEqual(['ok']);
    expect(plan.skipped.find((s) => s.id === 'tiny')!.reason).toBe('below_threshold');
  });

  it('uses the dollar floor so small budgets are not nudged for pennies', () => {
    // 5% of $3/day is $0.15; the $1 floor holds this back.
    const plan = buildPushPlan(
      [line({ id: 'ok', target: 90, currentDaily: 3, recommendedDaily: 3.5 })],
      resources,
    );
    expect(plan.candidates).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('below_threshold');
  });

  it('flags shared budgets instead of silently pushing them', () => {
    const plan = buildPushPlan(
      [line({ id: 'shared', target: 600, currentDaily: 10, recommendedDaily: 30, shared: true, sharedCount: 3 })],
      resources,
    );
    expect(plan.candidates).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('shared_budget');
  });

  it('skips Total-budget campaigns (no daily lever)', () => {
    const plan = buildPushPlan(
      [
        line({
          id: 'total',
          target: 600,
          currentDaily: 0,
          recommendedDaily: 25,
          pacingType: 'Total',
          dailyControllable: false,
        }),
      ],
      resources,
    );
    expect(plan.skipped[0].reason).toBe('total_budget');
  });

  it('skips unlinked rows and rows with no target', () => {
    const plan = buildPushPlan(
      [
        line({ id: 'unlinked', target: 600, currentDaily: 10, recommendedDaily: 30 }),
        line({ id: 'ok', target: 0, currentDaily: 10, recommendedDaily: 30 }),
      ],
      resources,
    );
    expect(plan.skipped.map((s) => s.reason).sort()).toEqual(['no_target', 'not_linked']);
  });

  it('DOES push a locked line — a lock guards redistribution, not the rate', () => {
    const plan = buildPushPlan(
      [line({ id: 'locked', target: 600, currentDaily: 10, recommendedDaily: 30, locked: true })],
      resources,
    );
    expect(plan.candidates.map((c) => c.id)).toEqual(['locked']);
  });

  it('reports the account daily total the push will produce', () => {
    const plan = buildPushPlan(
      [
        line({ id: 'ok', target: 600, currentDaily: 10, recommendedDaily: 20 }),
        line({ id: 'tiny', target: 600, currentDaily: 20, recommendedDaily: 20.4 }),
      ],
      resources,
    );
    // Every controllable line counts, pushed or not — it is what Google will hold.
    expect(plan.accountDailyAfter).toBeCloseTo(40.4, 2);
  });
});
