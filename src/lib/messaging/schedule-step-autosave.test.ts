import { describe, expect, it } from 'vitest';
import { restoreSchedule, scheduleInstantValue } from './schedule-step-autosave';

// Zones are pinned so these pass on any machine. NOW is 12:00 noon in Denver.
const DENVER = 'America/Denver';
const NEW_YORK = 'America/New_York';
const NOW = new Date('2026-10-12T18:00:00Z');
const meta = (schedule: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ...extra, schedule });

describe('restoreSchedule', () => {
  it('returns null when nothing was saved', () => {
    expect(restoreSchedule('', NOW, DENVER)).toBeNull();
    expect(restoreSchedule(null, NOW, DENVER)).toBeNull();
    expect(restoreSchedule('not json', NOW, DENVER)).toBeNull();
    expect(restoreSchedule(JSON.stringify({ templateSlug: 'x' }), NOW, DENVER)).toBeNull();
  });

  it('restores a stored instant as the wall clock of the reading browser', () => {
    // 15:30Z is 9:30 AM in Denver and 11:30 AM in New York, the same moment.
    const saved = meta({ mode: 'later', at: '2026-10-14T15:30:00.000Z' });
    expect(restoreSchedule(saved, NOW, DENVER)).toEqual({ mode: 'later', at: '2026-10-14T09:30' });
    expect(restoreSchedule(saved, NOW, NEW_YORK)).toEqual({ mode: 'later', at: '2026-10-14T11:30' });
  });

  it('still reads the old zoneless wall clock, in the reading browser’s zone', () => {
    expect(restoreSchedule(meta({ mode: 'later', at: '2026-10-14T09:30' }), NOW, DENVER)).toEqual({
      mode: 'later',
      at: '2026-10-14T09:30',
    });
  });

  it('restores "now"', () => {
    expect(restoreSchedule(meta({ mode: 'now', at: '2026-10-14T15:30:00.000Z' }), NOW, DENVER)).toEqual({
      mode: 'now',
      at: '2026-10-14T09:30',
    });
  });

  it('keeps the mode but drops a time that has already passed', () => {
    expect(restoreSchedule(meta({ mode: 'later', at: '2026-10-12T17:59:00.000Z' }), NOW, DENVER)).toEqual({
      mode: 'later',
    });
    // Legacy value one minute before noon Denver.
    expect(restoreSchedule(meta({ mode: 'later', at: '2026-10-12T11:59' }), NOW, DENVER)).toEqual({
      mode: 'later',
    });
  });

  it('ignores an unknown mode or a malformed time', () => {
    expect(restoreSchedule(meta({ mode: 'soon' }), NOW, DENVER)).toBeNull();
    expect(restoreSchedule(meta({ mode: 'later', at: '10/14/2026 9:30' }), NOW, DENVER)).toEqual({
      mode: 'later',
    });
    // An ISO string with no zone is neither format — refusing beats guessing.
    expect(restoreSchedule(meta({ mode: 'later', at: '2026-10-14T09:30:00' }), NOW, DENVER)).toEqual({
      mode: 'later',
    });
  });

  it('reads past the keys other steps own', () => {
    expect(
      restoreSchedule(
        meta({ mode: 'later', at: '2026-10-20T14:00:00.000Z' }, { linkedSmsBlastId: 's1', multiChannel: true }),
        NOW,
        DENVER,
      ),
    ).toEqual({ mode: 'later', at: '2026-10-20T08:00' });
  });
});

describe('scheduleInstantValue', () => {
  it('stores the instant the pickers name, in the browser’s zone', () => {
    expect(scheduleInstantValue('2026-10-14', '09:30', DENVER)).toBe('2026-10-14T15:30:00.000Z');
    expect(scheduleInstantValue('2026-10-14', '09:30', NEW_YORK)).toBe('2026-10-14T13:30:00.000Z');
  });

  it('round-trips through restoreSchedule', () => {
    const at = scheduleInstantValue('2026-12-01', '18:45', DENVER);
    expect(restoreSchedule(meta({ mode: 'later', at }), NOW, DENVER)).toEqual({
      mode: 'later',
      at: '2026-12-01T18:45',
    });
  });

  it('is undefined until both pickers hold a value', () => {
    expect(scheduleInstantValue('', '09:30', DENVER)).toBeUndefined();
    expect(scheduleInstantValue('2026-10-14', '', DENVER)).toBeUndefined();
    expect(scheduleInstantValue('2026-13-45', '09:30', DENVER)).toBeUndefined();
  });
});

describe('daylight saving', () => {
  it('converts across the November change exactly', () => {
    // 2026-11-01 is the day Denver falls back; 14:00Z is 7:00 AM standard time.
    expect(
      restoreSchedule(meta({ mode: 'later', at: '2026-11-01T14:00:00.000Z' }), NOW, DENVER),
    ).toEqual({ mode: 'later', at: '2026-11-01T07:00' });
  });
});
