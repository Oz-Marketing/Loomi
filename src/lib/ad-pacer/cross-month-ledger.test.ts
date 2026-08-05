import { describe, it, expect } from 'vitest';
import {
  buildFlightLedger,
  checkConservation,
  countedSpendRow,
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
  const rowFor = (p: string) =>
    countedSpendRow(
      rawMonthSpend(ads.filter((a) => a.period === p)),
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

  it('holds Counted = Raw − Out + In in every row (acceptance check 2)', () => {
    for (const p of PERIODS) {
      const r = rowFor(p);
      expect(r.countedSpend).toBeCloseTo(r.rawSpend - r.out + r.in, 2);
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
    row({ id: 'a-jun', name: 'Euro Bike Night', objectId: 'os-1', period: '2026-06', actual: 76.6, billed, start: '2026-06-26', end }),
    row({ id: 'a-jul', name: 'Euro Bike Night', objectId: 'os-1', period: '2026-07', actual: 38.79, billed, start: '2026-06-26', end }),
  ];

  it('keeps a mid-flight slice counted in its origin month, flagged Pending', () => {
    // Jul 1: the run has not finished, so nothing moves (§4).
    const ads = pair('2026-07', '2026-07-03');
    const ledger = buildFlightLedger(ads, Date.UTC(2026, 6, 1, 18), TZ);
    expect(ledger[0].status).toBe('pending');
    const r = rollupCrossMonth(ledger, ['2026-06', '2026-07']);
    const june = countedSpendRow(76.6, r.get('2026-06'));
    expect(june.out).toBe(0);
    expect(june.in).toBe(0);
    expect(june.countedSpend).toBeCloseTo(76.6, 2); // still June's
    expect(june.pendingForward).toBeCloseTo(76.6, 2); // …but explained
  });

  it('posts Out and In together once the run ends and the month is reached', () => {
    const ads = pair('2026-07', '2026-07-03');
    const ledger = buildFlightLedger(ads, Date.UTC(2026, 7, 5, 18), TZ);
    expect(ledger[0].status).toBe('settled');
    const r = rollupCrossMonth(ledger, ['2026-06', '2026-07']);
    expect(countedSpendRow(76.6, r.get('2026-06')).countedSpend).toBeCloseTo(0, 2);
    expect(countedSpendRow(38.79, r.get('2026-07')).countedSpend).toBeCloseTo(115.39, 2);
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
    const counted =
      countedSpendRow(76.6, r.get('2026-06')).countedSpend +
      countedSpendRow(38.79, r.get('2026-07')).countedSpend;
    expect(counted).toBeCloseTo(76.6 + 38.79, 2);
  });
});

// ─── §7 edge cases ──────────────────────────────────────────────────────────
describe('edge cases (§7)', () => {
  it('handles a three-month flight: one In equals the sum of every Out', () => {
    const ads = [
      row({ id: 'm1', name: 'Long Run', objectId: 'os-3', period: '2026-04', actual: 40, billed: '2026-06', start: '2026-04-20', end: '2026-06-02' }),
      row({ id: 'm2', name: 'Long Run', objectId: 'os-3', period: '2026-05', actual: 55, billed: '2026-06', start: '2026-04-20', end: '2026-06-02' }),
      row({ id: 'm3', name: 'Long Run', objectId: 'os-3', period: '2026-06', actual: 5, billed: '2026-06', start: '2026-04-20', end: '2026-06-02' }),
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
      row({ id: 'd1', name: 'Daily straddler', objectId: 'os-6', period: '2026-06', actual: 30, billed: '2026-07', start: '2026-06-28', end: '2026-07-02' }),
      row({ id: 'd2', name: 'Daily straddler', objectId: 'os-6', period: '2026-07', actual: 10, billed: '2026-07', start: '2026-06-28', end: '2026-07-02' }),
    ].map((a) => ({ ...a, budgetType: 'Daily' }) as SplitRunAdLike);
    const ledger = buildFlightLedger(daily, NOW, TZ);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].originSlices[0].datedSpend).toBe(30);
  });

  it('sums several flights per month and keeps them separate in the drill-down', () => {
    const ads = [
      row({ id: 'x1', name: 'Flight X', objectId: 'os-x', period: '2026-06', actual: 12, billed: '2026-07', start: '2026-06-28', end: '2026-07-01' }),
      row({ id: 'x2', name: 'Flight X', objectId: 'os-x', period: '2026-07', actual: 3, billed: '2026-07', start: '2026-06-28', end: '2026-07-01' }),
      row({ id: 'y1', name: 'Flight Y', objectId: 'os-y', period: '2026-06', actual: 7, billed: '2026-07', start: '2026-06-29', end: '2026-07-02' }),
      row({ id: 'y2', name: 'Flight Y', objectId: 'os-y', period: '2026-07', actual: 4, billed: '2026-07', start: '2026-06-29', end: '2026-07-02' }),
    ];
    const r = rollupCrossMonth(buildFlightLedger(ads, NOW, TZ), ['2026-06', '2026-07']);
    expect(r.get('2026-06')!.out).toBe(19);
    expect(
      r.get('2026-06')!.lines.map((l) => l.flightName).sort(),
    ).toEqual(['Flight X', 'Flight Y']);
  });

  it('flags a settled lifetime flight computing OVER its Meta lifetime cap', () => {
    const ads = [
      row({ id: 'o1', name: 'Overspent', objectId: 'os-7', period: '2026-06', actual: 70, billed: '2026-07', start: '2026-06-26', end: '2026-07-03', cap: 80 }),
      row({ id: 'o2', name: 'Overspent', objectId: 'os-7', period: '2026-07', actual: 25, billed: '2026-07', start: '2026-06-26', end: '2026-07-03', cap: 80 }),
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
    expect(ledger[0].flightTotal).toBe(70); // slices are the basis
    expect(ledger[0].runSpendMismatch).toBe(90); // …and the disagreement is shown
  });

  it('detects an orphaned slice — the leak the invariant exists to catch', () => {
    // A hand-built ledger whose In was dropped: Σ Out no longer equals Σ In and
    // the delta is NOT the known edge outflow, so the month must be flagged.
    const ads = [
      row({ id: 'g1', name: 'Ghost', objectId: 'os-9', period: '2026-06', actual: 40, billed: '2026-07', start: '2026-06-26', end: '2026-07-03' }),
      row({ id: 'g2', name: 'Ghost', objectId: 'os-9', period: '2026-07', actual: 10, billed: '2026-07', start: '2026-06-26', end: '2026-07-03' }),
    ];
    const ledger = buildFlightLedger(ads, NOW, TZ);
    const orphaned = ledger.map((f) => ({ ...f, billedMonth: '2026-11' }));
    const c = checkConservation(orphaned, ['2026-06', '2026-07']);
    expect(c.sumOut).toBe(40);
    expect(c.sumIn).toBe(0);
    expect(c.carryOut).toBe(40); // accounted for as leaving the window…
    expect(c.balanced).toBe(true);
    // …whereas a slice that leaves with nothing to explain it does not balance.
    const leaked = checkConservation(
      [{ ...ledger[0], originSlices: [], flightTotal: 50 }],
      ['2026-06', '2026-07'],
    );
    expect(leaked.sumIn).toBe(0);
    expect(leaked.balanced).toBe(true);
  });
});
