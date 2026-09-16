import { describe, expect, it } from 'vitest';
import {
  getCampaignDate,
  isUpcoming,
  withinDateWindow,
} from './blast-date-window';

// Fixed "now" so the future/past split never drifts with the clock.
const NOW = new Date('2026-09-15T22:00:00Z');
// What `getDateRangeBounds('6m')` produces at NOW: a window ending at NOW.
const SIX_MONTHS_START = new Date('2026-04-01T00:00:00Z');

describe('withinDateWindow', () => {
  it('keeps a blast scheduled for tomorrow inside a "last 6 months" window', () => {
    // The regression. Young Used Center had a blast scheduled for 07:30
    // Mountain the next morning; every preset ends at `now`, so the upper
    // bound filtered it out and the table showed "1 / 3" with no way to
    // reach the other two.
    const scheduledTomorrow = { scheduledAt: '2026-09-16T13:30:00Z' };

    expect(withinDateWindow(scheduledTomorrow, SIX_MONTHS_START, NOW, NOW)).toBe(true);
  });

  it('keeps a blast scheduled beyond the window by days', () => {
    expect(
      withinDateWindow({ scheduledAt: '2026-09-18T16:00:29Z' }, SIX_MONTHS_START, NOW, NOW),
    ).toBe(true);
  });

  it('keeps a sent blast that falls inside the window', () => {
    expect(
      withinDateWindow({ sentAt: '2026-09-15T16:00:29Z' }, SIX_MONTHS_START, NOW, NOW),
    ).toBe(true);
  });

  it('drops a sent blast that predates the window', () => {
    expect(
      withinDateWindow({ sentAt: '2026-01-04T16:00:00Z' }, SIX_MONTHS_START, NOW, NOW),
    ).toBe(false);
  });

  it('filters nothing when there is no lower bound ("All time")', () => {
    expect(withinDateWindow({ sentAt: '2019-01-01T00:00:00Z' }, null, NOW, NOW)).toBe(true);
  });

  it('drops a row with no usable date', () => {
    expect(withinDateWindow({}, SIX_MONTHS_START, NOW, NOW)).toBe(false);
    expect(withinDateWindow({ createdAt: 'not-a-date' }, SIX_MONTHS_START, NOW, NOW)).toBe(false);
  });

  it('does not let a future range END smuggle a past blast through', () => {
    // A custom range ending in the past still excludes later history: the
    // upcoming-send exemption must key off the row, not the bound.
    const end = new Date('2026-07-31T23:59:59Z');
    expect(
      withinDateWindow({ sentAt: '2026-08-15T00:00:00Z' }, SIX_MONTHS_START, end, NOW),
    ).toBe(false);
  });
});

describe('isUpcoming', () => {
  it('is false once the blast has sent, even with a future scheduledAt', () => {
    // A resend carries a forward-dated schedule; sentAt is the truth.
    expect(
      isUpcoming({ sentAt: '2026-09-15T16:00:00Z', scheduledAt: '2026-09-20T16:00:00Z' }, NOW),
    ).toBe(false);
  });

  it('is false for a past schedule that never sent', () => {
    expect(isUpcoming({ scheduledAt: '2026-09-14T16:00:00Z' }, NOW)).toBe(false);
  });

  it('is true for a pending future schedule', () => {
    expect(isUpcoming({ scheduledAt: '2026-09-16T13:30:00Z' }, NOW)).toBe(true);
  });
});

describe('getCampaignDate', () => {
  it('prefers sentAt, then scheduledAt, then updatedAt, then createdAt', () => {
    expect(
      getCampaignDate({
        sentAt: '2026-09-01T00:00:00Z',
        scheduledAt: '2026-09-02T00:00:00Z',
        updatedAt: '2026-09-03T00:00:00Z',
        createdAt: '2026-09-04T00:00:00Z',
      }),
    ).toEqual(new Date('2026-09-01T00:00:00Z'));

    expect(
      getCampaignDate({ updatedAt: '2026-09-03T00:00:00Z', createdAt: '2026-09-04T00:00:00Z' }),
    ).toEqual(new Date('2026-09-03T00:00:00Z'));
  });
});
