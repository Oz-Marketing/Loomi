import { describe, expect, it } from 'vitest';
import {
  WARMUP_SCHEDULE,
  dayIndex,
  resolveAllowance,
  sendingDomain,
  unlimitedAllowance,
  utcDayStart,
  type WarmupState,
} from './warmup';

function state(overrides: Partial<WarmupState> = {}): WarmupState {
  return {
    domain: 'mail.example.com',
    startedAt: new Date('2026-09-01T00:00:00Z'),
    status: 'active',
    sentToday: 0,
    countedOn: null,
    dailyCapOverride: null,
    heldOnDay: null,
    ...overrides,
  };
}

describe('sendingDomain', () => {
  it('lowercases the host', () => {
    expect(sendingDomain('Sales@Mail.Example.COM')).toBe('mail.example.com');
  });

  it('returns null for anything unusable', () => {
    for (const input of [null, undefined, '', 'not-an-email', 'trailing@']) {
      expect(sendingDomain(input)).toBeNull();
    }
  });

  it('takes the last @ so a quoted local part cannot shift the domain', () => {
    expect(sendingDomain('"weird@local"@example.com')).toBe('example.com');
  });
});

describe('dayIndex', () => {
  it('counts UTC calendar days, not elapsed 24h periods', () => {
    const started = new Date('2026-09-01T23:59:00Z');
    // 2 minutes later, but the next calendar day — that is day 1.
    expect(dayIndex(started, new Date('2026-09-02T00:01:00Z'))).toBe(1);
  });

  it('never goes negative for a clock that reads before the start', () => {
    expect(dayIndex(new Date('2026-09-10T00:00:00Z'), new Date('2026-09-01T00:00:00Z'))).toBe(0);
  });

  it('is zero on the first day', () => {
    expect(dayIndex(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-01T18:00:00Z'))).toBe(0);
  });
});

describe('resolveAllowance', () => {
  it('gives the first rung on day one', () => {
    const a = resolveAllowance(state(), new Date('2026-09-01T09:00:00Z'));
    expect(a.dailyCap).toBe(WARMUP_SCHEDULE[0]);
    expect(a.remaining).toBe(WARMUP_SCHEDULE[0]);
    expect(a.day).toBe(1);
    expect(a.status).toBe('active');
  });

  it('advances a rung per calendar day', () => {
    const a = resolveAllowance(state(), new Date('2026-09-04T09:00:00Z'));
    expect(a.dailyCap).toBe(WARMUP_SCHEDULE[3]);
    expect(a.day).toBe(4);
  });

  it('subtracts what today has already used', () => {
    const a = resolveAllowance(
      state({ sentToday: 30, countedOn: new Date('2026-09-01T00:00:00Z') }),
      new Date('2026-09-01T15:00:00Z'),
    );
    expect(a.usedToday).toBe(30);
    expect(a.remaining).toBe(WARMUP_SCHEDULE[0] - 30);
  });

  it('treats a counter from an earlier day as spent-nothing', () => {
    // The stale number must not eat into the new day's budget.
    const a = resolveAllowance(
      state({ sentToday: 9_999, countedOn: new Date('2026-09-01T00:00:00Z') }),
      new Date('2026-09-02T00:30:00Z'),
    );
    expect(a.usedToday).toBe(0);
    expect(a.remaining).toBe(WARMUP_SCHEDULE[1]);
  });

  it('never reports a negative remaining', () => {
    const a = resolveAllowance(
      state({ sentToday: 10_000, countedOn: new Date('2026-09-01T00:00:00Z') }),
      new Date('2026-09-01T15:00:00Z'),
    );
    expect(a.remaining).toBe(0);
  });

  it('graduates past the end of the schedule', () => {
    const a = resolveAllowance(state(), new Date('2027-01-01T00:00:00Z'));
    expect(a.status).toBe('completed');
    expect(a.dailyCap).toBeNull();
    expect(a.remaining).toBeNull();
  });

  it('holds the ramp at heldOnDay without losing elapsed time', () => {
    const a = resolveAllowance(state({ heldOnDay: 2 }), new Date('2026-09-30T00:00:00Z'));
    expect(a.dailyCap).toBe(WARMUP_SCHEDULE[2]);
    expect(a.day).toBe(3);
  });

  it('honours an override ahead of the schedule', () => {
    const a = resolveAllowance(state({ dailyCapOverride: 7 }), new Date('2026-09-08T00:00:00Z'));
    expect(a.dailyCap).toBe(7);
  });

  it('keeps an override in force past the end of the ramp', () => {
    const a = resolveAllowance(state({ dailyCapOverride: 7 }), new Date('2027-01-01T00:00:00Z'));
    expect(a.dailyCap).toBe(7);
    expect(a.status).toBe('active');
  });

  it('lifts the cap when paused, rather than zeroing it', () => {
    // Pausing exists to get mail flowing again; a cap of zero would make it a
    // worse version of the thing it undoes.
    const a = resolveAllowance(state({ status: 'paused' }), new Date('2026-09-01T00:00:00Z'));
    expect(a.status).toBe('paused');
    expect(a.remaining).toBeNull();
  });

  it('is monotonic across the whole ramp', () => {
    const caps = WARMUP_SCHEDULE.map((_, i) =>
      resolveAllowance(state(), new Date(utcDayStart(new Date('2026-09-01T00:00:00Z')).getTime() + i * 86_400_000))
        .dailyCap,
    );
    for (let i = 1; i < caps.length; i++) {
      expect(caps[i]!).toBeGreaterThanOrEqual(caps[i - 1]!);
    }
  });
});

describe('unlimitedAllowance', () => {
  it('is the no-warm-up state', () => {
    const a = unlimitedAllowance('example.com');
    expect(a.status).toBe('none');
    expect(a.dailyCap).toBeNull();
    expect(a.remaining).toBeNull();
  });
});
