import { describe, it, expect } from 'vitest';
import { nextAllowedSendTime, parseHhMm, birthdayMatchesTarget } from './scheduling';
import { zonedTodayIso } from '@/lib/timezone';

const TZ = 'America/Denver'; // Mountain Time (YAG default)

// Fixed instants by MT wall-clock on 2026-06-01 (DST, UTC-6).
const sevenAmMT = Date.parse('2026-06-01T13:00:00Z'); // 07:00 MT
const noonMT = Date.parse('2026-06-01T20:00:00Z'); // 14:00 MT
const ninePmMT = Date.parse('2026-06-02T03:00:00Z'); // 21:00 MT on Jun 1

describe('parseHhMm', () => {
  it('parses valid times to ms-since-midnight', () => {
    expect(parseHhMm('09:00')).toBe(9 * 3_600_000);
    expect(parseHhMm('19:30')).toBe(19 * 3_600_000 + 30 * 60_000);
  });
  it('rejects malformed times', () => {
    expect(parseHhMm('25:00')).toBeNull();
    expect(parseHhMm('oops')).toBeNull();
    expect(parseHhMm('9')).toBeNull();
  });
});

describe('nextAllowedSendTime — 09:00-19:00 window', () => {
  it('allows a send inside the window', () => {
    expect(nextAllowedSendTime(noonMT, TZ, '09:00', '19:00')).toBeNull();
  });
  it('defers a pre-window send to today 09:00', () => {
    const fire = nextAllowedSendTime(sevenAmMT, TZ, '09:00', '19:00');
    expect(fire).not.toBeNull();
    expect(zonedTodayIso(fire!.getTime(), TZ)).toBe('2026-06-01');
    expect(fire!.getTime()).toBeGreaterThan(sevenAmMT);
    // and the deferred time itself is inside the window
    expect(nextAllowedSendTime(fire!.getTime(), TZ, '09:00', '19:00')).toBeNull();
  });
  it('defers a post-window send to the NEXT day 09:00', () => {
    const fire = nextAllowedSendTime(ninePmMT, TZ, '09:00', '19:00');
    expect(fire).not.toBeNull();
    expect(zonedTodayIso(fire!.getTime(), TZ)).toBe('2026-06-02');
    expect(nextAllowedSendTime(fire!.getTime(), TZ, '09:00', '19:00')).toBeNull();
  });
});

describe('nextAllowedSendTime — overnight wrap window 21:00-06:00', () => {
  it('allows a send at/after start', () => {
    expect(nextAllowedSendTime(ninePmMT, TZ, '21:00', '06:00')).toBeNull();
  });
  it('defers a midday send', () => {
    expect(nextAllowedSendTime(noonMT, TZ, '21:00', '06:00')).not.toBeNull();
  });
});

describe('nextAllowedSendTime — malformed window fails open', () => {
  it('returns null (sends allowed) on bad config', () => {
    expect(nextAllowedSendTime(noonMT, TZ, 'oops', '19:00')).toBeNull();
  });
});

describe('birthdayMatchesTarget', () => {
  const dob = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it('matches a normal birthday on its month/day', () => {
    expect(birthdayMatchesTarget(dob('1990-03-15'), '2026-03-15')).toBe(true);
    expect(birthdayMatchesTarget(dob('1990-03-15'), '2026-03-16')).toBe(false);
  });

  it('matches a Feb-29 birthday on Feb-29 in a leap year', () => {
    // 2028 is a leap year
    expect(birthdayMatchesTarget(dob('1992-02-29'), '2028-02-29')).toBe(true);
  });

  it('fires a Feb-29 birthday on Feb-28 in a NON-leap year', () => {
    // 2027 is not a leap year — without the fallback this contact would
    // never get a birthday message.
    expect(birthdayMatchesTarget(dob('1992-02-29'), '2027-02-28')).toBe(true);
  });

  it('does not fire a non-Feb-29 person on Feb-28 via the fallback', () => {
    expect(birthdayMatchesTarget(dob('1990-03-01'), '2027-02-28')).toBe(false);
  });
});
