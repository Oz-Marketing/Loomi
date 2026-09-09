import { describe, expect, it } from 'vitest';
import {
  makesWithNewOffers,
  modelsWithNewOffers,
  offersLandedTitle,
  summariseModels,
} from './poll-offers';

const scope = (model: string, newCount: number) => ({
  model,
  newFingerprints: Array.from({ length: newCount }, (_, i) => `${model}-${i}`),
});

describe('modelsWithNewOffers', () => {
  it('names only the models that actually gained offers', () => {
    expect(
      modelsWithNewOffers([scope('Silverado 1500', 3), scope('Equinox', 0), scope('Traverse', 1)]),
    ).toEqual(['Silverado 1500', 'Traverse']);
  });

  it('deduplicates a model watched under several scopes', () => {
    // One model can be polled per-year or per-trim, so the same name arrives
    // more than once in a sweep. That is one piece of news.
    expect(modelsWithNewOffers([scope('Silverado 1500', 2), scope('Silverado 1500', 1)])).toEqual([
      'Silverado 1500',
    ]);
  });

  it('is empty when a poll saw offers but none were new', () => {
    // The common case between cycles: the feed still returns the old book.
    // Firing a "new offers" notification then is how people learn to ignore it.
    expect(modelsWithNewOffers([scope('Silverado 1500', 0), scope('Equinox', 0)])).toEqual([]);
  });
});

describe('summariseModels', () => {
  it('lists a short set in full', () => {
    expect(summariseModels(['Silverado 1500', 'Equinox'])).toBe('Silverado 1500, Equinox');
  });

  it('caps a long set and counts the remainder', () => {
    expect(summariseModels(['Colorado', 'Equinox', 'Silverado 1500', 'Traverse', 'Blazer'])).toBe(
      'Colorado, Equinox, Silverado 1500 and 2 more',
    );
  });

  it('says "1 more", not "1 mores"', () => {
    expect(summariseModels(['A', 'B', 'C', 'D'])).toBe('A, B, C and 1 more');
  });

  it('handles a single model', () => {
    expect(summariseModels(['Pilot'])).toBe('Pilot');
  });
});

const makeScope = (make: string, newCount: number) => ({
  make,
  newFingerprints: Array.from({ length: newCount }, (_, i) => `${make}-${i}`),
});

describe('makesWithNewOffers', () => {
  it('names only the manufacturers that actually gained offers', () => {
    expect(
      makesWithNewOffers([makeScope('Chevrolet', 3), makeScope('GMC', 0), makeScope('Buick', 1)]),
    ).toEqual(['Chevrolet', 'Buick']);
  });

  it('collapses the several scopes one make is polled under', () => {
    expect(makesWithNewOffers([makeScope('Honda', 2), makeScope('Honda', 1)])).toEqual(['Honda']);
  });
});

describe('offersLandedTitle', () => {
  it('leads with the manufacturer, which is the thing a reviewer scans for', () => {
    // The old title was "40 new manufacturer offers published" and you had to
    // read a model list to work out whose cycle turned over.
    expect(offersLandedTitle(['Honda'], 40)).toBe('40 new Honda offers published');
  });

  it('agrees in number', () => {
    expect(offersLandedTitle(['Honda'], 1)).toBe('1 new Honda offer published');
  });

  it('moves several makes after the count, where they still parse', () => {
    expect(offersLandedTitle(['Honda', 'Chevrolet'], 12)).toBe(
      '12 new offers published — Honda, Chevrolet',
    );
  });

  it('falls back to the generic wording rather than an empty dash', () => {
    expect(offersLandedTitle([], 5)).toBe('5 new manufacturer offers published');
  });
});
