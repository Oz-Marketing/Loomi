import { describe, it, expect } from 'vitest';
import {
  resolveState,
  withDerived,
  summarize,
  visibleAccountKeys,
  dayDiff,
  EXPIRING_SOON_DAYS,
  type BillboardRow,
} from './billboards';

const NOW = new Date('2026-08-14T00:00:00Z');

const row = (o: Partial<BillboardRow> = {}): BillboardRow => ({
  id: 'b1',
  accountKey: 'youngHonda',
  sharedWithChildren: false,
  providerName: 'Reagan',
  billboardNumber: '1042',
  artworkUrl: null,
  facingDirection: 'N',
  avgDailyTraffic: 50_000,
  pricePerPeriod: 2_500,
  numPeriods: 4,
  periodType: '4-week',
  expirationDate: null,
  latitude: 41.07,
  longitude: -111.98,
  status: 'active',
  notes: null,
  ...o,
});

describe('resolveState', () => {
  it('flags a board inside the expiring window', () => {
    const { state, daysToExpiry } = resolveState('active', '2026-09-01', NOW);
    expect(state).toBe('expiring');
    expect(daysToExpiry).toBe(18);
  });

  it('calls a board active when expiry is beyond the window', () => {
    expect(resolveState('active', '2026-12-01', NOW).state).toBe('active');
  });

  it('reports a past date as expired with a negative countdown', () => {
    const { state, daysToExpiry } = resolveState('active', '2026-08-01', NOW);
    expect(state).toBe('expired');
    expect(daysToExpiry).toBe(-13);
  });

  it('treats expiring today as expiring, not expired', () => {
    // A board whose contract runs through today is still up today.
    expect(resolveState('active', '2026-08-14', NOW)).toEqual({ state: 'expiring', daysToExpiry: 0 });
  });

  it('treats the window boundary as expiring', () => {
    const boundary = new Date(NOW);
    boundary.setUTCDate(boundary.getUTCDate() + EXPIRING_SOON_DAYS);
    const iso = boundary.toISOString().slice(0, 10);
    expect(resolveState('active', iso, NOW).state).toBe('expiring');
  });

  it('never expires a board with no end date', () => {
    // Open-ended contracts are real. Treating a missing date as "expired
    // today" would hide live boards from the map.
    expect(resolveState('active', null, NOW)).toEqual({ state: 'active', daysToExpiry: null });
  });

  it('lets archived win over a passed date', () => {
    // Archiving is a decision someone made; it outranks the calendar.
    expect(resolveState('archived', '2020-01-01', NOW).state).toBe('archived');
  });
});

describe('withDerived', () => {
  it('multiplies the contract value across periods', () => {
    const b = withDerived(row({ pricePerPeriod: 2_500, numPeriods: 4 }), 'youngHonda', NOW);
    expect(b.contractValue).toBe(10_000);
  });

  it('treats a missing period count as one rather than zeroing the value', () => {
    const b = withDerived(row({ pricePerPeriod: 900, numPeriods: 0 }), 'youngHonda', NOW);
    expect(b.contractValue).toBe(900);
  });

  it('leaves an unpriced board null rather than zero', () => {
    const b = withDerived(row({ pricePerPeriod: null }), 'youngHonda', NOW);
    expect(b.contractValue).toBeNull();
  });

  it('marks a board owned by another account as inherited', () => {
    const own = withDerived(row({ accountKey: 'youngHonda' }), 'youngHonda', NOW);
    const group = withDerived(row({ accountKey: 'youngGroup' }), 'youngHonda', NOW);
    expect(own.inherited).toBe(false);
    expect(group.inherited).toBe(true);
  });
});

describe('summarize', () => {
  const boards = [
    withDerived(row({ id: 'a', expirationDate: '2026-12-01', avgDailyTraffic: 40_000 }), 'youngHonda', NOW),
    withDerived(row({ id: 'b', expirationDate: '2026-09-01', avgDailyTraffic: 20_000 }), 'youngHonda', NOW),
    withDerived(row({ id: 'c', expirationDate: '2026-01-01', avgDailyTraffic: 10_000 }), 'youngHonda', NOW),
  ];

  it('counts each state and sums traffic', () => {
    const t = summarize(boards);
    expect(t).toMatchObject({ boards: 3, active: 1, expiringSoon: 1, expired: 1 });
    expect(t.totalDailyTraffic).toBe(70_000);
  });

  it('sums only priced boards and says how many those were', () => {
    // Counting an unpriced board as $0 would understate a real commitment and
    // read as though someone got a board for free.
    const mixed = [
      withDerived(row({ id: 'a', pricePerPeriod: 1_000, numPeriods: 2 }), 'youngHonda', NOW),
      withDerived(row({ id: 'b', pricePerPeriod: null }), 'youngHonda', NOW),
    ];
    const t = summarize(mixed);
    expect(t.totalValue).toBe(2_000);
    expect(t.pricedBoards).toBe(1);
    expect(t.boards).toBe(2);
  });

  it('reports a null total when nothing is priced', () => {
    const t = summarize([withDerived(row({ pricePerPeriod: null }), 'youngHonda', NOW)]);
    expect(t.totalValue).toBeNull();
  });

  it('handles an empty board list', () => {
    const t = summarize([]);
    expect(t).toMatchObject({ boards: 0, active: 0, totalDailyTraffic: 0 });
    expect(t.totalValue).toBeNull();
  });
});

describe('visibleAccountKeys', () => {
  it('includes the account and its ancestors', () => {
    expect(visibleAccountKeys('youngHonda', ['youngGroup', 'youngHoldings'])).toEqual([
      'youngHonda',
      'youngGroup',
      'youngHoldings',
    ]);
  });

  it('does not list the account twice if it appears in its own chain', () => {
    expect(visibleAccountKeys('youngHonda', ['youngHonda', 'youngGroup'])).toEqual([
      'youngHonda',
      'youngGroup',
    ]);
  });

  it('handles a top-level account with no parent', () => {
    expect(visibleAccountKeys('youngGroup', [])).toEqual(['youngGroup']);
  });
});

describe('dayDiff', () => {
  it('ignores time of day so a board does not expire at noon', () => {
    const morning = new Date('2026-08-14T01:00:00Z');
    const evening = new Date('2026-08-14T23:00:00Z');
    expect(dayDiff(morning, evening)).toBe(0);
  });

  it('counts across a month boundary', () => {
    expect(dayDiff(new Date('2026-08-30T00:00:00Z'), new Date('2026-09-02T00:00:00Z'))).toBe(3);
  });
});
