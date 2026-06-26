import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getPlacesApiKey,
  isPlacesConfigured,
  resolvePlaceConfig,
  getPlaceDetails,
} from './google-places';

const ORIG_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIG_ENV };
  vi.restoreAllMocks();
});

describe('getPlacesApiKey', () => {
  it('reads GOOGLE_MAPS_API_KEY, then falls back to GOOGLE_PLACES_API_KEY', () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;
    expect(getPlacesApiKey()).toBeNull();
    expect(isPlacesConfigured()).toBe(false);

    process.env.GOOGLE_PLACES_API_KEY = 'fallback';
    expect(getPlacesApiKey()).toBe('fallback');

    process.env.GOOGLE_MAPS_API_KEY = 'primary';
    expect(getPlacesApiKey()).toBe('primary');
    expect(isPlacesConfigured()).toBe(true);
  });
});

describe('resolvePlaceConfig', () => {
  it('accepts a bare place-id string', () => {
    process.env.GOOGLE_PLACES_MAP = JSON.stringify({ dealerA: 'ChIJabc' });
    expect(resolvePlaceConfig('dealerA')).toEqual({ placeId: 'ChIJabc' });
  });

  it('accepts an object with an optional competitor', () => {
    process.env.GOOGLE_PLACES_MAP = JSON.stringify({
      dealerA: { placeId: 'ChIJus', competitorPlaceId: 'ChIJthem' },
      dealerB: { placeId: 'ChIJonly' },
    });
    expect(resolvePlaceConfig('dealerA')).toEqual({ placeId: 'ChIJus', competitorPlaceId: 'ChIJthem' });
    expect(resolvePlaceConfig('dealerB')).toEqual({ placeId: 'ChIJonly', competitorPlaceId: undefined });
  });

  it('returns null for unmapped keys, no env, or malformed map', () => {
    process.env.GOOGLE_PLACES_MAP = JSON.stringify({ dealerA: 'ChIJabc' });
    expect(resolvePlaceConfig('missing')).toBeNull();

    delete process.env.GOOGLE_PLACES_MAP;
    expect(resolvePlaceConfig('dealerA')).toBeNull();

    process.env.GOOGLE_PLACES_MAP = '{ bad';
    expect(resolvePlaceConfig('dealerA')).toBeNull();
  });
});

function mockPlaces(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? status : status })),
  );
}

describe('getPlaceDetails', () => {
  it('maps the Places (New) response, including recent reviews', async () => {
    mockPlaces({
      displayName: { text: 'Oz Toyota' },
      formattedAddress: '123 Main St, Detroit, MI',
      rating: 4.6,
      userRatingCount: 1287,
      googleMapsUri: 'https://maps.google.com/?cid=1',
      websiteUri: 'https://oztoyota.com',
      businessStatus: 'OPERATIONAL',
      reviews: [
        {
          rating: 5,
          text: { text: 'Great service' },
          authorAttribution: { displayName: 'Jane D.' },
          relativePublishTimeDescription: 'a week ago',
        },
      ],
    });
    const d = await getPlaceDetails('key', 'ChIJabc');
    expect(d).toEqual({
      placeId: 'ChIJabc',
      name: 'Oz Toyota',
      address: '123 Main St, Detroit, MI',
      rating: 4.6,
      reviewCount: 1287,
      mapsUrl: 'https://maps.google.com/?cid=1',
      website: 'https://oztoyota.com',
      businessStatus: 'OPERATIONAL',
      reviews: [{ author: 'Jane D.', rating: 5, text: 'Great service', relativeTime: 'a week ago' }],
    });
  });

  it('handles a place with no rating / no reviews', async () => {
    mockPlaces({ displayName: { text: 'New Lot' }, userRatingCount: 0 });
    const d = await getPlaceDetails('key', 'ChIJnew');
    expect(d.rating).toBeNull();
    expect(d.reviewCount).toBe(0);
    expect(d.reviews).toEqual([]);
  });

  it('throws PlacesError on an API error', async () => {
    mockPlaces({ error: { message: 'Place not found' } }, false, 404);
    await expect(getPlaceDetails('key', 'bad')).rejects.toThrow(/Place not found/);
  });
});
