import { describe, it, expect } from 'vitest';
import type { MediaAsset } from '@prisma/client';
import { RIGHTS_EXPORT_HEADERS, rightsExportCsv, rightsExportFilename } from './media-rights-export';

const NOW = new Date('2026-08-13T12:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 864e5);

/** Only the fields the export reads; the rest of MediaAsset is irrelevant here. */
const asset = (over: Partial<MediaAsset>): MediaAsset =>
  ({
    id: 'a', filename: 'hero.jpg', accountKey: null, oem: null,
    assetCategory: null, assetSource: null, rightsHolder: null,
    licenseType: null, licenseRef: null, licenseStartsAt: null, licenseExpiresAt: null,
    expiresAt: null, usageScope: null, territoryScope: null,
    derivativesPermitted: null, sublicensingPermitted: null,
    status: 'draft', expiredAt: null, expirationReason: null,
    ...over,
  }) as MediaAsset;

const rows = (csv: string) => csv.split('\r\n');
const cells = (line: string) => line.split(',');

describe('rightsExportCsv', () => {
  it('leads with a header row in the documented order', () => {
    const csv = rightsExportCsv([], NOW);
    expect(rows(csv)[0]).toBe(RIGHTS_EXPORT_HEADERS.join(','));
  });

  it('uses CRLF, which is what Excel expects', () => {
    const csv = rightsExportCsv([asset({}), asset({ filename: 'b.jpg' })], NOW);
    expect(csv).toContain('\r\n');
    expect(rows(csv)).toHaveLength(3);
  });

  it('names the scope in words rather than leaking a null', () => {
    expect(rightsExportCsv([asset({})], NOW)).toContain('Loomi library (all accounts)');
    expect(rightsExportCsv([asset({ oem: 'Audi' })], NOW)).toContain('Shared — Audi');
    expect(rightsExportCsv([asset({ accountKey: 'youngHondaOgden' })], NOW))
      .toContain('youngHondaOgden');
  });

  it('distinguishes "not recorded" from "no" on the permission flags', () => {
    // The distinction a spreadsheet blank would destroy: an unrecorded
    // derivatives clause is a gap to chase, a false one is a rule to honour.
    expect(rightsExportCsv([asset({ derivativesPermitted: null })], NOW)).toContain('Not recorded');
    expect(rightsExportCsv([asset({ derivativesPermitted: false })], NOW)).toContain('No');
    expect(rightsExportCsv([asset({ derivativesPermitted: true })], NOW)).toContain('Yes');
  });

  it('writes dates as plain days, not timestamps', () => {
    const csv = rightsExportCsv([asset({ licenseExpiresAt: new Date('2027-08-31T00:00:00Z') })], NOW);
    expect(csv).toContain('2027-08-31');
    expect(csv).not.toContain('T00:00:00');
  });

  it('reports a lapsed licence with a negative days-remaining', () => {
    const csv = rightsExportCsv([asset({ licenseExpiresAt: inDays(-9) })], NOW);
    const line = rows(csv)[1];
    expect(line).toContain('Expired');
    expect(cells(line).at(-1)).toBe('-9');
  });

  it('escapes a comma in a filename instead of splitting the row', () => {
    const csv = rightsExportCsv([asset({ filename: 'hero, final.jpg' })], NOW);
    const line = rows(csv)[1];
    expect(line.startsWith('"hero, final.jpg"')).toBe(true);
    // Still one row per asset — the comma didn't shift every later column.
    expect(rows(csv)).toHaveLength(2);
  });

  it('escapes embedded quotes by doubling them', () => {
    const csv = rightsExportCsv([asset({ rightsHolder: 'Bob "The Dealer" Jones' })], NOW);
    expect(csv).toContain('"Bob ""The Dealer"" Jones"');
  });

  it('joins multi-value scopes with semicolons, so commas stay the delimiter', () => {
    const csv = rightsExportCsv([asset({ usageScope: '["digital","email"]' })], NOW);
    expect(csv).toContain('digital; email');
  });

  it('leaves unrecorded fields empty rather than writing null', () => {
    const csv = rightsExportCsv([asset({})], NOW);
    expect(csv).not.toContain('null');
    expect(csv).not.toContain('undefined');
  });
});

describe('rightsExportFilename', () => {
  it('is dated, so two exports do not overwrite each other', () => {
    expect(rightsExportFilename(NOW)).toBe('loomi-rights-2026-08-13.csv');
  });
});
