import { describe, it, expect } from 'vitest';
import {
  buildFlightLedger,
  checkConservation,
  countedMonthSpend,
  countedSpendRow,
  pendingSnapshots,
  rawMonthSpend,
  rollupCrossMonth,
} from './cross-month-ledger';
import type { SplitRunAdLike } from './pacer-calc';

const TZ = 'America/Denver';
// Sep 1 2026 — every flight in the §8a dataset has finished and every billed
// month has been reached, so the whole window is settled.
const NOW = Date.UTC(2026, 8, 1, 18, 0, 0);

/** One month-row of a flight. `objectId` chains the months into one flight. */
function row(o: {
  id: string;
  name: string;
  objectId: string;
  period: string;
  actual: number;
  billed?: string;
  start?: string;
  end?: string;
  cap?: number;
  runSpend?: number;
}): SplitRunAdLike {
  return {
    id: o.id,
    name: o.name,
    period: o.period,
    adStatus: 'Completed Run',
    budgetType: 'Lifetime',
    metaObjectId: o.objectId,
    pacerActual: o.actual.toFixed(2),
    flightStart: o.start ?? null,
    flightEnd: o.end ?? null,
    metaStartDate: null,
    metaEndDate: null,
    liveDate: null,
    fullRunAppliedToMonth: o.billed ?? null,
    metaLifetimeBudget: o.cap != null ? o.cap.toFixed(2) : null,
    pacerRunSpend: o.runSpend != null ? o.runSpend.toFixed(2) : null,
  } as unknown as SplitRunAdLike;
}

/** An ordinary in-month ad — the month's evergreen spend, never cross-month. */
function evergreen(period: string, actual: number): SplitRunAdLike {
  return row({
    id: `ever-${period}`,
    name: `Evergreen ${period}`,
    objectId: `ever-${period}`,
    period,
    actual,
  });
}

// ─── §8a — Young Powersports Euro, Jan–Jul 2026 ─────────────────────────────
// The spec's full worked case. Each bike-night event runs two ads (a main event
// ad and a Facebook event ad), each straddling a month boundary and billing
// entirely in the later month.
const PERIODS = [
  '2026-01',
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
];

// Raw Meta spend per month (immutable, from the spec's table).
const RAW: Record<string, number> = {
  '2026-01': 2103.97,
  '2026-02': 1582.08,
  '2026-03': 1613.17,
  '2026-04': 1619.43,
  '2026-05': 1453.85,
  '2026-06': 1573.24,
  '2026-07': 1471.64,
};

const BUDGET_TOTAL = 11396.0;

// The ten cross-month flight rows, each as its origin-month + billed-month pair.
const FLIGHTS: Array<{
  key: string;
  name: string;
  start: string;
  end: string;
  billed: string;
  cap: number;
  slices: Array<[string, number]>; // [period, dated spend]
}> = [
  { key: 'f1-main', name: 'F1 Bike Night Event', start: '2026-03-27', end: '2026-04-03', billed: '2026-04', cap: 80.0, slices: [['2026-03', 53.58], ['2026-04', 26.31]] },
  { key: 'f1-fb', name: 'F1 Bike Night Facebook Event', start: '2026-03-27', end: '2026-04-03', billed: '2026-04', cap: 35.5, slices: [['2026-03', 22.75], ['2026-04', 12.74]] },
  { key: 'f2-main', name: 'F2 Bike Night Event', start: '2026-04-24', end: '2026-05-01', billed: '2026-05', cap: 80.0, slices: [['2026-04', 74.24], ['2026-05', 5.66]] },
  { key: 'f2-fb', name: 'F2 Bike Night Facebook Event', start: '2026-04-24', end: '2026-05-01', billed: '2026-05', cap: 35.5, slices: [['2026-04', 32.71], ['2026-05', 2.73]] },
  { key: 'f3-main', name: 'F3 Bike Night Event', start: '2026-05-29', end: '2026-06-05', billed: '2026-06', cap: 80.0, slices: [['2026-05', 30.23], ['2026-06', 49.59]] },
  { key: 'f3-fb', name: 'F3 Bike Night Facebook Event', start: '2026-05-29', end: '2026-06-05', billed: '2026-06', cap: 35.5, slices: [['2026-05', 13.1], ['2026-06', 22.37]] },
  { key: 'f4-main', name: 'F4 Bike Night Event', start: '2026-06-26', end: '2026-07-03', billed: '2026-07', cap: 80.0, slices: [['2026-06', 53.63], ['2026-07', 26.34]] },
  { key: 'f4-fb', name: 'F4 Bike Night Facebook Event', start: '2026-06-26', end: '2026-07-03', billed: '2026-07', cap: 35.5, slices: [['2026-06', 22.97], ['2026-07', 12.45]] },
  // F5 is the ONLY edge-crosser: it bills in August, outside the window.
  { key: 'f5-main', name: 'F5 Bike Night Event', start: '2026-07-31', end: '2026-08-07', billed: '2026-08', cap: 80.0, slices: [['2026-07', 5.85], ['2026-08', 74.0]] },
  { key: 'f5-fb', name: 'F5 Bike Night Facebook Event', start: '2026-07-31', end: '2026-08-07', billed: '2026-08', cap: 35.5, slices: [['2026-07', 2.73], ['2026-08', 32.0]] },
];

function buildDataset(): SplitRunAdLike[] {
  const ads: SplitRunAdLike[] = [];
  const flightSpendByPeriod = new Map<string, number>();
  for (const f of FLIGHTS) {
    for (const [period, actual] of f.slices) {
      ads.push(
        row({
          id: `${f.key}-${period}`,
          name: f.name,
          objectId: f.key,
          period,
          actual,
          billed: f.billed,
          start: f.start,
          end: f.end,
          cap: f.cap,
          // Meta's all-time full-run spend, on every row of the ad set — the
          // rebuild derives Out/In from `runSpend − billedDelivery`, so this is
          // now load-bearing rather than informational.
          runSpend: Math.round(f.slices.reduce((t, [, v]) => t + v, 0) * 100) / 100,
        }),
      );
      flightSpendByPeriod.set(
        period,
        (flightSpendByPeriod.get(period) ?? 0) + actual,
      );
    }
  }
  // Fill each in-window month up to its raw Meta total with evergreen spend, so
  // rawMonthSpend reproduces the spec's immutable anchor exactly.
  for (const p of PERIODS) {
    const remainder =
      Math.round((RAW[p] - (flightSpendByPeriod.get(p) ?? 0)) * 100) / 100;
    ads.push(evergreen(p, remainder));
  }
  return ads;
}

describe('§8a regression — Young Powersports Euro, Jan–Jul 2026', () => {
  const ads = buildDataset();
  const ledger = buildFlightLedger(ads, NOW, TZ);
  const rollup = rollupCrossMonth(ledger, PERIODS);
  // Raw and Counted are computed from DIFFERENT things: raw is every dollar
  // dated to the month, counted is Σ effectiveActual (the full run once, in its
  // billed month). In this dataset the account spent exactly what the rows say,
  // so they must reconcile to the cent — that is the point of the check.
  const rowFor = (p: string) =>
    countedSpendRow(
      rawMonthSpend(ads.filter((a) => a.period === p)),
      countedMonthSpend(ads.filter((a) => a.period === p), p),
      rollup.get(p),
    );

  it('finds exactly the ten cross-month flights, all settled', () => {
    expect(ledger).toHaveLength(10);
    expect(ledger.every((f) => f.status === 'settled')).toBe(true);
  });

  it('leaves Raw Meta Spend untouched — it is the anchor (§1.1)', () => {
    for (const p of PERIODS) {
      expect(rowFor(p).rawSpend).toBeCloseTo(RAW[p], 2);
    }
  });

  it('reproduces the per-month origin totals (§8a)', () => {
    const expected: Record<string, number> = {
      '2026-03': 76.33,
      '2026-04': 106.95,
      '2026-05': 43.33,
      '2026-06': 76.6,
      '2026-07': 8.58,
    };
    for (const [period, out] of Object.entries(expected)) {
      expect(rowFor(period).out).toBeCloseTo(out, 2);
    }
    // Jan and Feb have no cross-month flights at all.
    expect(rowFor('2026-01').out).toBe(0);
    expect(rowFor('2026-02').out).toBe(0);
  });

  it('reproduces the counted-spend table to the cent (acceptance check 7)', () => {
    const expected: Record<string, number> = {
      '2026-01': 2103.97,
      '2026-02': 1582.08,
      '2026-03': 1536.84, // NOT 1,613.17 — the frozen-origin bug
      '2026-04': 1588.81,
      '2026-05': 1517.47,
      '2026-06': 1539.97,
      '2026-07': 1539.66,
    };
    for (const [period, counted] of Object.entries(expected)) {
      expect(rowFor(period).countedSpend).toBeCloseTo(counted, 2);
    }
  });

  it('ties out in every row — Raw − Out + In lands on Counted (check 2)', () => {
    for (const p of PERIODS) {
      const r = rowFor(p);
      expect(r.tieOut).toBeCloseTo(r.rawSpend - r.out + r.in, 2);
      expect(r.countedSpend).toBeCloseTo(r.tieOut, 2);
      expect(r.residual).toBeCloseTo(0, 2);
    }
  });

  it('nets to +$12.80 over — not the naive +$21.38 (acceptance check 7)', () => {
    const counted = PERIODS.reduce((s, p) => s + rowFor(p).countedSpend, 0);
    expect(counted).toBeCloseTo(11408.8, 2);
    expect(counted - BUDGET_TOTAL).toBeCloseTo(12.8, 2);

    const naive = PERIODS.reduce((s, p) => s + RAW[p], 0);
    expect(naive).toBeCloseTo(11417.38, 2);
    expect(naive - BUDGET_TOTAL).toBeCloseTo(21.38, 2);
  });

  it('attributes the naive-vs-correct gap to the single edge slice ($8.58)', () => {
    const counted = PERIODS.reduce((s, p) => s + rowFor(p).countedSpend, 0);
    const naive = PERIODS.reduce((s, p) => s + RAW[p], 0);
    expect(naive - counted).toBeCloseTo(8.58, 2);
  });

  it("subtotals Jan–Jun at 9,869.14 (the spec's six-month figure)", () => {
    const janJun = PERIODS.slice(0, 6).reduce(
      (s, p) => s + rowFor(p).countedSpend,
      0,
    );
    expect(janJun).toBeCloseTo(9869.14, 2);
  });

  it('balances conservation, the imbalance being exactly the edge outflow (§5)', () => {
    const c = checkConservation(ledger, PERIODS);
    expect(c.sumOut).toBeCloseTo(311.79, 2);
    expect(c.sumIn).toBeCloseTo(303.21, 2);
    // F5 bills in August, outside the window — its $8.58 leaves as carry-out, so
    // Σ In == Σ Out + carryIn − carryOut still holds.
    expect(c.carryOut).toBeCloseTo(8.58, 2);
    expect(c.carryIn).toBeCloseTo(0, 2);
    expect(c.delta).toBeCloseTo(0, 2);
    expect(c.balanced).toBe(true);
  });

  it('balances with Σ Out == Σ In once August is in the window', () => {
    const withAug = [...PERIODS, '2026-08'];
    const c = checkConservation(buildFlightLedger(ads, NOW, TZ), withAug);
    expect(c.sumOut).toBeCloseTo(311.79, 2);
    expect(c.sumIn).toBeCloseTo(311.79, 2);
    expect(c.carryOut).toBeCloseTo(0, 2);
    expect(c.balanced).toBe(true);
  });

  it('interior flights wash the net; only edge-crossers change carryover', () => {
    // F4 ($76.60) is interior — July is in-window — so it moves rows but not the
    // net. Dropping F5 (the edge-crosser) is what closes the gap to zero.
    const interiorOnly = ads.filter((a) => !a.id.startsWith('f5-'));
    const l = buildFlightLedger(interiorOnly, NOW, TZ);
    const r = rollupCrossMonth(l, PERIODS);
    const counted = PERIODS.reduce(
      (s, p) =>
        s +
        countedSpendRow(
          rawMonthSpend(interiorOnly.filter((a) => a.period === p)),
          countedMonthSpend(interiorOnly.filter((a) => a.period === p), p),
          r.get(p),
        ).countedSpend,
      0,
    );
    const raw = PERIODS.reduce(
      (s, p) => s + rawMonthSpend(interiorOnly.filter((a) => a.period === p)),
      0,
    );
    expect(counted).toBeCloseTo(raw, 2);
  });

  it('flags no budget overrun — every settled flight lands at or under cap', () => {
    expect(ledger.filter((f) => f.exceedsBudgetCap)).toEqual([]);
  });

  it('drill-down names the flight, its window, and its direction (§6)', () => {
    const june = rollup.get('2026-06')!;
    const out = june.lines.filter((l) => l.direction === 'out');
    // June's two outgoing slices are F4's pair, billing in July.
    expect(out.map((l) => l.amount).sort((a, b) => a - b)).toEqual([22.97, 53.63]);
    expect(out.every((l) => l.billedMonth === '2026-07')).toBe(true);
    expect(out.every((l) => l.runStart === '2026-06-26' && l.runEnd === '2026-07-03')).toBe(true);
    expect(out.every((l) => l.status === 'settled')).toBe(true);
    // …and June RECEIVES F3's May slices.
    const incoming = june.lines.filter((l) => l.direction === 'in');
    expect(incoming.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(43.33, 2);
  });
});

// ─── §4 pending / settled ───────────────────────────────────────────────────
describe('settlement state (§4)', () => {
  const pair = (billed: string, end: string): SplitRunAdLike[] => [
    row({ id: 'a-jun', name: 'Euro Bike Night', objectId: 'os-1', period: '2026-06', actual: 76.6, billed, start: '2026-06-26', end, runSpend: 115.39 }),
    row({ id: 'a-jul', name: 'Euro Bike Night', objectId: 'os-1', period: '2026-07', actual: 38.79, billed, start: '2026-06-26', end, runSpend: 115.39 }),
  ];
  /** The month's two independent totals, as the reconciliation composes them. */
  const monthRow = (
    ads: SplitRunAdLike[],
    p: string,
    rollup: ReturnType<typeof rollupCrossMonth>,
  ) =>
    countedSpendRow(
      rawMonthSpend(ads.filter((a) => a.period === p)),
      countedMonthSpend(ads.filter((a) => a.period === p), p),
      rollup.get(p),
    );

  it('keeps a mid-flight slice counted in its origin month, flagged Pending', () => {
    // Jul 1: the run has not finished, so nothing moves (§4).
    const ads = pair('2026-07', '2026-07-03');
    const ledger = buildFlightLedger(ads, Date.UTC(2026, 6, 1, 18), TZ);
    expect(ledger[0].status).toBe('pending');
    const r = rollupCrossMonth(ledger, ['2026-06', '2026-07']);
    const june = monthRow(ads, '2026-06', r);
    expect(june.out).toBe(0);
    expect(june.in).toBe(0);
    expect(june.rawSpend).toBeCloseTo(76.6, 2); // still June's raw
    expect(june.pendingForward).toBeCloseTo(76.6, 2); // …but explained
    // …and a flight in flight is NOT a data gap: pending nets out of the check
    // at both ends, so neither month reads as money missing from Loomi.
    expect(june.residual).toBeCloseTo(0, 2);
    expect(monthRow(ads, '2026-07', r).residual).toBeCloseTo(0, 2);
  });

  it('posts Out and In together once the run ends and the month is reached', () => {
    const ads = pair('2026-07', '2026-07-03');
    const ledger = buildFlightLedger(ads, Date.UTC(2026, 7, 5, 18), TZ);
    expect(ledger[0].status).toBe('settled');
    const r = rollupCrossMonth(ledger, ['2026-06', '2026-07']);
    expect(monthRow(ads, '2026-06', r).tieOut).toBeCloseTo(0, 2);
    expect(monthRow(ads, '2026-07', r).tieOut).toBeCloseTo(115.39, 2);
    expect(monthRow(ads, '2026-06', r).residual).toBeCloseTo(0, 2);
    expect(monthRow(ads, '2026-07', r).residual).toBeCloseTo(0, 2);
    expect(r.get('2026-06')!.pendingForward).toBe(0);
  });

  it('stays pending while the run has ended but the billed month has not come', () => {
    // Run ended Jul 3 but it bills in September; on Aug 5 that has not arrived.
    const ads = pair('2026-09', '2026-07-03');
    const ledger = buildFlightLedger(ads, Date.UTC(2026, 7, 5, 18), TZ);
    expect(ledger[0].status).toBe('pending');
  });

  it('never lets a month go light for dollars that have not arrived', () => {
    // The transient-orphan failure mode: while pending, Σ counted across the
    // window must still equal Σ raw — no dollar may be in flight and nowhere.
    const ads = pair('2026-07', '2026-07-03');
    const ledger = buildFlightLedger(ads, Date.UTC(2026, 6, 1, 18), TZ);
    const r = rollupCrossMonth(ledger, ['2026-06', '2026-07']);
    const tied =
      monthRow(ads, '2026-06', r).tieOut + monthRow(ads, '2026-07', r).tieOut;
    expect(tied).toBeCloseTo(76.6 + 38.79, 2);
  });
});

// ─── §7 edge cases ──────────────────────────────────────────────────────────
describe('edge cases (§7)', () => {
  it('splits a three-month flight when its own rows account for the span', () => {
    // The subtraction gives ONE lump (100 − 5 = 95) for April+May together. The
    // flight's own month rows can place it, and they add up to exactly that
    // lump, so it is split rather than flagged. Corroborated data, not a guess.
    const ads = [
      row({ id: 'm1', name: 'Long Run', objectId: 'os-3', period: '2026-04', actual: 40, billed: '2026-06', start: '2026-04-20', end: '2026-06-02', runSpend: 100 }),
      row({ id: 'm2', name: 'Long Run', objectId: 'os-3', period: '2026-05', actual: 55, billed: '2026-06', start: '2026-04-20', end: '2026-06-02', runSpend: 100 }),
      row({ id: 'm3', name: 'Long Run', objectId: 'os-3', period: '2026-06', actual: 5, billed: '2026-06', start: '2026-04-20', end: '2026-06-02', runSpend: 100 }),
    ];
    const periods = ['2026-04', '2026-05', '2026-06'];
    const ledger = buildFlightLedger(ads, NOW, TZ);
    expect(ledger[0].originSlices).toHaveLength(2);
    const r = rollupCrossMonth(ledger, periods);
    expect(r.get('2026-04')!.out).toBe(40);
    expect(r.get('2026-05')!.out).toBe(55);
    expect(r.get('2026-06')!.in).toBe(95);
    expect(checkConservation(ledger, periods).balanced).toBe(true);
  });

  it('ignores a flight billed in its own run month (not cross-month)', () => {
    const ads = [
      row({ id: 'own', name: 'June only', objectId: 'os-4', period: '2026-06', actual: 500, billed: '2026-06', start: '2026-06-01', end: '2026-06-30' }),
    ];
    expect(buildFlightLedger(ads, NOW, TZ)).toEqual([]);
  });

  it('ignores a flight with no billing choice recorded', () => {
    const ads = [
      row({ id: 'u1', name: 'Unresolved', objectId: 'os-5', period: '2026-06', actual: 60, start: '2026-06-26', end: '2026-07-03' }),
      row({ id: 'u2', name: 'Unresolved', objectId: 'os-5', period: '2026-07', actual: 20, start: '2026-06-26', end: '2026-07-03' }),
    ];
    expect(buildFlightLedger(ads, NOW, TZ)).toEqual([]);
  });

  it('keys on the cross-month choice, NOT the lifetime flag (§3, §7)', () => {
    const daily = [
      row({ id: 'd1', name: 'Daily straddler', objectId: 'os-6', period: '2026-06', actual: 30, billed: '2026-07', start: '2026-06-28', end: '2026-07-02', runSpend: 40 }),
      row({ id: 'd2', name: 'Daily straddler', objectId: 'os-6', period: '2026-07', actual: 10, billed: '2026-07', start: '2026-06-28', end: '2026-07-02', runSpend: 40 }),
    ].map((a) => ({ ...a, budgetType: 'Daily' }) as SplitRunAdLike);
    const ledger = buildFlightLedger(daily, NOW, TZ);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].originSlices[0].datedSpend).toBe(30);
  });

  it('sums several flights per month and keeps them separate in the drill-down', () => {
    const ads = [
      row({ id: 'x1', name: 'Flight X', objectId: 'os-x', period: '2026-06', actual: 12, billed: '2026-07', start: '2026-06-28', end: '2026-07-01', runSpend: 15 }),
      row({ id: 'x2', name: 'Flight X', objectId: 'os-x', period: '2026-07', actual: 3, billed: '2026-07', start: '2026-06-28', end: '2026-07-01', runSpend: 15 }),
      row({ id: 'y1', name: 'Flight Y', objectId: 'os-y', period: '2026-06', actual: 7, billed: '2026-07', start: '2026-06-29', end: '2026-07-02', runSpend: 11 }),
      row({ id: 'y2', name: 'Flight Y', objectId: 'os-y', period: '2026-07', actual: 4, billed: '2026-07', start: '2026-06-29', end: '2026-07-02', runSpend: 11 }),
    ];
    const r = rollupCrossMonth(buildFlightLedger(ads, NOW, TZ), ['2026-06', '2026-07']);
    expect(r.get('2026-06')!.out).toBe(19);
    expect(
      r.get('2026-06')!.lines.map((l) => l.flightName).sort(),
    ).toEqual(['Flight X', 'Flight Y']);
  });

  it('flags a settled lifetime flight computing OVER its Meta lifetime cap', () => {
    const ads = [
      row({ id: 'o1', name: 'Overspent', objectId: 'os-7', period: '2026-06', actual: 70, billed: '2026-07', start: '2026-06-26', end: '2026-07-03', cap: 80, runSpend: 95 }),
      row({ id: 'o2', name: 'Overspent', objectId: 'os-7', period: '2026-07', actual: 25, billed: '2026-07', start: '2026-06-26', end: '2026-07-03', cap: 80, runSpend: 95 }),
    ];
    const ledger = buildFlightLedger(ads, NOW, TZ);
    expect(ledger[0].flightTotal).toBe(95);
    expect(ledger[0].exceedsBudgetCap).toBe(true);
  });

  it("surfaces Meta's full-run figure when it disagrees with the summed slices", () => {
    const ads = [
      row({ id: 'r1', name: 'Drifted', objectId: 'os-8', period: '2026-06', actual: 50, billed: '2026-07', start: '2026-06-26', end: '2026-07-03', runSpend: 90 }),
      row({ id: 'r2', name: 'Drifted', objectId: 'os-8', period: '2026-07', actual: 20, billed: '2026-07', start: '2026-06-26', end: '2026-07-03', runSpend: 90 }),
    ];
    const ledger = buildFlightLedger(ads, NOW, TZ);
    expect(ledger[0].flightTotal).toBe(90); // the full run is the basis now
    expect(ledger[0].originTotal).toBe(70); // 90 − July's own 20
    expect(ledger[0].runSpendMismatch).toBe(70); // …and the stale rows are shown
  });

  it('detects an orphaned slice — the leak the invariant exists to catch', () => {
    // A hand-built ledger whose In was dropped: Σ Out no longer equals Σ In and
    // the delta is NOT the known edge outflow, so the month must be flagged.
    const ads = [
      row({ id: 'g1', name: 'Ghost', objectId: 'os-9', period: '2026-06', actual: 40, billed: '2026-07', start: '2026-06-26', end: '2026-07-03', runSpend: 50 }),
      row({ id: 'g2', name: 'Ghost', objectId: 'os-9', period: '2026-07', actual: 10, billed: '2026-07', start: '2026-06-26', end: '2026-07-03', runSpend: 50 }),
    ];
    const ledger = buildFlightLedger(ads, NOW, TZ);
    const orphaned = ledger.map((f) => ({ ...f, billedMonth: '2026-11' }));
    const c = checkConservation(orphaned, ['2026-06', '2026-07']);
    expect(c.sumOut).toBe(40);
    expect(c.sumIn).toBe(0);
    expect(c.carryOut).toBe(40); // accounted for as leaving the window…
    expect(c.balanced).toBe(true);
    // …whereas an In with no slices behind it does not balance: $40 arrives in
    // July out of nowhere, which is the leak the invariant exists to catch.
    const leaked = checkConservation(
      [{ ...ledger[0], originSlices: [] }],
      ['2026-06', '2026-07'],
    );
    expect(leaked.sumIn).toBe(40);
    expect(leaked.sumOut).toBe(0);
    expect(leaked.balanced).toBe(false);
  });
});

// ─── Rebuild invariants ─────────────────────────────────────────────────────
// The rebuild's whole claim is that Raw and Counted come from different places
// and are then reconciled. These are the checks that would fail under the old
// design, where Counted was DERIVED from Raw and the tie-out was an identity.

describe('independence of Raw and Counted (rebuild §12.4)', () => {
  const linked = row({
    id: 'linked',
    name: 'Tracked ad',
    objectId: 'os-ind',
    period: '2026-07',
    actual: 1460,
  });
  const rollup = rollupCrossMonth(buildFlightLedger([linked], NOW, TZ), ['2026-07']);
  const counted = countedMonthSpend([linked], '2026-07');

  it('reads clean when the account spent exactly what Loomi tracked', () => {
    const r = countedSpendRow(1460, counted, rollup.get('2026-07'));
    expect(r.residual).toBeCloseTo(0, 2);
  });

  it('moves the residual — and ONLY the residual — by an unlinked dollar', () => {
    // An $80 ad running in the account that was never added to the pacer.
    const r = countedSpendRow(1540, counted, rollup.get('2026-07'));
    expect(r.rawSpend).toBeCloseTo(1540, 2);
    expect(r.countedSpend).toBeCloseTo(1460, 2); // unchanged — rows didn't move
    expect(r.residual).toBeCloseTo(80, 2);
  });

  it('signs the other direction when Loomi counts more than the account spent', () => {
    const r = countedSpendRow(1400, counted, rollup.get('2026-07'));
    expect(r.residual).toBeCloseTo(-60, 2);
  });
});

describe('direction-agnostic subtraction (rebuild §4, §11b)', () => {
  // Delivers late, bills early: Aug 20 – Sep 5, billed August. Only the August
  // row exists — the origin month is LATER than the billed month, which the old
  // "sibling rows before the billed month" logic could not see at all.
  const backward = row({
    id: 'aug',
    name: 'August ad',
    objectId: 'os-back',
    period: '2026-08',
    actual: 55,
    billed: '2026-08',
    start: '2026-08-20',
    end: '2026-09-05',
    runSpend: 80,
  });
  const SETTLED = Date.UTC(2026, 8, 6, 18); // Sep 6, the day after the run ends

  it('posts Out in the LATER month and In in the earlier billed month', () => {
    const ledger = buildFlightLedger([backward], SETTLED, TZ);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].status).toBe('settled');
    expect(ledger[0].originTotal).toBeCloseTo(25, 2);
    const r = rollupCrossMonth(ledger, ['2026-08', '2026-09']);
    expect(r.get('2026-09')!.out).toBeCloseTo(25, 2);
    expect(r.get('2026-08')!.in).toBeCloseTo(25, 2);
    expect(checkConservation(ledger, ['2026-08', '2026-09']).balanced).toBe(true);
  });

  it('lands the full run in the billed month and nothing in the origin month', () => {
    const r = rollupCrossMonth(buildFlightLedger([backward], SETTLED, TZ), [
      '2026-08',
      '2026-09',
    ]);
    // August's own delivery was $55; the account also spent $25 in September.
    const aug = countedSpendRow(55, countedMonthSpend([backward], '2026-08'), r.get('2026-08'));
    const sep = countedSpendRow(25, countedMonthSpend([], '2026-09'), r.get('2026-09'));
    expect(aug.countedSpend).toBeCloseTo(80, 2); // the whole run
    expect(aug.residual).toBeCloseTo(0, 2);
    expect(sep.countedSpend).toBeCloseTo(0, 2);
    expect(sep.residual).toBeCloseTo(0, 2);
  });

  it('works from the billed row alone — no sibling row in the origin month', () => {
    // The forward mirror of the case above: a Jun 26 – Jul 3 flight billed in
    // July, where June never got its own pacer row.
    const julyOnly = row({
      id: 'jul-only',
      name: 'Bike Night Event Ad',
      objectId: 'os-fwd',
      period: '2026-07',
      actual: 26.34,
      billed: '2026-07',
      start: '2026-06-26',
      end: '2026-07-03',
      runSpend: 79.97,
    });
    const ledger = buildFlightLedger([julyOnly], NOW, TZ);
    expect(ledger[0].originTotal).toBeCloseTo(53.63, 2);
    const r = rollupCrossMonth(ledger, ['2026-06', '2026-07']);
    expect(r.get('2026-06')!.out).toBeCloseTo(53.63, 2);
    expect(r.get('2026-07')!.in).toBeCloseTo(53.63, 2);
  });
});

describe('settlement snapshot (rebuild §5, §12.5)', () => {
  const base = {
    name: 'Snapshot flight',
    objectId: 'os-snap',
    billed: '2026-07',
    start: '2026-06-26',
    end: '2026-07-03',
  } as const;

  it('asks for a snapshot the first time it settles, and only then', () => {
    const settled = row({ ...base, id: 's1', period: '2026-07', actual: 38.79, runSpend: 115.39 });
    expect(pendingSnapshots(buildFlightLedger([settled], NOW, TZ))).toEqual([
      { adId: 's1', runSpend: '115.39', billedDelivery: '38.79' },
    ]);
    // Mid-flight there is nothing to freeze yet.
    const midFlight = buildFlightLedger([settled], Date.UTC(2026, 6, 1, 18), TZ);
    expect(pendingSnapshots(midFlight)).toEqual([]);
  });

  it('holds Out/In steady when a later re-sync moves the live figures', () => {
    // The snapshot is written; the daily series has since been pruned and a
    // re-sync has restated pacerRunSpend. Out/In must not move.
    const snapshotted = {
      ...row({ ...base, id: 's2', period: '2026-07', actual: 9999, runSpend: 4242 }),
      settledRunSpend: '115.39',
      settledBilledDelivery: '38.79',
      settledAt: new Date('2026-07-06T12:00:00Z'),
    };
    const ledger = buildFlightLedger([snapshotted], NOW, TZ);
    expect(ledger[0].fromSnapshot).toBe(true);
    expect(ledger[0].flightTotal).toBeCloseTo(115.39, 2);
    expect(ledger[0].originTotal).toBeCloseTo(76.6, 2);
    // …and it is never re-snapshotted.
    expect(pendingSnapshots(ledger)).toEqual([]);
  });
});

describe('flights that raise their hand (rebuild §8, §12.6–7)', () => {
  it('flags a 3+ month flight whose rows cannot place the lump', () => {
    // May–Jul billed July, but only May and July have rows: the $60 that fell
    // outside July can't be split between May and June, so nothing is posted.
    const ads = [
      row({ id: 'l1', name: 'Long Run', objectId: 'os-long', period: '2026-05', actual: 40, billed: '2026-07', start: '2026-05-20', end: '2026-07-02', runSpend: 100 }),
      row({ id: 'l3', name: 'Long Run', objectId: 'os-long', period: '2026-07', actual: 40, billed: '2026-07', start: '2026-05-20', end: '2026-07-02', runSpend: 100 }),
    ];
    const ledger = buildFlightLedger(ads, NOW, TZ);
    expect(ledger[0].needsReview).toBe(true);
    expect(ledger[0].reviewReason).toBe('unsplittable_span');
    // Excluded from auto-reconciliation entirely — no lump posted to a guess.
    const periods = ['2026-05', '2026-06', '2026-07'];
    const r = rollupCrossMonth(ledger, periods);
    for (const p of periods) {
      expect(r.get(p)!.out).toBe(0);
      expect(r.get(p)!.in).toBe(0);
    }
    expect(checkConservation(ledger, periods).sumOut).toBe(0);
  });

  it('flags a missing full-run figure instead of computing an origin of $0', () => {
    const ads = [
      row({ id: 'n1', name: 'Unsynced', objectId: 'os-nrs', period: '2026-07', actual: 26.34, billed: '2026-07', start: '2026-06-26', end: '2026-07-03' }),
    ];
    const ledger = buildFlightLedger(ads, NOW, TZ);
    expect(ledger[0].needsReview).toBe(true);
    expect(ledger[0].reviewReason).toBe('missing_run_spend');
    expect(ledger[0].originTotal).toBe(0);
  });

  it('flags a billed month with no row to carry the run', () => {
    // Marked to bill in July, but July has no ad row — Counted would place the
    // run nowhere, so an In posted there would be invented.
    const ads = [
      row({ id: 'b1', name: 'Homeless', objectId: 'os-nb', period: '2026-06', actual: 60, billed: '2026-07', start: '2026-06-26', end: '2026-07-03', runSpend: 80 }),
    ];
    const ledger = buildFlightLedger(ads, NOW, TZ);
    expect(ledger[0].needsReview).toBe(true);
    expect(ledger[0].reviewReason).toBe('billed_month_has_no_row');
  });

  it('leaves an ordinary single-month resolution alone — no run figure needed', () => {
    const ads = [
      row({ id: 'p1', name: 'June only', objectId: 'os-one', period: '2026-06', actual: 500, billed: '2026-06', start: '2026-06-02', end: '2026-06-28' }),
    ];
    expect(buildFlightLedger(ads, NOW, TZ)).toEqual([]);
  });
});
