import { describe, it, expect } from 'vitest';
import {
  emailRates,
  textRates,
  mergeEmail,
  combine,
  sortBlasts,
  foldSources,
  mergeSeries,
  EMPTY_EMAIL_COUNTS,
  EMPTY_TEXT_COUNTS,
  type EmailCounts,
  type TextCounts,
  type BlastRow,
} from './blasts';

const email = (o: Partial<EmailCounts> = {}): EmailCounts => ({ ...EMPTY_EMAIL_COUNTS, ...o });
const text = (o: Partial<TextCounts> = {}): TextCounts => ({ ...EMPTY_TEXT_COUNTS, ...o });

const row = (o: Partial<BlastRow> = {}): BlastRow => ({
  id: 'b1',
  name: 'Spring service',
  channel: 'email',
  source: 'loomi',
  sentAt: '2026-08-01',
  sent: 100,
  delivered: 95,
  opens: 40,
  clicks: 10,
  failed: 5,
  deliveryRate: 0.95,
  openRate: 40 / 95,
  clickRate: 10 / 95,
  ...o,
});

describe('emailRates', () => {
  it('measures opens against delivered, not sent', () => {
    // You cannot open what never arrived. Dividing by sent would make a
    // bounce-heavy send look like an engagement problem.
    const t = emailRates(email({ sent: 1000, delivered: 800, uniqueOpens: 400 }));
    expect(t.openRate).toBe(0.5);
  });

  it('measures bounces against sent', () => {
    const t = emailRates(email({ sent: 1000, delivered: 900, bounces: 100 }));
    expect(t.bounceRate).toBe(0.1);
  });

  it('returns zero rather than dividing by zero', () => {
    const t = emailRates(email());
    expect(t.openRate).toBe(0);
    expect(t.deliveryRate).toBe(0);
    expect(t.clickToOpenRate).toBe(0);
  });

  it('computes click-to-open against opens, not delivered', () => {
    const t = emailRates(email({ sent: 100, delivered: 100, uniqueOpens: 50, uniqueClicks: 25 }));
    expect(t.clickToOpenRate).toBe(0.5);
    expect(t.clickRate).toBe(0.25);
  });
});

describe('textRates', () => {
  it('derives delivery, failure and opt-out rates', () => {
    const t = textRates(text({ sent: 500, delivered: 480, failed: 20, optOuts: 12 }));
    expect(t.deliveryRate).toBe(0.96);
    expect(t.failureRate).toBe(0.04);
    expect(t.optOutRate).toBe(0.025);
  });

  it('has no concept of opens', () => {
    // Guards the header rule: if someone adds an open field to the text
    // channel, this fails and they have to justify where the data came from.
    expect(Object.keys(textRates(text()))).not.toContain('openRate');
  });
});

describe('mergeEmail', () => {
  it('recomputes rates from summed counts instead of averaging them', () => {
    // A 50-recipient send and a 50,000-recipient send must not carry equal
    // weight. Averaging the two open rates would give 0.75; the honest figure
    // is dominated by the large send.
    const small = email({ campaigns: 1, sent: 50, delivered: 50, uniqueOpens: 50 });
    const large = email({ campaigns: 1, sent: 50_000, delivered: 50_000, uniqueOpens: 25_000 });
    const merged = mergeEmail([small, large]);

    expect(merged.sent).toBe(50_050);
    expect(merged.campaigns).toBe(2);
    expect(merged.openRate).toBeCloseTo(25_050 / 50_050, 10);
    expect(merged.openRate).not.toBeCloseTo(0.75, 2);
  });

  it('handles an empty source list', () => {
    expect(mergeEmail([])).toMatchObject({ sent: 0, campaigns: 0, openRate: 0 });
  });

  it('is unaffected by the order sources are merged in', () => {
    const a = email({ campaigns: 1, sent: 300, delivered: 280, uniqueOpens: 100 });
    const b = email({ campaigns: 2, sent: 700, delivered: 650, uniqueOpens: 300 });
    expect(mergeEmail([a, b])).toEqual(mergeEmail([b, a]));
  });
});

describe('combine', () => {
  it('sums only the measures that mean the same thing in both channels', () => {
    const c = combine(
      email({ campaigns: 2, sent: 1000, delivered: 900, failed: 100 }),
      text({ campaigns: 1, sent: 500, delivered: 490, failed: 10 }),
    );
    expect(c).toEqual({
      campaigns: 3,
      sent: 1500,
      delivered: 1390,
      failed: 110,
      deliveryRate: 1390 / 1500,
    });
  });

  it('exposes no engagement measure at all', () => {
    // The whole point: an open rate over email+text sends sinks as texting
    // grows, and reads as engagement getting worse when nothing changed.
    const c = combine(email({ sent: 1000, delivered: 1000, uniqueOpens: 500 }), text({ sent: 9000, delivered: 9000 }));
    expect(Object.keys(c).sort()).toEqual(
      ['campaigns', 'deliveryRate', 'delivered', 'failed', 'sent'].sort(),
    );
    expect(c).not.toHaveProperty('openRate');
    expect(c).not.toHaveProperty('uniqueOpens');
  });

  it('derives the combined delivery rate from the summed parts', () => {
    // Not the mean of 1.0 and 0.5 (0.75) — the weighted truth is 0.9.
    const c = combine(email({ sent: 800, delivered: 800 }), text({ sent: 200, delivered: 100 }));
    expect(c.deliveryRate).toBe(0.9);
  });
});

describe('sortBlasts', () => {
  it('puts the newest send first', () => {
    const out = sortBlasts([
      row({ id: 'old', sentAt: '2026-01-01' }),
      row({ id: 'new', sentAt: '2026-08-01' }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('sinks undated sends to the bottom rather than treating them as ancient', () => {
    // Undated rows are almost all historical imports. Sorting them as 1970
    // would be right; floating them to the TOP would not — and sorting them
    // last keeps recent activity where someone can see it.
    const out = sortBlasts([
      row({ id: 'undated', sentAt: null }),
      row({ id: 'dated', sentAt: '2026-08-01' }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['dated', 'undated']);
  });

  it('breaks ties by name so the order is stable', () => {
    const out = sortBlasts([
      row({ id: 'b', name: 'Winter', sentAt: '2026-08-01' }),
      row({ id: 'a', name: 'Autumn', sentAt: '2026-08-01' }),
    ]);
    expect(out.map((r) => r.name)).toEqual(['Autumn', 'Winter']);
  });

  it('does not mutate its input', () => {
    const input = [row({ id: 'a', sentAt: '2026-01-01' }), row({ id: 'b', sentAt: '2026-08-01' })];
    sortBlasts(input);
    expect(input.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('foldSources', () => {
  it('splits volume by where the send came from', () => {
    const out = foldSources([
      row({ id: '1', source: 'loomi', sent: 300 }),
      row({ id: '2', source: 'other', sent: 700 }),
      row({ id: '3', source: 'other', sent: 0 }),
    ]);
    expect(out[0]).toMatchObject({ source: 'other', campaigns: 2, sent: 700, share: 0.7 });
    expect(out[1]).toMatchObject({ source: 'loomi', campaigns: 1, sent: 300, share: 0.3 });
  });

  it('never names the previous vendor', () => {
    const out = foldSources([row({ source: 'other' })]);
    expect(out[0].label).toBe('Another provider');
    expect(JSON.stringify(out).toLowerCase()).not.toContain('highlevel');
    expect(JSON.stringify(out).toLowerCase()).not.toContain('ghl');
  });

  it('does not divide by zero when nothing was sent', () => {
    const out = foldSources([row({ sent: 0 })]);
    expect(out[0].share).toBe(0);
  });
});

describe('mergeSeries', () => {
  it('adds same-day buckets across sources and sorts by date', () => {
    const out = mergeSeries([
      [{ date: '2026-08-02', delivered: 5, opens: 2, clicks: 1 }],
      [
        { date: '2026-08-01', delivered: 10, opens: 4, clicks: 2 },
        { date: '2026-08-02', delivered: 7, opens: 3, clicks: 0 },
      ],
    ]);
    expect(out).toEqual([
      { date: '2026-08-01', delivered: 10, opens: 4, clicks: 2 },
      { date: '2026-08-02', delivered: 12, opens: 5, clicks: 1 },
    ]);
  });

  it('handles no series at all', () => {
    expect(mergeSeries([])).toEqual([]);
  });
});
