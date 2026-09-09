import { describe, expect, it } from 'vitest';
import { modelsWithNewOffers, summariseModels } from './poll-offers';

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
