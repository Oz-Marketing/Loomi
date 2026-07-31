import { describe, it, expect } from 'vitest';
import { windowPreview, DEFAULT_ROLLING_DAYS } from './window-preview';
import { runWindowFor } from './poll-offers';

/**
 * `windowPreview` re-implements the run-window arithmetic so the settings UI
 * can label the picker without dragging `node:crypto` into the client bundle.
 * These assert it agrees with the server's `runWindowFor` — the point of the
 * copy is that it's provably identical, not merely similar.
 */
const iso = (d: Date) => d.toISOString().slice(0, 10);

const MOMENTS = [
  '2026-07-30T12:00:00Z', // the ordinary case
  '2026-12-15T12:00:00Z', // year rollover on "next month"
  '2026-02-01T12:00:00Z', // short month
  '2026-01-31T12:00:00Z', // 31st → a month with fewer days
  '2028-02-15T12:00:00Z', // leap February
  '2026-07-31T23:30:00-07:00', // local July 31 that is ALREADY August 1 in UTC
  '2026-08-01T00:30:00Z', // just past a UTC boundary
];

describe('windowPreview matches the server run window', () => {
  for (const when of MOMENTS) {
    for (const mode of ['next_month', 'current_month', 'rolling']) {
      it(`${mode} @ ${when}`, () => {
        const now = new Date(when);
        const w = runWindowFor({ runWindowMode: mode, rollingDays: DEFAULT_ROLLING_DAYS }, now);
        expect(windowPreview(mode, now)).toBe(`${iso(w.start)} → ${iso(w.end)}`);
      });
    }
  }

  it('falls through to next month for an unrecognised mode, as the server does', () => {
    const now = new Date('2026-07-30T12:00:00Z');
    const w = runWindowFor({ runWindowMode: 'nonsense', rollingDays: 30 }, now);
    expect(windowPreview('nonsense', now)).toBe(`${iso(w.start)} → ${iso(w.end)}`);
  });
});
