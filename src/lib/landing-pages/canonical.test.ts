import { describe, it, expect } from 'vitest';
import { canonicalLandingPageUrl, withQuery } from './canonical';

const STUDIO = 'https://studio.loomilm.com/lp/anniversary-sale';

describe('canonicalLandingPageUrl', () => {
  it('falls back to the studio URL when the account has no verified domain', () => {
    expect(
      canonicalLandingPageUrl({
        studioUrl: STUDIO,
        slug: 'anniversary-sale',
        pageId: 'lp_1',
        domain: null,
      }),
    ).toBe(STUDIO);
  });

  it('prefers the custom domain once one is verified', () => {
    expect(
      canonicalLandingPageUrl({
        studioUrl: STUDIO,
        slug: 'anniversary-sale',
        pageId: 'lp_1',
        domain: { hostname: 'offers.youngchevrolet.com', homeLandingPageId: null },
      }),
    ).toBe('https://offers.youngchevrolet.com/anniversary-sale');
  });

  it('serves the domain home at the root, not at /<slug>', () => {
    // Middleware rewrites `/` on a custom domain to the __home__ sentinel,
    // so the root IS this page's address. Emitting /<slug> as canonical
    // would point search engines at a second URL for the same content.
    expect(
      canonicalLandingPageUrl({
        studioUrl: STUDIO,
        slug: 'anniversary-sale',
        pageId: 'lp_1',
        domain: { hostname: 'anniversary.youngchevrolet.com', homeLandingPageId: 'lp_1' },
      }),
    ).toBe('https://anniversary.youngchevrolet.com/');
  });

  it('matches the home page by id, not by slug', () => {
    // A sibling LP on the same domain must not inherit the home's root URL.
    expect(
      canonicalLandingPageUrl({
        studioUrl: STUDIO,
        slug: 'anniversary-sale',
        pageId: 'lp_2',
        domain: { hostname: 'offers.youngchevrolet.com', homeLandingPageId: 'lp_1' },
      }),
    ).toBe('https://offers.youngchevrolet.com/anniversary-sale');
  });

  it('always uses https for a custom domain', () => {
    // Verification registers the hostname with Cloudflare for SaaS, which
    // issues the cert — a verified domain is always TLS-capable.
    const url = canonicalLandingPageUrl({
      studioUrl: 'http://localhost:3000/lp/x',
      slug: 'x',
      pageId: 'lp_1',
      domain: { hostname: 'offers.dealer.com', homeLandingPageId: null },
    });
    expect(url.startsWith('https://')).toBe(true);
  });
});

describe('withQuery', () => {
  it('leaves the target alone when there is no query', () => {
    expect(withQuery('https://offers.dealer.com/sale', {})).toBe('https://offers.dealer.com/sale');
  });

  it('carries utm params across the canonical redirect', () => {
    // The whole reason this helper exists: a redirect that drops utm_*
    // turns every redirected visit into "direct" traffic and silently
    // breaks campaign attribution.
    const out = withQuery('https://offers.dealer.com/sale', {
      utm_source: 'facebook',
      utm_medium: 'paid_social',
      utm_campaign: 'anniversary_2026',
    });
    expect(out).toBe(
      'https://offers.dealer.com/sale?utm_source=facebook&utm_medium=paid_social&utm_campaign=anniversary_2026',
    );
  });

  it('preserves every occurrence of a repeated param', () => {
    expect(withQuery('https://offers.dealer.com/sale', { meta_vin: ['a', 'b'] })).toBe(
      'https://offers.dealer.com/sale?meta_vin=a&meta_vin=b',
    );
  });

  it('skips undefined values without emitting a bare key', () => {
    expect(withQuery('https://offers.dealer.com/sale', { utm_source: undefined })).toBe(
      'https://offers.dealer.com/sale',
    );
  });

  it('appends with & when the target already carries a query', () => {
    expect(withQuery('https://offers.dealer.com/sale?ref=email', { utm_source: 'sms' })).toBe(
      'https://offers.dealer.com/sale?ref=email&utm_source=sms',
    );
  });

  it('encodes values that would otherwise break the URL', () => {
    expect(withQuery('https://offers.dealer.com/sale', { note_name: 'Bob & Sue' })).toBe(
      'https://offers.dealer.com/sale?note_name=Bob+%26+Sue',
    );
  });

  it('keeps a domain-home root path valid when appending', () => {
    // The home LP's canonical URL ends in `/` — appending must not
    // produce `//?` or drop the slash.
    expect(withQuery('https://anniversary.dealer.com/', { utm_source: 'radio' })).toBe(
      'https://anniversary.dealer.com/?utm_source=radio',
    );
  });
});
