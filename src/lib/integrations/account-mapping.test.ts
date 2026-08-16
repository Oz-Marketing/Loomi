/**
 * The DB-first resolvers, and specifically the precedence rules between the
 * `Account` columns and the legacy env maps. Those rules are the whole reason
 * this module exists, and getting one backwards points a report at the wrong
 * property or the wrong rooftop's reviews.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const findUnique = vi.fn();
const findMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: { account: { findUnique: (...a: unknown[]) => findUnique(...a), findMany: (...a: unknown[]) => findMany(...a) } },
}));

const {
  resolveGa4Property,
  resolveGa4Platform,
  resolvePlaceConfig,
  resolveAccountByPlaceId,
} = await import('./account-mapping');

const ENV = { ...process.env };

beforeEach(() => {
  findUnique.mockReset();
  findMany.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  process.env = { ...ENV };
});

describe('resolveGa4Property', () => {
  it('prefers the column over the env map', async () => {
    process.env.GA4_PROPERTY_MAP = JSON.stringify({ young: '111111111' });
    findUnique.mockResolvedValue({ ga4PropertyId: '999999999' });
    expect(await resolveGa4Property('young')).toBe('999999999');
  });

  it('falls back to env when the column is empty', async () => {
    process.env.GA4_PROPERTY_MAP = JSON.stringify({ young: '111111111' });
    findUnique.mockResolvedValue({ ga4PropertyId: null });
    expect(await resolveGa4Property('young')).toBe('111111111');
  });

  it('strips non-digits from a stored value', async () => {
    findUnique.mockResolvedValue({ ga4PropertyId: 'properties/404-123' });
    expect(await resolveGa4Property('young')).toBe('404123');
  });

  it('treats a stored value with no digits as unset and falls back', async () => {
    process.env.GA4_PROPERTY_MAP = JSON.stringify({ young: '222222222' });
    findUnique.mockResolvedValue({ ga4PropertyId: 'G-ABCDEF' });
    expect(await resolveGa4Property('young')).toBe('222222222');
  });

  it('returns null when neither source has it', async () => {
    delete process.env.GA4_PROPERTY_MAP;
    findUnique.mockResolvedValue({ ga4PropertyId: null });
    expect(await resolveGa4Property('young')).toBeNull();
  });

  it('returns null for an account that does not exist', async () => {
    delete process.env.GA4_PROPERTY_MAP;
    findUnique.mockResolvedValue(null);
    expect(await resolveGa4Property('nope')).toBeNull();
  });
});

describe('resolveGa4Platform', () => {
  it('uses a recognized stored platform', async () => {
    findUnique.mockResolvedValue({ ga4Platform: 'room58' });
    expect(await resolveGa4Platform('young')).toBe('room58');
  });

  it('ignores an unrecognized stored platform and falls back to env', async () => {
    // A typo must not read as "configured" — it would silently zero out VDPs.
    process.env.GA4_PLATFORM_MAP = JSON.stringify({ young: 'team_velocity' });
    findUnique.mockResolvedValue({ ga4Platform: 'room_58_typo' });
    expect(await resolveGa4Platform('young')).toBe('team_velocity');
  });

  it('defaults to dealer_com when nothing is set anywhere', async () => {
    delete process.env.GA4_PLATFORM_MAP;
    findUnique.mockResolvedValue({ ga4Platform: null });
    expect(await resolveGa4Platform('young')).toBe('dealer_com');
  });
});

describe('resolvePlaceConfig', () => {
  it('prefers the columns, carrying the competitor through', async () => {
    process.env.GOOGLE_PLACES_MAP = JSON.stringify({ young: 'ChIJenv' });
    findUnique.mockResolvedValue({ googlePlaceId: 'ChIJus', googleCompetitorPlaceId: 'ChIJthem' });
    expect(await resolvePlaceConfig('young')).toEqual({
      placeId: 'ChIJus',
      competitorPlaceId: 'ChIJthem',
    });
  });

  it('omits an absent competitor rather than returning empty string', async () => {
    findUnique.mockResolvedValue({ googlePlaceId: 'ChIJus', googleCompetitorPlaceId: '' });
    expect(await resolvePlaceConfig('young')).toEqual({
      placeId: 'ChIJus',
      competitorPlaceId: undefined,
    });
  });

  it('does not let a competitor-only row shadow a complete env entry', async () => {
    // A competitor with no primary is not a config — there is nothing to report.
    process.env.GOOGLE_PLACES_MAP = JSON.stringify({ young: 'ChIJenv' });
    findUnique.mockResolvedValue({ googlePlaceId: null, googleCompetitorPlaceId: 'ChIJthem' });
    expect(await resolvePlaceConfig('young')).toEqual({ placeId: 'ChIJenv' });
  });

  it('returns null when neither source has it', async () => {
    delete process.env.GOOGLE_PLACES_MAP;
    findUnique.mockResolvedValue({ googlePlaceId: null, googleCompetitorPlaceId: null });
    expect(await resolvePlaceConfig('young')).toBeNull();
  });
});

describe('resolveAccountByPlaceId', () => {
  it('resolves from the column', async () => {
    delete process.env.GOOGLE_PLACES_MAP;
    findMany.mockResolvedValue([{ key: 'young-chev' }]);
    expect(await resolveAccountByPlaceId('ChIJus')).toEqual({
      status: 'ok',
      accountKey: 'young-chev',
    });
  });

  it('does NOT report a conflict when DB and env name the same account', async () => {
    // Mid-cutover both sources carry the row. Treating that as ambiguous would
    // block review ingest for every account until the env var was deleted.
    process.env.GOOGLE_PLACES_MAP = JSON.stringify({ 'young-chev': 'ChIJus' });
    findMany.mockResolvedValue([{ key: 'young-chev' }]);
    expect(await resolveAccountByPlaceId('ChIJus')).toEqual({
      status: 'ok',
      accountKey: 'young-chev',
    });
  });

  it('reports a genuine two-account conflict across sources', async () => {
    process.env.GOOGLE_PLACES_MAP = JSON.stringify({ 'young-ford': 'ChIJus' });
    findMany.mockResolvedValue([{ key: 'young-chev' }]);
    expect(await resolveAccountByPlaceId('ChIJus')).toEqual({
      status: 'ambiguous',
      accountKeys: ['young-chev', 'young-ford'],
    });
  });

  it('reports a conflict between two rows in the DB', async () => {
    delete process.env.GOOGLE_PLACES_MAP;
    findMany.mockResolvedValue([{ key: 'b-store' }, { key: 'a-store' }]);
    expect(await resolveAccountByPlaceId('ChIJus')).toEqual({
      status: 'ambiguous',
      accountKeys: ['a-store', 'b-store'],
    });
  });

  it('is unmapped for an unknown listing', async () => {
    delete process.env.GOOGLE_PLACES_MAP;
    findMany.mockResolvedValue([]);
    expect(await resolveAccountByPlaceId('ChIJnope')).toEqual({ status: 'unmapped' });
  });

  it('is unmapped for a blank id without querying', async () => {
    expect(await resolveAccountByPlaceId('   ')).toEqual({ status: 'unmapped' });
    expect(findMany).not.toHaveBeenCalled();
  });
});
