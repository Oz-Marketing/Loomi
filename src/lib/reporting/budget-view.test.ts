import { describe, it, expect } from 'vitest';
import { toClientBudgetView, indexActuals } from './budget-view';
import {
  createChannelRegistry,
  SEED_CHANNEL_RECORDS,
} from '@/lib/budget/channel-registry';

/**
 * The seed channel list, as a registry. Passed in rather than loaded, which is
 * what keeps `toClientBudgetView` pure — and pure is the property that makes
 * "margin never leaks" assertable here instead of a convention.
 */
const ch = createChannelRegistry(SEED_CHANNEL_RECORDS);
import type { BudgetSummary } from '@/lib/services/budget';

// The point of this file is the LEAK TEST. Reporting admits the `client` role,
// so anything that reaches this DTO reaches a dealer. The hub's summary carries
// Oz's cost and margin; these tests assert, by walking the whole object graph,
// that none of it survives the projection — by key name AND by value, so a
// renamed field still gets caught.

/** Every margin figure carries a distinctive value we can search the output for. */
const MARGIN_SENTINELS = {
  spendTargetMeta: 7777,
  spendTargetGoogle: 6666,
  spendTargetJan: 5555,
  cost: 4444,
  revenue: 3333,
  knownRevenue: 2222,
  uncosted: 1111,
  defaultMarkup: 0.8642,
};

const summary = (over: Partial<BudgetSummary> = {}): BudgetSummary => ({
  accountKey: 'youngHonda',
  year: 2026,
  declaredTotal: 500_000,
  monthlyRetainer: 12_000,
  agreements: [
    {
      id: 'ag1',
      accountKey: 'youngHonda',
      name: '2026 Retainer',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      committedAmount: 500_000,
      status: 'active',
      defaultMarkup: MARGIN_SENTINELS.defaultMarkup,
      notes: null,
      termMonths: 12,
      monthsInYear: 12,
      commitmentForYear: 500_000,
      monthlyFeeTotal: 12_000,
      fees: [{ id: 'f1', channel: 'management', monthlyAmount: 12_000, label: 'Management fee' }],
    },
  ],
  totalCommitted: 420_000,
  allocated: 360_000,
  pool: 60_000,
  baseTotal: 300_000,
  addedTotal: 120_000,
  unplanned: 80_000,
  overAllocated: false,
  byChannel: [
    { channel: 'meta', amount: 200_000, spendTarget: MARGIN_SENTINELS.spendTargetMeta },
    { channel: 'google', amount: 160_000, spendTarget: MARGIN_SENTINELS.spendTargetGoogle },
  ],
  byPeriod: [
    { period: '2026-01', amount: 30_000, spendTarget: MARGIN_SENTINELS.spendTargetJan },
    { period: '2026-02', amount: 30_000, spendTarget: 5554 },
  ],
  byLineType: [
    {
      lineType: 'media',
      amount: 360_000,
      cost: MARGIN_SENTINELS.cost,
      revenue: MARGIN_SENTINELS.revenue,
      costKnown: true,
      lines: 24,
    },
  ],
  knownRevenue: MARGIN_SENTINELS.knownRevenue,
  uncostedAmount: MARGIN_SENTINELS.uncosted,
  ...over,
});

const noActuals = indexActuals([]);

/** Every key name appearing anywhere in a nested structure. */
function allKeys(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, acc);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.push(k);
      allKeys(v, acc);
    }
  }
  return acc;
}

/** Every number appearing anywhere in a nested structure. */
function allNumbers(value: unknown, acc: number[] = []): number[] {
  if (typeof value === 'number') acc.push(value);
  else if (Array.isArray(value)) for (const v of value) allNumbers(v, acc);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) allNumbers(v, acc);
  return acc;
}

describe('toClientBudgetView — margin must not leak', () => {
  const view = toClientBudgetView(ch, 'youngHonda', summary(), noActuals);

  it('carries no cost, revenue, margin or markup key anywhere', () => {
    const keys = allKeys(view).map((k) => k.toLowerCase());
    for (const banned of ['cost', 'revenue', 'margin', 'markup', 'spendtarget', 'costknown']) {
      expect(keys.filter((k) => k.includes(banned))).toEqual([]);
    }
  });

  it('carries no margin VALUE anywhere, even under an innocent key name', () => {
    // Catches the case where someone maps spendTarget onto a field called
    // something harmless. The numbers themselves must not appear.
    const numbers = new Set(allNumbers(view));
    for (const [name, sentinel] of Object.entries(MARGIN_SENTINELS)) {
      expect({ name, present: numbers.has(sentinel) }).toEqual({ name, present: false });
    }
  });

  it('drops the per-fee breakdown from contracts', () => {
    // Fee structure is commercial detail between Oz and the client's contract,
    // not something a reporting page needs.
    expect(view.contracts).toEqual([{ name: '2026 Retainer', commitment: 500_000 }]);
  });

  it('still carries the figures the client is entitled to', () => {
    expect(view.contractTotal).toBe(500_000);
    expect(view.planned).toBe(420_000);
    expect(view.scheduled).toBe(360_000);
    expect(view.unscheduled).toBe(60_000);
    expect(view.byChannel.map((c) => c.amount)).toEqual([200_000, 160_000]);
  });
});

describe('toClientBudgetView — shaping', () => {
  it('labels channels from the registry rather than echoing the key', () => {
    const view = toClientBudgetView(ch, 'youngHonda', summary(), noActuals);
    expect(view.byChannel.map((c) => c.label)).toEqual(['Meta', 'Google']);
    expect(view.byChannel[0].category).toBe('Digital');
  });

  it('falls back to the raw key for a channel the registry does not know', () => {
    const view = toClientBudgetView(ch, 'youngHonda',
      summary({ byChannel: [{ channel: 'mystery_channel', amount: 100, spendTarget: 80 }] }),
      noActuals,
    );
    expect(view.byChannel[0].label).toBe('mystery_channel');
    expect(view.byChannel[0].category).toBe('Other');
  });

  it('sorts channels by spend, biggest first', () => {
    const view = toClientBudgetView(ch, 'youngHonda',
      summary({
        byChannel: [
          { channel: 'google', amount: 10, spendTarget: 8 },
          { channel: 'meta', amount: 90, spendTarget: 70 },
        ],
      }),
      noActuals,
    );
    expect(view.byChannel.map((c) => c.channel)).toEqual(['meta', 'google']);
    expect(view.byChannel[0].share).toBeCloseTo(0.9);
  });

  it('orders months chronologically and labels them in UTC', () => {
    const view = toClientBudgetView(ch, 'youngHonda',
      summary({
        byPeriod: [
          { period: '2026-03', amount: 1, spendTarget: 1 },
          { period: '2026-01', amount: 1, spendTarget: 1 },
        ],
      }),
      noActuals,
    );
    expect(view.byPeriod.map((p) => p.period)).toEqual(['2026-01', '2026-03']);
    expect(view.byPeriod[0].label).toBe('Jan 2026');
  });

  it('reports a null contract total rather than inventing one from the lines', () => {
    const view = toClientBudgetView(ch, 'youngHonda',
      summary({ declaredTotal: null, unplanned: null, agreements: [] }),
      noActuals,
    );
    expect(view.contractTotal).toBeNull();
    expect(view.unplanned).toBeNull();
    // Planned still reports — it comes from the lines, not the contract.
    expect(view.planned).toBe(420_000);
  });

  it('passes the over-planned flag through', () => {
    const view = toClientBudgetView(ch, 'youngHonda', summary({ overAllocated: true }), noActuals);
    expect(view.overPlanned).toBe(true);
  });
});

describe('indexActuals', () => {
  it('totals actuals by month and by channel', () => {
    const idx = indexActuals([
      { period: '2026-01', channel: 'meta', actualAmount: 1_000, settled: true },
      { period: '2026-01', channel: 'google', actualAmount: 500, settled: true },
      { period: '2026-02', channel: 'meta', actualAmount: 800, settled: false },
    ]);
    expect(idx.total).toBe(2_300);
    expect(idx.byChannel.get('meta')!.actual).toBe(1_800);
    expect(idx.byPeriod.get('2026-01')!.actual).toBe(1_500);
    expect(idx.recordedLines).toBe(3);
  });

  it('counts settled and recorded separately — they come apart in the ledger', () => {
    const idx = indexActuals([
      { period: '2026-01', channel: 'meta', actualAmount: null, settled: true },
      { period: '2026-01', channel: 'google', actualAmount: 500, settled: false },
    ]);
    const jan = idx.byPeriod.get('2026-01')!;
    expect(jan.lines).toBe(2);
    expect(jan.settled).toBe(1); // one closed
    expect(jan.recorded).toBe(1); // a different one has a figure
  });

  it('counts an unscheduled line in the total but not in any month', () => {
    const idx = indexActuals([
      { period: null, channel: null, actualAmount: 250, settled: true },
    ]);
    expect(idx.total).toBe(250);
    expect(idx.byPeriod.size).toBe(0);
  });

  it('does not count a null actual as a recorded zero', () => {
    const idx = indexActuals([
      { period: '2026-01', channel: 'meta', actualAmount: null, settled: false },
    ]);
    expect(idx.total).toBe(0);
    expect(idx.recordedLines).toBe(0);
    expect(idx.byPeriod.get('2026-01')!.recorded).toBe(0);
  });

  it('treats a genuine zero as recorded', () => {
    // "We spent nothing" is a real answer and must survive as one.
    const idx = indexActuals([
      { period: '2026-01', channel: 'meta', actualAmount: 0, settled: true },
    ]);
    expect(idx.recordedLines).toBe(1);
    expect(idx.byPeriod.get('2026-01')!.recorded).toBe(1);
  });
});

describe('toClientBudgetView — actuals', () => {
  it('marks a month settled only when all its lines are', () => {
    const actuals = indexActuals([
      { period: '2026-01', channel: 'meta', actualAmount: 28_000, settled: true },
      { period: '2026-02', channel: 'meta', actualAmount: 10_000, settled: true },
      { period: '2026-02', channel: 'google', actualAmount: 500, settled: false },
    ]);
    const view = toClientBudgetView(ch, 'youngHonda', summary(), actuals);
    const [jan, feb] = view.byPeriod;
    expect(jan.settled).toBe(true);
    expect(feb.settled).toBe(false);
    expect(feb.actual).toBe(10_500);
  });

  it('reports NULL spend, not zero, when a month closed without an actual', () => {
    // Observed in the real ledger: status 'settled', settledAt set,
    // actualAmount null. Reporting $0 would show a full-budget underspend.
    const actuals = indexActuals([
      { period: '2026-01', channel: 'meta', actualAmount: null, settled: true },
    ]);
    const view = toClientBudgetView(ch, 'youngHonda', summary(), actuals);
    const jan = view.byPeriod.find((p) => p.period === '2026-01')!;
    expect(jan.settled).toBe(true);
    expect(jan.actual).toBeNull();
    expect(jan.actualRecorded).toBe(false);
  });

  it('reports null spend overall when nothing anywhere has been recorded', () => {
    const view = toClientBudgetView(ch, 'youngHonda', summary(), noActuals);
    expect(view.spent).toBeNull();
    expect(view.byPeriod.every((p) => p.actual === null)).toBe(true);
    expect(view.byChannel.every((c) => c.actual === null)).toBe(true);
  });

  it('reports a recorded zero as zero, not as missing', () => {
    const actuals = indexActuals([
      { period: '2026-01', channel: 'meta', actualAmount: 0, settled: true },
    ]);
    const view = toClientBudgetView(ch, 'youngHonda', summary(), actuals);
    const jan = view.byPeriod.find((p) => p.period === '2026-01')!;
    expect(jan.actual).toBe(0);
    expect(jan.actualRecorded).toBe(true);
    expect(view.spent).toBe(0);
  });
});
