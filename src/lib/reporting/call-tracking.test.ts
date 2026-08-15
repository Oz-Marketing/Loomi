import { describe, it, expect } from 'vitest';
import {
  foldStatuses,
  foldTrackers,
  foldCities,
  foldDaysOfWeek,
  foldHours,
  foldDates,
  summarize,
  DAY_NAMES,
} from './call-tracking';

// The six summaries are the port. Two carry judgment that a naive rewrite gets
// wrong — averaging duration over answered calls only, and returning a
// fixed-length series for hour and weekday.

describe('foldStatuses', () => {
  it('ranks statuses by volume and computes shares', () => {
    const out = foldStatuses([
      { status: 'missed', calls: 30 },
      { status: 'answered', calls: 70 },
    ]);
    expect(out.map((s) => s.status)).toEqual(['answered', 'missed']);
    expect(out.map((s) => s.share)).toEqual([0.7, 0.3]);
  });

  it('keeps a status the vendor invented rather than dropping it', () => {
    // status is not an enum on purpose — a new tracker outcome must appear as
    // itself, not vanish from a report that still claims to total every call.
    const out = foldStatuses([
      { status: 'answered', calls: 5 },
      { status: 'voicemail', calls: 3 },
    ]);
    expect(out.map((s) => s.status)).toContain('voicemail');
    expect(out.reduce((n, s) => n + s.calls, 0)).toBe(8);
  });

  it('labels a null status rather than dropping the call', () => {
    const out = foldStatuses([{ status: null, calls: 4 }]);
    expect(out[0]).toMatchObject({ status: 'unknown', calls: 4 });
  });

  it('returns zero shares rather than NaN for an empty range', () => {
    expect(foldStatuses([])).toEqual([]);
    expect(foldStatuses([{ status: 'answered', calls: 0 }])[0].share).toBe(0);
  });
});

describe('foldTrackers', () => {
  it('averages duration over ANSWERED calls, not over all calls', () => {
    // 10 calls, 2 answered, 600s of talk time. Over answered → 300s.
    // Over all calls it would be 60s, which reads as "short conversations"
    // when the real story is "eight people got no answer".
    const [t] = foldTrackers([
      { name: 'Spring Service', calls: 10, answered: 2, answeredDuration: 600 },
    ]);
    expect(t.avgDuration).toBe(300);
    expect(t.answerRate).toBe(20);
    expect(t.missed).toBe(8);
  });

  it('reports a null average when nothing was answered', () => {
    // 0 seconds over 0 answered calls is undefined, not a zero-second call.
    const [t] = foldTrackers([{ name: 'Ghost', calls: 6, answered: 0, answeredDuration: 0 }]);
    expect(t.avgDuration).toBeNull();
    expect(t.answerRate).toBe(0);
    expect(t.missed).toBe(6);
  });

  it('reports a null answer rate for a tracker with no calls', () => {
    const [t] = foldTrackers([{ name: 'Idle', calls: 0, answered: 0, answeredDuration: 0 }]);
    expect(t.answerRate).toBeNull();
  });

  it('sorts by volume and names an unnamed tracker', () => {
    const out = foldTrackers([
      { name: null, calls: 2, answered: 1, answeredDuration: 60 },
      { name: 'Main', calls: 9, answered: 9, answeredDuration: 900 },
    ]);
    expect(out.map((t) => t.name)).toEqual(['Main', 'Unknown']);
    expect(out[1].avgDuration).toBe(60);
  });
});

describe('foldCities', () => {
  it('ranks cities and folds a null city into Unknown', () => {
    const out = foldCities([
      { city: 'Layton', calls: 10 },
      { city: null, calls: 5 },
      { city: 'Ogden', calls: 20 },
    ]);
    expect(out.map((c) => c.city)).toEqual(['Ogden', 'Layton', 'Unknown']);
    // Every call is still represented — the shares sum to one.
    expect(out.reduce((n, c) => n + c.share, 0)).toBeCloseTo(1);
  });
});

describe('foldDaysOfWeek', () => {
  it('always returns seven days, Monday first, zeros included', () => {
    // A sparse series would omit the Sunday with no calls, and the chart drawn
    // from it would show a week that never happened.
    const out = foldDaysOfWeek([{ dow: 1, calls: 12 }, { dow: 5, calls: 8 }]);
    expect(out).toHaveLength(7);
    expect(out.map((d) => d.day)).toEqual([...DAY_NAMES]);
    expect(out[0]).toEqual({ day: 'Monday', calls: 12 });
    expect(out[4]).toEqual({ day: 'Friday', calls: 8 });
    expect(out[6]).toEqual({ day: 'Sunday', calls: 0 });
  });

  it('maps isodow 7 to Sunday, not to Monday', () => {
    // Postgres isodow is 1=Mon..7=Sun. An off-by-one here silently relabels
    // every day in the chart.
    const out = foldDaysOfWeek([{ dow: 7, calls: 3 }]);
    expect(out.find((d) => d.day === 'Sunday')!.calls).toBe(3);
    expect(out.find((d) => d.day === 'Monday')!.calls).toBe(0);
  });

  it('returns an all-zero week for an empty range', () => {
    expect(foldDaysOfWeek([]).every((d) => d.calls === 0)).toBe(true);
  });
});

describe('foldHours', () => {
  it('always returns 24 hours in order, zeros included', () => {
    const out = foldHours([{ hour: 9, calls: 14 }, { hour: 17, calls: 6 }]);
    expect(out).toHaveLength(24);
    expect(out.map((h) => h.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(out[9].calls).toBe(14);
    expect(out[0].calls).toBe(0);
  });

  it('keeps midnight and 11pm as real buckets', () => {
    const out = foldHours([{ hour: 0, calls: 2 }, { hour: 23, calls: 5 }]);
    expect(out[0].calls).toBe(2);
    expect(out[23].calls).toBe(5);
  });
});

describe('foldDates', () => {
  it('orders chronologically regardless of row order', () => {
    const out = foldDates([
      { date: '2026-07-03', calls: 5, answered: 3 },
      { date: '2026-07-01', calls: 9, answered: 7 },
    ]);
    expect(out.map((d) => d.date)).toEqual(['2026-07-01', '2026-07-03']);
  });
});

describe('summarize', () => {
  it('derives totals and the answer rate from the status breakdown', () => {
    const statuses = foldStatuses([
      { status: 'answered', calls: 70 },
      { status: 'missed', calls: 30 },
    ]);
    const s = summarize(statuses, 70 * 180);
    expect(s).toMatchObject({ calls: 100, answered: 70, missed: 30, answerRate: 70 });
    expect(s.avgDuration).toBe(180);
  });

  it('counts every non-answered status as missed, including vendor extras', () => {
    // "missed" is defined as "not answered" rather than as a specific status,
    // so a voicemail doesn't quietly disappear from both halves of the split.
    const statuses = foldStatuses([
      { status: 'answered', calls: 4 },
      { status: 'missed', calls: 3 },
      { status: 'voicemail', calls: 3 },
    ]);
    const s = summarize(statuses, 400);
    expect(s.calls).toBe(10);
    expect(s.answered).toBe(4);
    expect(s.missed).toBe(6);
    expect(s.answered + s.missed).toBe(s.calls);
  });

  it('returns nulls rather than NaN for a range with no calls', () => {
    const s = summarize([], 0);
    expect(s).toMatchObject({ calls: 0, answered: 0, missed: 0 });
    expect(s.answerRate).toBeNull();
    expect(s.avgDuration).toBeNull();
  });
});
