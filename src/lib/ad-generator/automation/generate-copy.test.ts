import { describe, it, expect } from 'vitest';
import type { TemplateDoc } from '../doc-types';
import type { AdCopyResult, AdCopyVariation } from '../copy-types';
import type { CoopRulePack } from '../coop-rules';
import type { AdData } from '../types';
import { copyForCreative, deterministicCopy, fit, validateCopy } from './generate-copy';

const VEHICLE = { year: 2026, make: 'Chevrolet', model: 'Trax' };

/** A real-shaped lease offer. */
function offerData(over: Partial<AdData> = {}): AdData {
  return {
    offerType: 'lease',
    year: '2026',
    make: 'Chevrolet',
    model: 'Trax',
    monthlyPayment: '299',
    leaseTerm: '24',
    dueAtSigning: '2969',
    msrp: '24995',
    disclaimer: 'Closed-end lease. $2,969 due at signing. With approved credit.',
    ...over,
  };
}

function doc(): TemplateDoc {
  return {
    id: 't1',
    name: 'Momentum — Offer',
    sizes: [{ id: 'square', label: 'Square', width: 1080, height: 1080 }],
    fields: [],
    elements: [],
    layouts: { square: {} },
    defaults: {},
  };
}

/** A variation that says only true things. */
function goodCopy(): AdCopyVariation {
  return {
    fields: {},
    meta: {
      primaryText: '2026 Chevrolet Trax — $299/mo for 24 months. $2,969 due at signing.',
      headline: '$299/mo — Trax',
      description: 'Per month lease',
    },
    google: {
      headlines: ['$299/mo Chevy Trax', '2026 Trax', 'Young Chevrolet'],
      descriptions: ['24-month lease with $2,969 due at signing.', 'See this offer today.'],
    },
  };
}

describe('fit', () => {
  it('leaves short text alone and collapses whitespace', () => {
    expect(fit('  a  b  ', 40)).toBe('a b');
  });

  it('cuts on a word boundary rather than mid-word', () => {
    expect(fit('two hundred ninety nine dollars', 20)).toBe('two hundred ninety');
  });

  it('never exceeds the limit', () => {
    const long = 'supercalifragilisticexpialidocious'.repeat(3);
    expect(fit(long, 20).length).toBeLessThanOrEqual(20);
  });
});

describe('deterministicCopy', () => {
  it('builds captions from the offer, inside every platform limit', () => {
    const c = deterministicCopy({ data: offerData(), dealerName: 'Young Chevrolet', vehicle: VEHICLE });
    expect(validateCopy({ variation: c, data: offerData(), doc: doc() })).toEqual([]);
    expect(c.meta.primaryText).toContain('$299/mo');
    expect(c.google.headlines.length).toBeGreaterThanOrEqual(3);
    expect(c.google.descriptions.length).toBeGreaterThanOrEqual(2);
  });

  it('never writes the template copy fields', () => {
    // The creative was already rendered from deterministic values; rewriting the
    // on-image fields afterwards would make the stored image and data disagree.
    const c = deterministicCopy({ data: offerData(), dealerName: 'Young', vehicle: VEHICLE });
    expect(c.fields).toEqual({});
  });

  it('still produces usable copy with no dealer name', () => {
    const c = deterministicCopy({ data: offerData(), dealerName: '', vehicle: VEHICLE });
    expect(validateCopy({ variation: c, data: offerData(), doc: doc() })).toEqual([]);
  });

  it('holds together for an APR offer, not just a lease', () => {
    const data = offerData({ offerType: 'apr', aprRate: '4.9', aprTerm: '60', monthlyPayment: '' });
    const c = deterministicCopy({ data, dealerName: 'Young Chevrolet', vehicle: VEHICLE });
    expect(c.meta.primaryText).toContain('4.9% APR');
    expect(validateCopy({ variation: c, data, doc: doc() })).toEqual([]);
  });
});

describe('validateCopy — numeric provenance', () => {
  it('accepts numbers the offer actually contains', () => {
    expect(validateCopy({ variation: goodCopy(), data: offerData(), doc: doc() })).toEqual([]);
  });

  it('rejects an invented payment — the failure that matters most', () => {
    const v = goodCopy();
    v.meta.headline = '$199/mo — Trax';
    const problems = validateCopy({ variation: v, data: offerData(), doc: doc() });
    expect(problems).toHaveLength(1);
    expect(problems[0].where).toBe('meta.headline');
    expect(problems[0].reason).toContain('199');
  });

  it('rejects an invented term', () => {
    const v = goodCopy();
    v.google.descriptions[0] = '36-month lease with $2,969 due at signing.';
    const problems = validateCopy({ variation: v, data: offerData(), doc: doc() });
    expect(problems.some((p) => p.reason.includes('36'))).toBe(true);
  });

  it('accepts a comma-formatted citation of an unformatted value', () => {
    // The offer holds "2969"; the copy writes "$2,969". Same claim.
    const v = goodCopy();
    v.meta.primaryText = 'Just $2,969 due at signing on the 2026 Trax.';
    expect(validateCopy({ variation: v, data: offerData(), doc: doc() })).toEqual([]);
  });

  it('ignores single digits, which carry no pricing claim', () => {
    const v = goodCopy();
    v.meta.description = 'Pick 1 of 3 trims';
    expect(validateCopy({ variation: v, data: offerData(), doc: doc() })).toEqual([]);
  });

  it('checks the template copy fields too, not just the captions', () => {
    const v = goodCopy();
    v.fields = { tagline: 'Only $149 a month!' };
    const problems = validateCopy({ variation: v, data: offerData(), doc: doc() });
    expect(problems.some((p) => p.where === 'fields.tagline')).toBe(true);
  });
});

describe('validateCopy — platform limits', () => {
  it('rejects an over-long Meta headline', () => {
    const v = goodCopy();
    v.meta.headline = 'x'.repeat(41);
    const problems = validateCopy({ variation: v, data: offerData(), doc: doc() });
    expect(problems.some((p) => p.where === 'meta.headline' && p.reason.includes('41'))).toBe(true);
  });

  it('rejects too few Google assets — Google refuses the ad otherwise', () => {
    const v = goodCopy();
    v.google.headlines = ['$299/mo'];
    v.google.descriptions = [];
    const problems = validateCopy({ variation: v, data: offerData(), doc: doc() });
    expect(problems.some((p) => p.where === 'google.headlines')).toBe(true);
    expect(problems.some((p) => p.where === 'google.descriptions')).toBe(true);
  });

  it('rejects empty required Meta text', () => {
    const v = goodCopy();
    v.meta.primaryText = '';
    const problems = validateCopy({ variation: v, data: offerData(), doc: doc() });
    expect(problems.some((p) => p.where === 'meta')).toBe(true);
  });
});

describe('validateCopy — co-op content rules', () => {
  const bannedAbsolutes: CoopRulePack = {
    make: 'Chevrolet',
    version: '2026-Q3',
    verified: true,
    rules: [
      {
        id: 'no-absolutes',
        kind: 'banned_phrase',
        severity: 'error',
        pattern: '\\b(lowest|best|cheapest|guaranteed)\\b',
        description: 'Absolute or unqualified claims are not permitted.',
        citation: '§4.2',
      },
    ],
  } as CoopRulePack;

  it('catches a banned absolute claim in AI copy', () => {
    const v = goodCopy();
    v.meta.primaryText = 'The lowest lease payment in town on the 2026 Trax.';
    const problems = validateCopy({ variation: v, data: offerData(), doc: doc(), coopPack: bannedAbsolutes });
    expect(problems.some((p) => p.where === 'meta.primaryText' && p.reason.includes('§4.2'))).toBe(true);
  });

  it("does not fail the copy for a problem in the ad's own data", () => {
    // The disclaimer is preflight's business. Failing copy for it would silently
    // disable AI copy for the whole account.
    const data = offerData({ disclaimer: 'Guaranteed approval for everyone.' });
    const problems = validateCopy({ variation: goodCopy(), data, doc: doc(), coopPack: bannedAbsolutes });
    expect(problems).toEqual([]);
  });

  it('passes clean copy against a real pack', () => {
    expect(
      validateCopy({ variation: goodCopy(), data: offerData(), doc: doc(), coopPack: bannedAbsolutes }),
    ).toEqual([]);
  });
});

describe('copyForCreative', () => {
  const base = { doc: doc(), data: offerData(), dealerName: 'Young Chevrolet', vehicle: VEHICLE };

  it('uses the deterministic caption when no drafter is available', async () => {
    const out = await copyForCreative(base);
    expect(out.source).toBe('deterministic');
    expect(out.warnings).toEqual([]);
    expect(out.copy.meta.primaryText).toContain('$299/mo');
  });

  it('takes a valid AI draft', async () => {
    const out = await copyForCreative({
      ...base,
      draft: async (): Promise<AdCopyResult> => ({ variations: [goodCopy()] }),
    });
    expect(out.source).toBe('ai');
    expect(out.copy.meta.headline).toBe('$299/mo — Trax');
  });

  it('skips a bad draft and takes the next clean one', async () => {
    const bad = goodCopy();
    bad.meta.headline = '$99/mo — Trax';
    const out = await copyForCreative({
      ...base,
      draft: async (): Promise<AdCopyResult> => ({ variations: [bad, goodCopy()] }),
    });
    expect(out.source).toBe('ai');
    expect(out.copy.meta.headline).toBe('$299/mo — Trax');
  });

  it('falls back and explains itself when every draft invents a number', async () => {
    const bad = goodCopy();
    bad.meta.primaryText = 'Lease the 2026 Trax for just $189/mo.';
    const out = await copyForCreative({
      ...base,
      draft: async (): Promise<AdCopyResult> => ({ variations: [bad, bad] }),
    });
    expect(out.source).toBe('deterministic');
    expect(out.warnings[0]).toContain('189');
    // The ad still has usable words — copy is a launch prerequisite.
    expect(validateCopy({ variation: out.copy, data: offerData(), doc: doc() })).toEqual([]);
  });

  it('survives a model outage without losing the ad', async () => {
    const out = await copyForCreative({
      ...base,
      draft: async () => {
        throw new Error('529 overloaded');
      },
    });
    expect(out.source).toBe('deterministic');
    expect(out.warnings[0]).toContain('529 overloaded');
    expect(out.copy.meta.primaryText).toBeTruthy();
  });

  it('never lets an AI draft rewrite the on-image fields', async () => {
    const withFields = goodCopy();
    withFields.fields = { tagline: '$299 a month' };
    const out = await copyForCreative({
      ...base,
      draft: async (): Promise<AdCopyResult> => ({ variations: [withFields] }),
    });
    expect(out.source).toBe('ai');
    expect(out.copy.fields).toEqual({});
  });
});
