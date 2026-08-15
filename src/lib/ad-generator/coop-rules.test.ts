import { describe, it, expect } from 'vitest';
import {
  coopPassed,
  evaluateCoopRules,
  parseCoopPack,
  splitCoopPack,
  EXAMPLE_PACK,
  type CoopRule,
  type CoopRulePack,
} from './coop-rules';
import type { DocElement, TemplateDoc } from './doc-types';
import type { AdData } from './types';

const SQUARE = { id: 'square', label: 'Square', width: 1080, height: 1080 };
const TOWER = { id: 'tower', label: 'Tower', width: 300, height: 600 };

function textEl(id: string, key: string, over: Partial<DocElement> = {}): DocElement {
  return { id, type: 'text', binding: { kind: 'field', key }, ...over };
}

/** Doc with the given elements placed in every size at a default box. */
function doc(
  elements: DocElement[],
  over: { sizes?: typeof SQUARE[]; boxes?: Record<string, Record<string, Partial<{ x: number; y: number; w: number; h: number; fontSize: number; hidden: boolean }>>> } = {},
): TemplateDoc {
  const sizes = over.sizes ?? [SQUARE];
  const layouts: TemplateDoc['layouts'] = {};
  for (const s of sizes) {
    layouts[s.id] = {};
    for (const el of elements) {
      layouts[s.id][el.id] = {
        x: 0.1,
        y: 0.1,
        w: 0.5,
        h: 0.1,
        fontSize: 24,
        ...(over.boxes?.[s.id]?.[el.id] ?? {}),
      };
    }
  }
  return { id: 'tpl', name: 'T', sizes, fields: [], elements, layouts, defaults: {} };
}

function pack(rules: CoopRule[], over: Partial<CoopRulePack> = {}): CoopRulePack {
  return { make: 'Testco', version: 'v1', verified: true, rules, ...over };
}

const LEASE: AdData = {
  offerType: 'lease',
  monthlyPayment: '299',
  leaseTerm: '36',
  disclaimer: 'Closed-end lease with approved credit. See dealer for details.',
};

describe('required_phrase', () => {
  const rule: CoopRule = {
    id: 'credit',
    kind: 'required_phrase',
    field: 'disclaimer',
    pattern: 'approved credit|well-qualified',
    severity: 'error',
    description: 'Must state a credit qualification.',
    citation: 'Doc §1',
  };

  it('passes when the phrase is present', () => {
    expect(evaluateCoopRules({ doc: doc([textEl('e', 'disclaimer')]), data: LEASE, pack: pack([rule]) })).toEqual([]);
  });

  it('flags when absent, and reports what it saw', () => {
    const f = evaluateCoopRules({
      doc: doc([textEl('e', 'disclaimer')]),
      data: { ...LEASE, disclaimer: 'See dealer.' },
      pack: pack([rule]),
    });
    expect(f).toHaveLength(1);
    expect(f[0].ruleId).toBe('credit');
    expect(f[0].citation).toBe('Doc §1');
    expect(f[0].observed).toContain('See dealer.');
  });

  it('reports an empty field distinctly', () => {
    const f = evaluateCoopRules({
      doc: doc([textEl('e', 'disclaimer')]),
      data: { ...LEASE, disclaimer: '' },
      pack: pack([rule]),
    });
    expect(f[0].observed).toContain('is empty');
  });

  it('matches literal phrases case-insensitively', () => {
    const literal: CoopRule = { ...rule, pattern: undefined, phrase: 'Approved Credit' };
    expect(
      evaluateCoopRules({ doc: doc([textEl('e', 'disclaimer')]), data: LEASE, pack: pack([literal]) }),
    ).toEqual([]);
  });

  it('flags a malformed rule rather than silently passing', () => {
    const broken: CoopRule = { ...rule, pattern: '([unclosed' };
    const f = evaluateCoopRules({ doc: doc([textEl('e', 'disclaimer')]), data: LEASE, pack: pack([broken]) });
    expect(f).toHaveLength(1);
    expect(f[0].observed).toContain('malformed');
  });

  it('honours offer-type scope', () => {
    const aprOnly: CoopRule = { ...rule, scope: { offerTypes: ['apr'] } };
    const f = evaluateCoopRules({
      doc: doc([textEl('e', 'disclaimer')]),
      data: { ...LEASE, disclaimer: 'See dealer.' },
      pack: pack([aprOnly]),
    });
    expect(f).toEqual([]); // lease ad, apr-only rule
  });
});

describe('banned_phrase', () => {
  const rule: CoopRule = {
    id: 'no-free',
    kind: 'banned_phrase',
    pattern: '\\bfree\\b|\\bguaranteed\\b',
    severity: 'error',
    description: 'No absolute claims.',
  };

  it('flags a banned word in any field by default', () => {
    const f = evaluateCoopRules({
      doc: doc([textEl('e', 'tagline')]),
      data: { ...LEASE, tagline: 'Guaranteed approval!' },
      pack: pack([rule]),
    });
    expect(f).toHaveLength(1);
    expect(f[0].field).toBe('tagline');
  });

  it('passes clean copy', () => {
    expect(
      evaluateCoopRules({ doc: doc([textEl('e', 'tagline')]), data: { ...LEASE, tagline: 'Drive home today' }, pack: pack([rule]) }),
    ).toEqual([]);
  });

  it('respects word boundaries — "freeway" is not "free"', () => {
    const f = evaluateCoopRules({
      doc: doc([textEl('e', 'tagline')]),
      data: { ...LEASE, tagline: 'Built for the freeway' },
      pack: pack([rule]),
    });
    expect(f).toEqual([]);
  });

  it('ignores internal underscore-prefixed bookkeeping keys', () => {
    // `_oemDisclaimerText` etc. never reach the canvas, so scanning them would
    // produce findings a designer cannot act on.
    const f = evaluateCoopRules({
      doc: doc([textEl('e', 'tagline')]),
      data: { ...LEASE, _oemDisclaimerText: 'free maintenance included' },
      pack: pack([rule]),
    });
    expect(f).toEqual([]);
  });

  it('can be narrowed to specific fields', () => {
    const scoped: CoopRule = { ...rule, fields: ['tagline'] };
    const f = evaluateCoopRules({
      doc: doc([textEl('e', 'tagline')]),
      data: { ...LEASE, tagline: 'clean', disclaimer: 'free oil changes' },
      pack: pack([scoped]),
    });
    expect(f).toEqual([]);
  });
});

describe('required_element', () => {
  const rule: CoopRule = {
    id: 'need-disclaimer',
    kind: 'required_element',
    field: 'disclaimer',
    severity: 'error',
    description: 'Disclaimer must be displayed.',
  };

  it('passes when a bound element is placed', () => {
    expect(evaluateCoopRules({ doc: doc([textEl('e', 'disclaimer')]), data: LEASE, pack: pack([rule]) })).toEqual([]);
  });

  it('flags a template with no such element', () => {
    const f = evaluateCoopRules({ doc: doc([textEl('e', 'tagline')]), data: LEASE, pack: pack([rule]) });
    expect(f[0].observed).toContain('no element bound');
  });

  it('accepts a BRAND binding, not just a field binding', () => {
    // logoUrl / dealerName / brandColor are normally wired as `brand` bindings.
    // Matching only `kind: 'field'` made every brandmark rule fire falsely on
    // templates that had a perfectly good logo element.
    const logoRule: CoopRule = {
      id: 'need-logo',
      kind: 'required_element',
      field: 'logoUrl',
      severity: 'error',
      description: 'Logo required.',
    };
    const d = doc([{ id: 'logo', type: 'logo', binding: { kind: 'brand', key: 'logoUrl' } }]);
    expect(evaluateCoopRules({ doc: d, data: LEASE, pack: pack([logoRule]) })).toEqual([]);
  });

  it('flags an element hidden in every rendered size', () => {
    const d = doc([textEl('e', 'disclaimer')], { boxes: { square: { e: { hidden: true } } } });
    const f = evaluateCoopRules({ doc: d, data: LEASE, pack: pack([rule]) });
    expect(f[0].observed).toContain('not placed in any rendered size');
  });

  it('treats a visibleWhen-excluded element as absent', () => {
    const d = doc([textEl('e', 'disclaimer', { visibleWhen: { field: 'offerType', in: ['apr'] } })]);
    const f = evaluateCoopRules({ doc: d, data: LEASE, pack: pack([rule]) });
    expect(f).toHaveLength(1);
  });
});

describe('min_font_size', () => {
  it('flags text below an absolute px floor', () => {
    const d = doc([textEl('e', 'disclaimer')], { boxes: { square: { e: { fontSize: 9 } } } });
    const rule: CoopRule = {
      id: 'legible',
      kind: 'min_font_size',
      field: 'disclaimer',
      minPx: 14,
      severity: 'error',
      description: 'Disclaimer legibility.',
    };
    const f = evaluateCoopRules({ doc: d, data: LEASE, pack: pack([rule]) });
    expect(f).toHaveLength(1);
    expect(f[0].observed).toContain('9px declared');
    expect(f[0].observed).toContain('minimum 14px');
  });

  it('scales a fractional floor to each canvas independently', () => {
    // 1.2% of 1080 = 13px; of 300 = 3.6px. A 10px disclaimer passes the tower
    // and fails the square — which is exactly why the fractional form exists.
    const d = doc([textEl('e', 'disclaimer')], {
      sizes: [SQUARE, TOWER],
      boxes: { square: { e: { fontSize: 10 } }, tower: { e: { fontSize: 10 } } },
    });
    const rule: CoopRule = {
      id: 'legible',
      kind: 'min_font_size',
      field: 'disclaimer',
      minShortEdgeFraction: 0.012,
      severity: 'error',
      description: 'Relative legibility.',
    };
    const f = evaluateCoopRules({ doc: d, data: LEASE, pack: pack([rule]) });
    expect(f).toHaveLength(1);
    expect(f[0].sizes).toEqual(['square']);
  });

  it('takes the stricter of px and fractional floors', () => {
    const d = doc([textEl('e', 'disclaimer')], { boxes: { square: { e: { fontSize: 20 } } } });
    const rule: CoopRule = {
      id: 'legible',
      kind: 'min_font_size',
      field: 'disclaimer',
      minPx: 10,
      minShortEdgeFraction: 0.03, // 32px on a 1080 canvas — the binding constraint
      severity: 'error',
      description: 'Legibility.',
    };
    expect(evaluateCoopRules({ doc: d, data: LEASE, pack: pack([rule]) })).toHaveLength(1);
  });

  it('passes compliant text', () => {
    const d = doc([textEl('e', 'disclaimer')], { boxes: { square: { e: { fontSize: 18 } } } });
    const rule: CoopRule = {
      id: 'legible',
      kind: 'min_font_size',
      field: 'disclaimer',
      minPx: 14,
      severity: 'error',
      description: 'Legibility.',
    };
    expect(evaluateCoopRules({ doc: d, data: LEASE, pack: pack([rule]) })).toEqual([]);
  });

  it('says nothing when the element does not exist (required_element owns that)', () => {
    const rule: CoopRule = {
      id: 'legible',
      kind: 'min_font_size',
      field: 'disclaimer',
      minPx: 14,
      severity: 'error',
      description: 'Legibility.',
    };
    expect(evaluateCoopRules({ doc: doc([textEl('e', 'tagline')]), data: LEASE, pack: pack([rule]) })).toEqual([]);
  });
});

describe('element_zone', () => {
  const lowerThird: CoopRule = {
    id: 'logo-zone',
    kind: 'element_zone',
    field: 'logoUrl',
    zone: { x0: 0, y0: 0.66, x1: 1, y1: 1 },
    severity: 'error',
    description: 'Logo must sit in the lower third.',
  };

  it('flags an element outside the zone', () => {
    const d = doc([textEl('logo', 'logoUrl')], { boxes: { square: { logo: { x: 0.05, y: 0.05, w: 0.2, h: 0.1 } } } });
    const f = evaluateCoopRules({ doc: d, data: LEASE, pack: pack([lowerThird]) });
    expect(f).toHaveLength(1);
    expect(f[0].observed).toContain('required within');
  });

  it('passes an element inside the zone', () => {
    const d = doc([textEl('logo', 'logoUrl')], { boxes: { square: { logo: { x: 0.1, y: 0.8, w: 0.2, h: 0.1 } } } });
    expect(evaluateCoopRules({ doc: d, data: LEASE, pack: pack([lowerThird]) })).toEqual([]);
  });

  it('flags an element that starts inside but overflows the zone', () => {
    const d = doc([textEl('logo', 'logoUrl')], { boxes: { square: { logo: { x: 0.9, y: 0.7, w: 0.3, h: 0.1 } } } });
    expect(evaluateCoopRules({ doc: d, data: LEASE, pack: pack([lowerThird]) })).toHaveLength(1);
  });

  it('reports each offending size separately', () => {
    const d = doc([textEl('logo', 'logoUrl')], {
      sizes: [SQUARE, TOWER],
      boxes: { square: { logo: { x: 0.1, y: 0.8, w: 0.2, h: 0.1 } }, tower: { logo: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } } },
    });
    const f = evaluateCoopRules({ doc: d, data: LEASE, pack: pack([lowerThird]) });
    expect(f).toHaveLength(1);
    expect(f[0].sizes).toEqual(['tower']);
  });
});

describe('min_element_size', () => {
  it('flags a logo that is too small', () => {
    const d = doc([textEl('logo', 'logoUrl')], { boxes: { square: { logo: { w: 0.05, h: 0.02 } } } });
    const rule: CoopRule = {
      id: 'logo-size',
      kind: 'min_element_size',
      field: 'logoUrl',
      minWidthFraction: 0.15,
      severity: 'error',
      description: 'Logo must be at least 15% of the width.',
    };
    const f = evaluateCoopRules({ doc: d, data: LEASE, pack: pack([rule]) });
    expect(f[0].observed).toContain('width 5% < 15%');
  });

  it('checks height independently', () => {
    const d = doc([textEl('logo', 'logoUrl')], { boxes: { square: { logo: { w: 0.5, h: 0.02 } } } });
    const rule: CoopRule = {
      id: 'logo-size',
      kind: 'min_element_size',
      field: 'logoUrl',
      minHeightFraction: 0.08,
      severity: 'error',
      description: 'Logo height.',
    };
    expect(evaluateCoopRules({ doc: d, data: LEASE, pack: pack([rule]) })).toHaveLength(1);
  });
});

describe('unverified packs', () => {
  it('downgrades errors to warnings so a half-transcribed pack cannot block a brand', () => {
    const rule: CoopRule = {
      id: 'credit',
      kind: 'required_phrase',
      field: 'disclaimer',
      phrase: 'approved credit',
      severity: 'error',
      description: 'Credit language.',
    };
    const f = evaluateCoopRules({
      doc: doc([textEl('e', 'disclaimer')]),
      data: { ...LEASE, disclaimer: 'See dealer.' },
      pack: pack([rule], { verified: false }),
    });
    expect(f[0].severity).toBe('warning');
    expect(coopPassed(f)).toBe(true);
  });

  it('keeps errors blocking for a verified pack', () => {
    const rule: CoopRule = {
      id: 'credit',
      kind: 'required_phrase',
      field: 'disclaimer',
      phrase: 'approved credit',
      severity: 'error',
      description: 'Credit language.',
    };
    const f = evaluateCoopRules({
      doc: doc([textEl('e', 'disclaimer')]),
      data: { ...LEASE, disclaimer: 'See dealer.' },
      pack: pack([rule], { verified: true }),
    });
    expect(coopPassed(f)).toBe(false);
  });
});

describe('parseCoopPack', () => {
  it('round-trips a valid pack', () => {
    const p = parseCoopPack(JSON.stringify(EXAMPLE_PACK));
    expect(p?.make).toBe('__example__');
    expect(p?.rules.length).toBe(EXAMPLE_PACK.rules.length);
  });

  it('returns null for unusable input rather than throwing', () => {
    expect(parseCoopPack('not json')).toBeNull();
    expect(parseCoopPack('{}')).toBeNull();
    expect(parseCoopPack('{"make":"X"}')).toBeNull();
  });

  it('drops malformed rules but keeps the pack', () => {
    const p = parseCoopPack(
      JSON.stringify({ make: 'X', version: 'v1', rules: [{ id: 'a', kind: 'required_element', description: 'd', field: 'disclaimer', severity: 'error' }, { nope: true }] }),
    );
    expect(p?.rules).toHaveLength(1);
  });
});

describe('EXAMPLE_PACK', () => {
  it('is marked unverified so it can never block an ad', () => {
    // It contains illustrative thresholds, not transcribed OEM rules.
    expect(EXAMPLE_PACK.verified).toBe(false);
  });

  it('evaluates without throwing against a real-shaped ad', () => {
    const d = doc([textEl('disc', 'disclaimer'), textEl('tag', 'tagline')]);
    const f = evaluateCoopRules({ doc: d, data: LEASE, pack: EXAMPLE_PACK });
    expect(Array.isArray(f)).toBe(true);
    expect(coopPassed(f)).toBe(true); // unverified ⇒ nothing blocks
  });
});

describe('numeric_limit', () => {
  const D = doc([textEl('e', 'disclaimer')]);
  const evalRule = (rule: CoopRule, data: AdData) =>
    evaluateCoopRules({ doc: D, data, pack: pack([rule]) });

  // A pricing floor: advertised price ≥ dealer invoice − advertising allowance.
  const floor: CoopRule = {
    id: 'floor',
    kind: 'numeric_limit',
    field: 'salePrice',
    bound: 'min',
    limits: [[{ field: 'dealerInvoiceTotal', label: 'Dealer invoice' }, { field: 'maapAllowance', label: 'allowance', op: 'subtract' }]],
    severity: 'error',
    description: 'The advertised price may not fall below the pricing floor.',
    citation: 'Doc §1a',
  };

  it('passes a price at or above the floor', () => {
    expect(evalRule(floor, { salePrice: '40200', dealerInvoiceTotal: '43200', maapAllowance: '3000' })).toEqual([]);
  });

  it('flags a price below the floor and shows the arithmetic', () => {
    const [f] = evalRule(floor, { salePrice: '39000', dealerInvoiceTotal: '43200', maapAllowance: '3000' });
    expect(f.severity).toBe('error');
    expect(f.observed).toContain('salePrice is $39,000');
    expect(f.observed).toContain('floor is $40,200');
    expect(f.observed).toContain('Dealer invoice − allowance = $40,200');
    expect(f.citation).toBe('Doc §1a');
  });

  // A ceiling stated as a percentage of another field — the VW down-payment cap.
  const cap: CoopRule = {
    id: 'cap',
    kind: 'numeric_limit',
    field: 'customerDown',
    bound: 'max',
    limits: [[{ field: 'msrp', label: 'MSRP', factor: 0.2 }]],
    severity: 'error',
    description: 'Customer down may not exceed 20% of MSRP.',
  };

  it('passes a down payment under the cap', () => {
    expect(evalRule(cap, { customerDown: '8000', msrp: '45630' })).toEqual([]);
  });

  it('flags a down payment over the cap, describing it as a percentage', () => {
    const [f] = evalRule(cap, { customerDown: '10000', msrp: '45630' });
    expect(f.observed).toContain('ceiling is $9,126');
    expect(f.observed).toContain('20% of MSRP');
  });

  it('does not trip on float error at exactly the limit', () => {
    expect(evalRule(cap, { customerDown: '9126', msrp: '45630' })).toEqual([]);
  });

  // "Could not check" must never be silence — silence reads as a pass.
  it('warns rather than passing when the tested figure is missing', () => {
    const [f] = evalRule(floor, { dealerInvoiceTotal: '43200', maapAllowance: '3000' });
    expect(f.severity).toBe('warning');
    expect(f.observed).toContain('Not checked');
    expect(f.observed).toContain('salePrice is empty');
  });

  it('warns rather than enforcing a partial sum when a limit input is missing', () => {
    const [f] = evalRule(floor, { salePrice: '39000', dealerInvoiceTotal: '43200' });
    expect(f.severity).toBe('warning');
    expect(f.observed).toContain('a figure the limit depends on is missing');
  });

  // The un-checkable warning stays a warning even on an error-severity rule, so
  // a figure the dealer cannot supply can't block a whole month of ads.
  it('never blocks on an un-checkable rule', () => {
    expect(coopPassed(evalRule(floor, {}))).toBe(true);
  });

  // Two candidate limits — the shape a brand needs when it states its cap two
  // ways at once ("15% of MSRP or $3,500").
  const twoWay = (select: 'lowest' | 'highest'): CoopRule => ({
    id: 'twoway',
    kind: 'numeric_limit',
    field: 'dueAtSigning',
    bound: 'max',
    limits: [[{ field: 'msrp', label: 'MSRP', factor: 0.15 }], [{ literal: 3500 }]],
    select,
    severity: 'error',
    description: 'Amount due at signing is capped.',
  });

  it('takes the lower of two candidate limits when told to', () => {
    // 15% of $45,630 = $6,844.50; the other candidate is $3,500.
    const [f] = evalRule(twoWay('lowest'), { dueAtSigning: '4000', msrp: '45630' });
    expect(f.observed).toContain('ceiling is $3,500');
  });

  it('takes the higher of two candidate limits when told to', () => {
    expect(evalRule(twoWay('highest'), { dueAtSigning: '4000', msrp: '45630' })).toEqual([]);
  });

  // Ambiguity is a fault in the rule, not something to resolve by guessing.
  it('rejects several limits with no rule for choosing between them', () => {
    const ambiguous = { ...twoWay('lowest'), select: undefined } as CoopRule;
    const [f] = evalRule(ambiguous, { dueAtSigning: '4000', msrp: '45630' });
    expect(f.severity).toBe('error');
    expect(f.observed).toContain('does not say which governs');
  });

  it('rejects a rule that defines no limit at all', () => {
    const empty = { ...floor, limits: [] } as CoopRule;
    const [f] = evalRule(empty, { salePrice: '39000' });
    expect(f.observed).toContain('defines no limit');
  });

  it('is a content rule — it runs per ad, not against the template', () => {
    // Design-time checking must not try to evaluate it against placeholder data.
    const { design, content } = splitCoopPack(pack([floor]));
    expect(design.rules).toEqual([]);
    expect(content.rules).toHaveLength(1);
  });
});

describe('coopPassed', () => {
  it('is true for warnings only', () => {
    expect(coopPassed([{ ruleId: 'a', severity: 'warning', description: 'd', observed: 'o' }])).toBe(true);
  });

  it('is false when any error is present', () => {
    expect(
      coopPassed([
        { ruleId: 'a', severity: 'warning', description: 'd', observed: 'o' },
        { ruleId: 'b', severity: 'error', description: 'd', observed: 'o' },
      ]),
    ).toBe(false);
  });
});
