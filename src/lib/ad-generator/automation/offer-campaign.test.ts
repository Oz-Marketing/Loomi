import { describe, it, expect } from 'vitest';
import {
  cycleMonthHasEnded,
  offerCampaignName,
  offerCycleKey,
  offerCycleLabel,
  offerCycleMonth,
  parseCycleKeyMonth,
} from './offer-campaign';
import { monthWindow, nextMonthWindow, rollingWindow } from './offer-timing';

const sep25 = new Date(Date.UTC(2026, 8, 25, 14, 0)); // 25 Sep 2026

describe('offer cycle key', () => {
  it('is the account plus the UTC month the window is FOR', () => {
    expect(offerCycleKey('youngHonda', monthWindow(sep25))).toBe('adgen:youngHonda:2026-09');
    // A late-September run under next_month builds October and is keyed so.
    expect(offerCycleKey('youngHonda', nextMonthWindow(sep25))).toBe('adgen:youngHonda:2026-10');
    expect(offerCycleMonth(rollingWindow(sep25, 30))).toBe('2026-09');
  });

  it('is the same key for two runs that saw different offers', () => {
    // The whole point: the old key hashed the offer set, so a scoped hand run
    // and the full scheduled run made two campaigns for one month.
    const a = offerCycleKey('acct', monthWindow(new Date(Date.UTC(2026, 9, 2))));
    const b = offerCycleKey('acct', monthWindow(new Date(Date.UTC(2026, 9, 28))));
    expect(a).toBe(b);
  });

  it('parses its own month back out, and nothing else', () => {
    expect(parseCycleKeyMonth('adgen:youngHonda:2026-10')).toBe('2026-10');
    expect(parseCycleKeyMonth('adgen:with:colons:2026-10')).toBe('2026-10');
    expect(parseCycleKeyMonth('adgen:youngHonda:0f3a9c2e1b7d4e5f')).toBeNull(); // the old fingerprint key
    expect(parseCycleKeyMonth(null)).toBeNull();
  });
});

describe('campaign name', () => {
  it('is month-first with the year, then the account', () => {
    expect(offerCycleLabel(nextMonthWindow(sep25))).toBe('October 2026');
    expect(offerCampaignName('Young Honda Ogden', nextMonthWindow(sep25))).toBe(
      'October 2026 offers — Young Honda Ogden',
    );
  });
});

describe('cycleMonthHasEnded', () => {
  it('ends a month only once the clock is in a later month', () => {
    expect(cycleMonthHasEnded('2026-09', new Date(Date.UTC(2026, 8, 30, 23, 59)))).toBe(false);
    expect(cycleMonthHasEnded('2026-09', new Date(Date.UTC(2026, 9, 1, 0, 0)))).toBe(true);
  });

  it('never ends a future month — next_month containers survive their own first morning', () => {
    // Built in late September for October: on 1 October the key month equals
    // the current month, so it stays live. The old creation-coupled archive
    // would have archived it here.
    expect(cycleMonthHasEnded('2026-10', new Date(Date.UTC(2026, 9, 1)))).toBe(false);
    expect(cycleMonthHasEnded('2026-11', new Date(Date.UTC(2026, 9, 1)))).toBe(false);
  });
});
