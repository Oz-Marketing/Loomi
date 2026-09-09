// The decisions behind the top-bar badge poll.
//
// These encode the three defects the audit found in all three copies of the
// polling code, so a regression fails here rather than turning back into one
// silent 401 per minute per tab.

import { describe, it, expect } from 'vitest';
import {
  clampWatermark,
  isAuthDenied,
  pollDecision,
  readUnreadCount,
  shouldPoll,
  visibleBadgeCount,
} from './badge-policy';

const base = { authed: true, denied: false, hidden: false };

describe('pollDecision', () => {
  it('polls only when signed in, not denied, and visible', () => {
    expect(pollDecision(base)).toBe('poll');
    expect(shouldPoll(base)).toBe(true);
  });

  it('does not poll while signed out', () => {
    // The defect the audit named: a timer with no idea whether anyone is
    // signed in.
    expect(pollDecision({ ...base, authed: false })).toBe('unauthenticated');
    expect(shouldPoll({ ...base, authed: false })).toBe(false);
  });

  it('does not poll once the server has said no', () => {
    expect(pollDecision({ ...base, denied: true })).toBe('denied');
  });

  it('does not poll a badge nobody can see', () => {
    expect(pollDecision({ ...base, hidden: true })).toBe('hidden');
  });

  it('reports signed-out ahead of hidden, so resuming on focus stays wrong', () => {
    // Ordering is load-bearing. If `hidden` won, a signed-out user in a
    // background tab would report 'hidden', which implies the poll resumes
    // when they look at the tab. It must not.
    expect(pollDecision({ authed: false, denied: false, hidden: true })).toBe('unauthenticated');
  });

  it('reports denied ahead of hidden for the same reason', () => {
    expect(pollDecision({ authed: true, denied: true, hidden: true })).toBe('denied');
  });
});

describe('isAuthDenied', () => {
  it('treats 401 and 403 as stop, not retry', () => {
    expect(isAuthDenied(401)).toBe(true);
    expect(isAuthDenied(403)).toBe(true);
  });

  it('lets transient failures keep retrying', () => {
    // A 502 from a restarting upstream is exactly the case where the NEXT tick
    // should succeed — treating it as denied would silence the badge until the
    // user navigated.
    for (const s of [200, 404, 429, 500, 502, 503]) {
      expect(isAuthDenied(s), String(s)).toBe(false);
    }
  });
});

describe('readUnreadCount', () => {
  it('reads a normal payload', () => {
    expect(readUnreadCount({ unreadCount: 7 })).toBe(7);
  });

  it('never yields NaN, negatives or fractions to the badge', () => {
    for (const bad of [
      undefined, null, {}, 'nope', 42,
      { unreadCount: null }, { unreadCount: 'many' },
      { unreadCount: NaN }, { unreadCount: Infinity }, { unreadCount: -3 },
    ]) {
      const n = readUnreadCount(bad);
      expect(Number.isInteger(n), JSON.stringify(bad)).toBe(true);
      expect(n, JSON.stringify(bad)).toBeGreaterThanOrEqual(0);
    }
    expect(readUnreadCount({ unreadCount: 2.7 })).toBe(2);
  });
});

describe('visibleBadgeCount', () => {
  it('shows the count when nothing has been seen yet', () => {
    expect(visibleBadgeCount(5, 0)).toBe(5);
  });

  it('goes dark once the panel has been opened and closed on those items', () => {
    // The rows are still unread — the user just read the list without
    // clicking each one. The bell must not keep nagging about them.
    expect(visibleBadgeCount(5, 5)).toBe(0);
  });

  it('lights again only for what arrived after the dismissal', () => {
    expect(visibleBadgeCount(6, 5)).toBe(6);
  });

  it('never renders a badge for zero or nonsense', () => {
    expect(visibleBadgeCount(0, 0)).toBe(0);
    expect(visibleBadgeCount(NaN, 0)).toBe(0);
    expect(visibleBadgeCount(-2, 0)).toBe(0);
  });
});

describe('clampWatermark', () => {
  it('follows the count down as items are read', () => {
    // Dismissed at 5, three of them then marked read. If the watermark stayed
    // at 5, three genuinely new notifications would arrive invisible.
    expect(clampWatermark(2, 5)).toBe(2);
    expect(visibleBadgeCount(5, clampWatermark(2, 5))).toBe(5);
  });

  it('does not rise on its own — only a dismissal raises it', () => {
    expect(clampWatermark(9, 3)).toBe(3);
  });

  it('bottoms out at zero', () => {
    expect(clampWatermark(0, 4)).toBe(0);
    expect(clampWatermark(-1, 4)).toBe(0);
  });
});
