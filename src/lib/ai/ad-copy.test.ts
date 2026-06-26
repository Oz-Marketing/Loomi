import { describe, it, expect } from 'vitest';
import { normalizeCopyResult } from './ad-copy';
import type { AdCopyRequest } from '@/lib/ad-generator/copy-types';

const req: AdCopyRequest = {
  templateName: 'Vehicle Offer',
  copyFields: [
    { key: 'tagline', label: 'Tagline', maxLength: 10 },
    { key: 'offerLabel', label: 'Offer label', maxLength: 5 },
  ],
  context: {},
  dealerName: 'Test Motors',
  count: 2,
};

describe('normalizeCopyResult', () => {
  it('keeps only declared copy fields and clamps them to maxLength', () => {
    const r = normalizeCopyResult(
      {
        variations: [
          {
            fields: { tagline: 'This is way too long', offerLabel: 'LEASE FOR', stray: 'nope' },
            meta: {},
            google: {},
          },
        ],
      },
      req,
    );
    expect(Object.keys(r.variations[0].fields).sort()).toEqual(['offerLabel', 'tagline']);
    expect(r.variations[0].fields.tagline).toBe('This is wa'); // 10 chars
    expect(r.variations[0].fields.offerLabel).toBe('LEASE'); // 5 chars
    expect(r.variations[0].fields).not.toHaveProperty('stray');
  });

  it('defensively coerces missing / non-string values to empty strings', () => {
    const r = normalizeCopyResult({ variations: [{ fields: { tagline: 42 } }] }, req);
    expect(r.variations[0].fields.tagline).toBe('42');
    expect(r.variations[0].fields.offerLabel).toBe('');
    expect(r.variations[0].meta.primaryText).toBe('');
  });

  it('clamps Meta captions and limits/clamps Google RSA assets', () => {
    const r = normalizeCopyResult(
      {
        variations: [
          {
            fields: {},
            meta: {
              primaryText: 'p'.repeat(200),
              headline: 'h'.repeat(60),
              description: 'd'.repeat(60),
            },
            google: {
              headlines: ['a'.repeat(40), 'b', 'c', 'd', 'e'],
              descriptions: ['x'.repeat(120), 'y', 'z'],
            },
          },
        ],
      },
      req,
    );
    const v = r.variations[0];
    expect(v.meta.primaryText.length).toBe(125);
    expect(v.meta.headline.length).toBe(40);
    expect(v.meta.description.length).toBe(30);
    expect(v.google.headlines).toHaveLength(3); // capped at headlineCount
    expect(v.google.headlines[0].length).toBe(30); // each clamped
    expect(v.google.descriptions).toHaveLength(2); // capped at descriptionCount
  });

  it('drops empty Google assets', () => {
    const r = normalizeCopyResult(
      { variations: [{ fields: {}, meta: {}, google: { headlines: ['', '  ', 'Real'], descriptions: [] } }] },
      req,
    );
    expect(r.variations[0].google.headlines).toEqual(['Real']);
    expect(r.variations[0].google.descriptions).toEqual([]);
  });

  it('returns at most `count` variations', () => {
    const r = normalizeCopyResult(
      { variations: [{ fields: {} }, { fields: {} }, { fields: {} }, { fields: {} }] },
      req,
    );
    expect(r.variations).toHaveLength(2);
  });

  it('tolerates garbage input', () => {
    expect(normalizeCopyResult(null, req).variations).toEqual([]);
    expect(normalizeCopyResult({}, req).variations).toEqual([]);
    expect(normalizeCopyResult({ variations: 'nope' }, req).variations).toEqual([]);
  });
});
