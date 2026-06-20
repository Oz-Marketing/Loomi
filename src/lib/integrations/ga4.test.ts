import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import {
  getGa4Config,
  isGa4Configured,
  resolveGa4Property,
  getTrafficOverview,
  getTrafficSources,
  getTopPages,
  getTrafficTrend,
  type Ga4Config,
} from './ga4';

// A real keypair so the JWT signing path in getAccessToken actually runs.
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const cfg: Ga4Config = { clientEmail: 'svc@test.iam.gserviceaccount.com', privateKey };

const ORIG_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIG_ENV };
  vi.restoreAllMocks();
});

describe('getGa4Config', () => {
  it('parses a raw JSON service account', () => {
    process.env.GA4_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: 'a@b.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n',
    });
    expect(getGa4Config()).toEqual({
      clientEmail: 'a@b.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n',
    });
    expect(isGa4Configured()).toBe(true);
  });

  it('accepts base64-encoded JSON', () => {
    const json = JSON.stringify({ client_email: 'a@b.com', private_key: 'k' });
    process.env.GA4_SERVICE_ACCOUNT_JSON = Buffer.from(json).toString('base64');
    expect(getGa4Config()).toEqual({ clientEmail: 'a@b.com', privateKey: 'k' });
  });

  it('normalises escaped \\n in the private key', () => {
    process.env.GA4_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: 'a@b.com',
      private_key: 'line1\\nline2',
    });
    expect(getGa4Config()?.privateKey).toBe('line1\nline2');
  });

  it('returns null when unset, malformed, or missing fields', () => {
    delete process.env.GA4_SERVICE_ACCOUNT_JSON;
    expect(getGa4Config()).toBeNull();
    expect(isGa4Configured()).toBe(false);

    process.env.GA4_SERVICE_ACCOUNT_JSON = 'not json {';
    expect(getGa4Config()).toBeNull();

    process.env.GA4_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'a@b.com' });
    expect(getGa4Config()).toBeNull();
  });
});

describe('resolveGa4Property', () => {
  it('maps an account key to a numeric property id', () => {
    process.env.GA4_PROPERTY_MAP = JSON.stringify({ dealerA: '123456789', dealerB: 987654321 });
    expect(resolveGa4Property('dealerA')).toBe('123456789');
    expect(resolveGa4Property('dealerB')).toBe('987654321');
  });

  it('strips non-digits (e.g. "properties/123")', () => {
    process.env.GA4_PROPERTY_MAP = JSON.stringify({ dealerA: 'properties/123-456' });
    expect(resolveGa4Property('dealerA')).toBe('123456');
  });

  it('returns null for unmapped keys, no env, or malformed map', () => {
    process.env.GA4_PROPERTY_MAP = JSON.stringify({ dealerA: '123' });
    expect(resolveGa4Property('missing')).toBeNull();

    delete process.env.GA4_PROPERTY_MAP;
    expect(resolveGa4Property('dealerA')).toBeNull();

    process.env.GA4_PROPERTY_MAP = '{ bad json';
    expect(resolveGa4Property('dealerA')).toBeNull();
  });
});

/**
 * Route fetch by URL so test order / token caching don't matter:
 *   - the OAuth token endpoint → a fake access token
 *   - any :runReport call → the supplied rows
 */
function mockFetch(rows: unknown[]) {
  const fn = vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    }
    if (u.includes(':runReport')) {
      return new Response(JSON.stringify({ rows }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('report mapping', () => {
  beforeEach(() => {
    process.env.GA4_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: cfg.clientEmail, private_key: privateKey });
  });

  it('getTrafficOverview coerces metric strings to numbers', async () => {
    mockFetch([
      { metricValues: [{ value: '1500' }, { value: '1200' }, { value: '800' }, { value: '4200' }, { value: '0.43' }, { value: '95.5' }] },
    ]);
    const o = await getTrafficOverview(cfg, '123', '2026-06-01', '2026-06-19');
    expect(o).toEqual({
      sessions: 1500,
      totalUsers: 1200,
      newUsers: 800,
      pageViews: 4200,
      bounceRate: 0.43,
      avgSessionDuration: 95.5,
    });
  });

  it('getTrafficOverview returns zeros when GA4 sends no rows', async () => {
    mockFetch([]);
    const o = await getTrafficOverview(cfg, '123', '2026-06-01', '2026-06-19');
    expect(o.sessions).toBe(0);
    expect(o.pageViews).toBe(0);
  });

  it('getTrafficTrend normalises YYYYMMDD → ISO', async () => {
    mockFetch([
      { dimensionValues: [{ value: '20260601' }], metricValues: [{ value: '50' }, { value: '40' }] },
      { dimensionValues: [{ value: '20260602' }], metricValues: [{ value: '60' }, { value: '55' }] },
    ]);
    const trend = await getTrafficTrend(cfg, '123', '2026-06-01', '2026-06-02');
    expect(trend).toEqual([
      { date: '2026-06-01', sessions: 50, users: 40 },
      { date: '2026-06-02', sessions: 60, users: 55 },
    ]);
  });

  it('getTrafficSources falls back to (unknown) for blank channels', async () => {
    mockFetch([
      { dimensionValues: [{ value: 'Organic Search' }], metricValues: [{ value: '900' }, { value: '700' }] },
      { dimensionValues: [{ value: '' }], metricValues: [{ value: '10' }, { value: '8' }] },
    ]);
    const sources = await getTrafficSources(cfg, '123', '2026-06-01', '2026-06-19');
    expect(sources[0]).toEqual({ channel: 'Organic Search', sessions: 900, users: 700 });
    expect(sources[1].channel).toBe('(unknown)');
  });

  it('getTopPages maps page title/path/views/time', async () => {
    mockFetch([
      { dimensionValues: [{ value: 'Home' }, { value: '/' }], metricValues: [{ value: '3000' }, { value: '42.5' }] },
    ]);
    const pages = await getTopPages(cfg, '123', '2026-06-01', '2026-06-19', 10);
    expect(pages[0]).toEqual({ title: 'Home', path: '/', views: 3000, avgTime: 42.5 });
  });
});
