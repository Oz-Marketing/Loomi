/**
 * The confidence rules gate whether a proposed id is written without a human
 * looking at it. A wrong `googlePlaceId` files one rooftop's reviews under its
 * neighbour, so these tests are mostly about REFUSING to be confident.
 */
import { describe, it, expect } from 'vitest';
import { ga4Confident, normalize, parseCsvLine, placeConfident, similarity } from './integration-matching';

describe('normalize', () => {
  it('drops punctuation and the words every dealership shares', () => {
    expect(normalize('Young Chevrolet, Inc.')).toBe('young chevrolet');
    expect(normalize('Young Chevrolet - GA4 Property')).toBe('young chevrolet');
  });
});

describe('similarity', () => {
  it('scores an exact dealer name against its GA4 property name', () => {
    expect(similarity('Young Chevrolet', 'Young Chevrolet GA4')).toBe(1);
  });

  it('scores same-brand different-rooftop below identical', () => {
    const same = similarity('Young Chevrolet', 'Young Chevrolet');
    const sibling = similarity('Young Chevrolet', 'Young Ford');
    expect(sibling).toBeLessThan(same);
  });

  it('is zero for unrelated names', () => {
    expect(similarity('Young Chevrolet', 'Riverdale Nissan')).toBe(0);
  });

  it('handles empty input without dividing by zero', () => {
    expect(similarity('', 'Young Chevrolet')).toBe(0);
  });
});

describe('ga4Confident', () => {
  it('accepts a strong match with no runner-up', () => {
    expect(ga4Confident(1, null)).toBe(true);
  });

  it('accepts a strong match clearly ahead of the next', () => {
    expect(ga4Confident(0.9, 0.4)).toBe(true);
  });

  it('refuses a strong match that a sibling nearly ties', () => {
    // "Young Chevrolet" vs "Young Chevrolet Service" — both plausible.
    expect(ga4Confident(0.9, 0.8)).toBe(false);
  });

  it('refuses a weak match even when uncontested', () => {
    expect(ga4Confident(0.4, null)).toBe(false);
  });
});

describe('placeConfident', () => {
  const ok = {
    nameScore: 0.9,
    addressMatches: true,
    businessStatus: 'OPERATIONAL',
    hasCloseRunnerUp: false,
  };

  it('accepts a strong, address-confirmed, unambiguous, open listing', () => {
    expect(placeConfident(ok)).toBe(true);
  });

  it('refuses when the address does not agree', () => {
    // The tie-breaker that name similarity cannot be — two rooftops of one
    // brand share a name but never a street.
    expect(placeConfident({ ...ok, addressMatches: false })).toBe(false);
  });

  it('refuses a closed or relocated listing', () => {
    expect(placeConfident({ ...ok, businessStatus: 'CLOSED_PERMANENTLY' })).toBe(false);
    expect(placeConfident({ ...ok, businessStatus: 'CLOSED_TEMPORARILY' })).toBe(false);
  });

  it('refuses when a runner-up is nearly as good', () => {
    // The service-department listing next door to the sales listing.
    expect(placeConfident({ ...ok, hasCloseRunnerUp: true })).toBe(false);
  });

  it('refuses a weak name match even with everything else agreeing', () => {
    expect(placeConfident({ ...ok, nameScore: 0.5 })).toBe(false);
  });
});

describe('parseCsvLine', () => {
  // The bug: the previous regex parser dropped the property id whenever an
  // earlier cell was empty, and the import reported "0 updated" for a file
  // that looked right.
  it('keeps empty cells in position', () => {
    expect(parseCsvLine('youngToyota,,358669326,,')).toEqual([
      'youngToyota',
      '',
      '358669326',
      '',
      '',
    ]);
  });

  it('handles a fully populated row', () => {
    expect(parseCsvLine('key,Young Toyota,358669326,ChIJabc,ChIJxyz')).toEqual([
      'key',
      'Young Toyota',
      '358669326',
      'ChIJabc',
      'ChIJxyz',
    ]);
  });

  it('respects commas inside quotes', () => {
    // Dealer names really do contain commas — "Young Chevrolet, Layton".
    expect(parseCsvLine('key,"Young Chevrolet, Layton",123,,')).toEqual([
      'key',
      'Young Chevrolet, Layton',
      '123',
      '',
      '',
    ]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsvLine('key,"The ""Big"" Lot",123,,')[1]).toBe('The "Big" Lot');
  });

  it('returns empty cells for an empty row rather than throwing', () => {
    expect(parseCsvLine('k,,,,')).toEqual(['k', '', '', '', '']);
  });
});
