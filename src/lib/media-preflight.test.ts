import { describe, it, expect } from 'vitest';
import { countBySeverity, parsePreflight, runPreflight, type PreflightInput } from './media-preflight';

const NOW = new Date('2026-08-11T12:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

/** A fully-described Oz-created image — nothing to complain about. */
const clean: PreflightInput = {
  mimeType: 'image/jpeg',
  altText: 'Civic parked at sunset',
  assetCategory: 'photography',
  assetSource: 'oz-created',
  accountKey: 'youngHondaOgden',
};

const codes = (a: PreflightInput) => runPreflight(a, NOW).findings.map((f) => f.code).sort();

describe('runPreflight', () => {
  it('passes a fully-described asset with nothing to say', () => {
    const result = runPreflight(clean, NOW);
    expect(result.findings).toEqual([]);
    expect(result.canApprove).toBe(true);
  });

  it('blocks an asset whose licence has lapsed', () => {
    const result = runPreflight({ ...clean, licenseExpiresAt: inDays(-5) }, NOW);
    expect(result.canApprove).toBe(false);
    expect(result.findings[0]).toMatchObject({
      severity: 'block',
      code: 'rights_expired',
      field: 'licenseExpiresAt',
    });
  });

  it('names the campaign date when that is what governed', () => {
    // Licence fine, offer over — the message has to say which, or the reviewer
    // goes looking in the wrong field.
    const result = runPreflight(
      { ...clean, licenseExpiresAt: inDays(300), expiresAt: inDays(-1) },
      NOW,
    );
    expect(result.findings[0]).toMatchObject({ code: 'rights_expired', field: 'expiresAt' });
    expect(result.findings[0].message).toContain('campaign');
  });

  it('warns rather than blocks when a licence is merely close', () => {
    // Refusing here would make the last month of every licence unusable.
    const result = runPreflight({ ...clean, licenseExpiresAt: inDays(10) }, NOW);
    expect(result.canApprove).toBe(true);
    expect(result.findings[0]).toMatchObject({ severity: 'warn', code: 'rights_expiring' });
    expect(result.findings[0].message).toContain('10 days');
  });

  it('blocks when derivatives exist against a licence that forbids them', () => {
    // The renditions ARE the breach — approving the master would bless it.
    const result = runPreflight(
      { ...clean, derivativesPermitted: false, renditionCount: 3 },
      NOW,
    );
    expect(result.canApprove).toBe(false);
    expect(result.findings.find((f) => f.code === 'derivatives_forbidden')).toBeTruthy();
  });

  it('does not block a forbidding licence with no derivatives yet', () => {
    const result = runPreflight({ ...clean, derivativesPermitted: false, renditionCount: 0 }, NOW);
    expect(result.canApprove).toBe(true);
  });

  it('blocks an OEM-supplied shared asset with no brand — nobody could see it', () => {
    const result = runPreflight(
      { mimeType: 'image/jpeg', altText: 'x', assetCategory: 'photography', assetSource: 'oem-supplied', accountKey: null, rightsHolder: 'Honda' },
      NOW,
    );
    expect(result.canApprove).toBe(false);
    expect(result.findings.find((f) => f.code === 'oem_scope_missing')).toBeTruthy();
  });

  it('does not raise the scope finding for an account-owned asset', () => {
    expect(codes({ ...clean, assetSource: 'oem-supplied', rightsHolder: 'Honda', oem: null }))
      .not.toContain('oem_scope_missing');
  });

  it('asks third-party material for a rights holder and licence, but not Oz-created', () => {
    expect(codes({ ...clean, assetSource: 'stock' })).toEqual(
      ['rights_holder_missing', 'rights_unrecorded', 'usage_scope_missing'].sort(),
    );
    // Oz owns its own work; naming a third party would be noise.
    expect(codes({ ...clean, assetSource: 'oz-created' })).toEqual([]);
  });

  it('warns on missing classification', () => {
    expect(codes({ ...clean, assetCategory: null })).toContain('category_missing');
    expect(codes({ ...clean, assetSource: null })).toContain('source_missing');
  });

  it('warns on a missing alt text for images only', () => {
    expect(codes({ ...clean, altText: null })).toContain('alt_text_missing');
    expect(codes({ ...clean, mimeType: 'application/zip', altText: null }))
      .not.toContain('alt_text_missing');
  });

  it('lets warnings through — they record a gap, they do not gate', () => {
    const result = runPreflight(
      { mimeType: 'image/jpeg', assetSource: 'stock', accountKey: 'a' },
      NOW,
    );
    expect(result.findings.length).toBeGreaterThan(2);
    expect(result.canApprove).toBe(true);
  });

  it('cites a field on every finding', () => {
    // The citation is what makes the gate auditable rather than an opinion.
    const result = runPreflight(
      { mimeType: 'image/jpeg', assetSource: 'stock', accountKey: 'a', licenseExpiresAt: inDays(-1) },
      NOW,
    );
    expect(result.findings.every((f) => f.field.length > 0)).toBe(true);
  });
});

describe('parsePreflight', () => {
  it('round-trips', () => {
    const result = runPreflight({ ...clean, altText: null }, NOW);
    expect(parsePreflight(JSON.stringify(result))).toEqual(result);
  });

  it('degrades to null on junk rather than throwing', () => {
    expect(parsePreflight('not json')).toBeNull();
    expect(parsePreflight('{"nope":1}')).toBeNull();
    expect(parsePreflight(null)).toBeNull();
  });
});

describe('countBySeverity', () => {
  it('splits blocks from warnings', () => {
    const result = runPreflight(
      { mimeType: 'image/jpeg', assetSource: 'stock', accountKey: 'a', licenseExpiresAt: inDays(-1) },
      NOW,
    );
    const { blocks, warns } = countBySeverity(result);
    expect(blocks).toBe(1);
    expect(warns).toBeGreaterThan(0);
  });
});
