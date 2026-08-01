import { describe, it, expect } from 'vitest';
import { coversDate, pickActiveEvent, type EventAsset } from './event-assets';

function ev(id: string, from: string, to: string, over: Partial<EventAsset> = {}): EventAsset {
  return {
    id,
    make: 'Chevrolet',
    name: id,
    logoUrl: `https://cdn/${id}.png`,
    effectiveFrom: new Date(`${from}T00:00:00Z`),
    effectiveTo: new Date(`${to}T23:59:59Z`),
    required: true,
    offerTypes: [],
    ...over,
  };
}

const FEB_20 = new Date('2026-02-20T12:00:00Z');

describe('coversDate', () => {
  it('is inclusive at both ends', () => {
    const e = ev('a', '2026-02-01', '2026-02-28');
    expect(coversDate(e, new Date('2026-02-01T00:00:00Z'))).toBe(true);
    expect(coversDate(e, new Date('2026-02-28T23:59:59Z'))).toBe(true);
  });

  it('excludes outside the window', () => {
    const e = ev('a', '2026-02-01', '2026-02-28');
    expect(coversDate(e, new Date('2026-01-31T23:00:00Z'))).toBe(false);
    expect(coversDate(e, new Date('2026-03-01T00:00:00Z'))).toBe(false);
  });
});

describe('pickActiveEvent', () => {
  it('returns null with nothing on file', () => {
    expect(pickActiveEvent([], FEB_20, 'lease')).toBeNull();
  });

  it('returns null when no event covers the run date', () => {
    expect(pickActiveEvent([ev('summer', '2026-06-01', '2026-08-31')], FEB_20, 'lease')).toBeNull();
  });

  it('picks the single in-window event', () => {
    const e = pickActiveEvent([ev('presidents', '2026-02-14', '2026-02-23')], FEB_20, 'lease');
    expect(e?.id).toBe('presidents');
  });

  it('prefers the SHORTER window when events overlap', () => {
    // OEMs run a brief holiday push inside a long seasonal campaign; the specific
    // short event is the one they expect on the ad.
    const e = pickActiveEvent(
      [ev('q1-long', '2026-01-01', '2026-03-31'), ev('presidents', '2026-02-14', '2026-02-23')],
      FEB_20,
      'lease',
    );
    expect(e?.id).toBe('presidents');
  });

  it('prefers an offer-type-scoped event over a catch-all', () => {
    const e = pickActiveEvent(
      [
        ev('all-types', '2026-02-14', '2026-02-23'),
        ev('lease-only', '2026-02-14', '2026-02-23', { offerTypes: ['lease'] }),
      ],
      FEB_20,
      'lease',
    );
    expect(e?.id).toBe('lease-only');
  });

  it('ignores an event scoped to a different offer type', () => {
    const e = pickActiveEvent(
      [ev('apr-only', '2026-02-14', '2026-02-23', { offerTypes: ['apr'] })],
      FEB_20,
      'lease',
    );
    expect(e).toBeNull();
  });

  it('falls back to the catch-all when the scoped one does not apply', () => {
    const e = pickActiveEvent(
      [
        ev('all-types', '2026-02-01', '2026-02-28'),
        ev('apr-only', '2026-02-14', '2026-02-23', { offerTypes: ['apr'] }),
      ],
      FEB_20,
      'lease',
    );
    expect(e?.id).toBe('all-types');
  });

  it('breaks equal windows by latest start then id, for a total order', () => {
    // Determinism is a correctness requirement: generation is idempotent, so a
    // retry that picked a different event would mutate an approved ad's artwork.
    const a = ev('aaa', '2026-02-14', '2026-02-23');
    const b = ev('bbb', '2026-02-14', '2026-02-23');
    expect(pickActiveEvent([a, b], FEB_20, 'lease')?.id).toBe('aaa');
    expect(pickActiveEvent([b, a], FEB_20, 'lease')?.id).toBe('aaa');
  });

  it('is unaffected by input order generally', () => {
    const set = [
      ev('q1-long', '2026-01-01', '2026-03-31'),
      ev('presidents', '2026-02-14', '2026-02-23'),
      ev('lease-only', '2026-02-14', '2026-02-23', { offerTypes: ['lease'] }),
    ];
    const forward = pickActiveEvent(set, FEB_20, 'lease')?.id;
    const reversed = pickActiveEvent([...set].reverse(), FEB_20, 'lease')?.id;
    expect(reversed).toBe(forward);
    expect(forward).toBe('lease-only');
  });

  it('resolves against the RUN date, so preparing ahead picks the right event', () => {
    const events = [
      ev('february', '2026-02-01', '2026-02-28'),
      ev('march', '2026-03-01', '2026-03-31'),
    ];
    // Generated in February, but the flight runs in March.
    const marchRun = new Date('2026-03-05T00:00:00Z');
    expect(pickActiveEvent(events, marchRun, 'lease')?.id).toBe('march');
    expect(pickActiveEvent(events, FEB_20, 'lease')?.id).toBe('february');
  });

  it('carries the required flag through', () => {
    const optional = pickActiveEvent([ev('opt', '2026-02-14', '2026-02-23', { required: false })], FEB_20, 'lease');
    expect(optional?.required).toBe(false);
  });
});
