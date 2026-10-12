import { describe, expect, it } from 'vitest';
import {
  accountLocalEquivalent,
  instantFromWallClock,
  timeZoneLabel,
  wallClockInZone,
} from './send-time';

const DENVER = 'America/Denver';

describe('wallClockInZone', () => {
  it('reads an instant in a zone, across midnight', () => {
    const at = new Date('2026-10-15T03:30:00Z');
    expect(wallClockInZone(at, DENVER)).toEqual({ date: '2026-10-14', time: '21:30' });
    expect(wallClockInZone(at, 'UTC')).toEqual({ date: '2026-10-15', time: '03:30' });
  });

  it('reports midnight as 00, not 24', () => {
    expect(wallClockInZone(new Date('2026-10-14T06:00:00Z'), DENVER)).toEqual({
      date: '2026-10-14',
      time: '00:00',
    });
  });
});

describe('instantFromWallClock', () => {
  it('inverts wallClockInZone in summer and winter', () => {
    expect(instantFromWallClock('2026-07-01', '09:00', DENVER)?.toISOString()).toBe(
      '2026-07-01T15:00:00.000Z',
    );
    expect(instantFromWallClock('2026-12-01', '09:00', DENVER)?.toISOString()).toBe(
      '2026-12-01T16:00:00.000Z',
    );
  });

  it('moves a time in the skipped spring hour forward, as a browser does', () => {
    // Denver skips 2:00–3:00 AM on 2026-03-08.
    expect(instantFromWallClock('2026-03-08', '02:30', DENVER)?.toISOString()).toBe(
      '2026-03-08T09:30:00.000Z',
    );
  });

  it('accepts the legacy US/* zone names accounts store', () => {
    expect(instantFromWallClock('2026-10-14', '09:00', 'US/Eastern')?.toISOString()).toBe(
      '2026-10-14T13:00:00.000Z',
    );
  });

  it('refuses malformed or impossible input', () => {
    expect(instantFromWallClock('2026-02-31', '09:00', DENVER)).toBeNull();
    expect(instantFromWallClock('2026-10-14', '25:00', DENVER)).toBeNull();
    expect(instantFromWallClock('10/14/2026', '09:00', DENVER)).toBeNull();
    expect(instantFromWallClock('2026-10-14', '09:00', 'Not/AZone')).toBeNull();
  });
});

describe('timeZoneLabel', () => {
  it('uses the everyday name', () => {
    expect(timeZoneLabel(DENVER, new Date('2026-10-14T15:00:00Z'))).toBe('Mountain Time');
    expect(timeZoneLabel('US/Eastern', new Date('2026-10-14T15:00:00Z'))).toBe('Eastern Time');
  });

  it('falls back to the id for something Intl cannot name', () => {
    expect(timeZoneLabel('Not/AZone')).toBe('Not/AZone');
  });
});

describe('accountLocalEquivalent', () => {
  const nineDenver = new Date('2026-10-14T15:00:00Z');

  it('spells out the account’s local time when it differs', () => {
    expect(accountLocalEquivalent(nineDenver, 'US/Eastern', DENVER)).toBe('11:00 AM Eastern Time');
  });

  it('adds the weekday when the account is already on another date', () => {
    // 11 PM Tuesday in Denver is 1 AM Wednesday in New York.
    expect(accountLocalEquivalent(new Date('2026-10-14T05:00:00Z'), 'America/New_York', DENVER)).toBe(
      'Wed 1:00 AM Eastern Time',
    );
  });

  it('says nothing when the clocks agree or the account has no usable zone', () => {
    expect(accountLocalEquivalent(nineDenver, 'US/Mountain', DENVER)).toBeNull();
    expect(accountLocalEquivalent(nineDenver, '', DENVER)).toBeNull();
    expect(accountLocalEquivalent(nineDenver, null, DENVER)).toBeNull();
    expect(accountLocalEquivalent(nineDenver, 'Mountain', DENVER)).toBeNull();
  });
});
