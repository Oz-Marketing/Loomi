import { describe, it, expect } from 'vitest';
import {
  validateRule,
  validatePack,
  packIsValid,
  toCoopRule,
  toDraftRule,
  toCoopPack,
  suggestRuleId,
  type DraftRule,
  type DraftPack,
} from './coop-rule-authoring';
import { evaluateCoopRules, parseCoopPack } from './coop-rules';
import type { TemplateDoc } from './doc-types';

const base: DraftRule = {
  id: 'mazda-credit',
  kind: 'required_phrase',
  severity: 'error',
  description: 'Finance disclaimers must state a credit qualification.',
  citation: 'MCAP Aug 2025 — §4.2, p.11',
  field: 'disclaimer',
  phrase: 'approved credit',
};

describe('validateRule', () => {
  it('accepts a complete rule', () => {
    expect(validateRule(base)).toEqual([]);
  });

  // The premise of the whole system: a rule that can't be looked up can't be
  // defended to the dealer it blocks.
  it('demands a citation', () => {
    const errs = validateRule({ ...base, citation: '  ' });
    expect(errs.join(' ')).toMatch(/cite the section/i);
  });

  it('demands a description and an id', () => {
    expect(validateRule({ ...base, description: '' }).join(' ')).toMatch(/what the rule requires/i);
    expect(validateRule({ ...base, id: '' }).join(' ')).toMatch(/needs an id/i);
  });

  // A phrase rule with nothing to match passes every ad silently, which is worse
  // than not having the rule at all.
  it('rejects a phrase rule with neither phrase nor pattern', () => {
    const errs = validateRule({ ...base, phrase: undefined, pattern: undefined });
    expect(errs.join(' ')).toMatch(/wording it must contain/i);
  });

  it('rejects a banned phrase with nothing to match', () => {
    const errs = validateRule({ ...base, kind: 'banned_phrase', phrase: undefined, pattern: undefined });
    expect(errs.join(' ')).toMatch(/not allowed/i);
  });

  describe('element_zone', () => {
    const zoneRule: DraftRule = {
      ...base,
      kind: 'element_zone',
      field: 'logoUrl',
      zone: { x0: 0, y0: 0.6, x1: 1, y1: 1 },
    };

    it('accepts a well-formed zone', () => {
      expect(validateRule(zoneRule)).toEqual([]);
    });

    // An inside-out box matches nothing, so every ad would fail and it would
    // read as a broken engine rather than a typo.
    it('rejects an inside-out zone', () => {
      const errs = validateRule({ ...zoneRule, zone: { x0: 0.8, y0: 0.6, x1: 0.2, y1: 1 } });
      expect(errs.join(' ')).toMatch(/inside out/i);
    });

    it('rejects coordinates outside 0–1', () => {
      const errs = validateRule({ ...zoneRule, zone: { x0: 0, y0: 0, x1: 1080, y1: 1080 } });
      expect(errs.join(' ')).toMatch(/fractions of the ad/i);
    });
  });

  describe('numeric_limit', () => {
    const floor: DraftRule = {
      ...base,
      kind: 'numeric_limit',
      field: 'salePrice',
      bound: 'min',
      limits: [[{ field: 'dealerInvoiceTotal' }, { field: 'maapAllowance', op: 'subtract' }]],
    };

    it('accepts a single computed floor', () => {
      expect(validateRule(floor)).toEqual([]);
    });

    it('demands a bound', () => {
      const errs = validateRule({ ...floor, bound: undefined });
      expect(errs.join(' ')).toMatch(/floor or a ceiling/i);
    });

    it('demands at least one limit', () => {
      expect(validateRule({ ...floor, limits: [] }).join(' ')).toMatch(/at least one limit/i);
    });

    it('rejects a term that is neither a field nor an amount', () => {
      const errs = validateRule({ ...floor, limits: [[{}]] });
      expect(errs.join(' ')).toMatch(/either a field or a fixed amount/i);
    });

    it('rejects a term that is both', () => {
      const errs = validateRule({ ...floor, limits: [[{ field: 'msrp', literal: 3500 }]] });
      expect(errs.join(' ')).toMatch(/not both/i);
    });

    // The engine reports an unresolved choice as a malformed rule, so the editor
    // has to catch it before it can be stored.
    it('demands a tie-break when there are two candidate limits', () => {
      const twoWay = { ...floor, limits: [[{ field: 'msrp', factor: 0.15 }], [{ literal: 3500 }]] };
      expect(validateRule(twoWay).join(' ')).toMatch(/which one governs/i);
      expect(validateRule({ ...twoWay, select: 'lowest' as const })).toEqual([]);
    });
  });
});

describe('validatePack', () => {
  const pack: DraftPack = {
    make: 'Mazda',
    version: 'mcap-2026-01',
    source: 'Mazda MCAP Guidelines, Jan 2026',
    rules: [base],
  };

  it('accepts a complete pack', () => {
    const v = validatePack(pack);
    expect(packIsValid(v)).toBe(true);
  });

  it('requires make, version and source', () => {
    const v = validatePack({ ...pack, make: '', version: '', source: '' });
    expect(v.pack).toHaveLength(3);
  });

  // Rule ids appear in findings and run logs; two rules sharing one makes a
  // block untraceable back to the rule that caused it.
  it('rejects duplicate rule ids', () => {
    const v = validatePack({ ...pack, rules: [base, { ...base, description: 'Another' }] });
    expect(v.pack.join(' ')).toMatch(/share the id/i);
  });

  it('rejects a backwards effective window', () => {
    const v = validatePack({ ...pack, effectiveFrom: '2026-06-01', effectiveTo: '2026-01-01' });
    expect(v.pack.join(' ')).toMatch(/before its start/i);
  });

  it('surfaces per-rule errors keyed by rule id', () => {
    const v = validatePack({ ...pack, rules: [{ ...base, citation: '' }] });
    expect(v.rules['mazda-credit'].join(' ')).toMatch(/cite the section/i);
    expect(packIsValid(v)).toBe(false);
  });
});

describe('toCoopRule', () => {
  it('carries the citation and offer-type scope through', () => {
    const r = toCoopRule({ ...base, offerTypes: ['apr', 'lease'] });
    expect(r.citation).toBe('MCAP Aug 2025 — §4.2, p.11');
    expect(r.scope?.offerTypes).toEqual(['apr', 'lease']);
  });

  it('omits scope entirely when no offer types are chosen', () => {
    expect(toCoopRule({ ...base, offerTypes: [] }).scope).toBeUndefined();
  });

  // Editing a rule from one kind to another leaves the old kind's fields on the
  // draft. Carrying them over would let a banned_phrase inherit a stale pattern
  // and quietly match something nobody wrote.
  it('drops fields that do not belong to the chosen kind', () => {
    const r = toCoopRule({
      ...base,
      kind: 'required_element',
      field: 'logoUrl',
      pattern: 'left over from a previous kind',
      minPx: 9,
    }) as unknown as Record<string, unknown>;
    expect(r.kind).toBe('required_element');
    expect(r.pattern).toBeUndefined();
    expect(r.minPx).toBeUndefined();
  });

  it('prefers a pattern over a phrase when both are present', () => {
    const r = toCoopRule({ ...base, phrase: 'approved credit', pattern: 'approved credit|well-qualified' });
    expect(r).toMatchObject({ pattern: 'approved credit|well-qualified' });
    expect((r as unknown as Record<string, unknown>).phrase).toBeUndefined();
  });

  it('only sets a tie-break when there is more than one limit', () => {
    const one = toCoopRule({
      ...base,
      kind: 'numeric_limit',
      field: 'salePrice',
      bound: 'min',
      limits: [[{ field: 'msrp' }]],
      select: 'lowest',
    }) as unknown as Record<string, unknown>;
    expect(one.select).toBeUndefined();
  });
});

describe('round trip', () => {
  it('survives draft → rule → draft', () => {
    const r = toCoopRule(base);
    const back = toDraftRule(r);
    expect(back.id).toBe(base.id);
    expect(back.kind).toBe(base.kind);
    expect(back.citation).toBe(base.citation);
    expect(back.field).toBe('disclaimer');
  });

  // The whole point of authoring is that the engine can then run it, so the
  // stored JSON has to parse and evaluate — not merely look right.
  it('produces a pack the engine parses and evaluates', () => {
    const pack = toCoopPack({
      make: 'Mazda',
      version: 'mcap-2026-01',
      source: 'Mazda MCAP Guidelines, Jan 2026',
      rules: [base],
    });
    const parsed = parseCoopPack(JSON.stringify(pack));
    expect(parsed).not.toBeNull();

    const doc: TemplateDoc = {
      id: 't',
      name: 'T',
      sizes: [{ id: 'square', label: 'Square', width: 1080, height: 1080 }],
      fields: [],
      elements: [{ id: 'd', type: 'text', binding: { kind: 'field', key: 'disclaimer' } }],
      layouts: { square: { d: { x: 0, y: 0, w: 1, h: 0.2, fontSize: 20 } } },
      defaults: {},
    };
    const clean = evaluateCoopRules({ doc, data: { offerType: 'apr', disclaimer: 'With approved credit.' }, pack: parsed! });
    expect(clean).toEqual([]);

    const dirty = evaluateCoopRules({ doc, data: { offerType: 'apr', disclaimer: 'See dealer.' }, pack: parsed! });
    expect(dirty).toHaveLength(1);
    expect(dirty[0].citation).toBe('MCAP Aug 2025 — §4.2, p.11');
  });

  it('never stores a pack as self-certified', () => {
    const pack = toCoopPack({ make: 'Mazda', version: 'v1', source: 'doc', rules: [base] });
    expect(pack.verified).toBe(false);
  });
});

describe('suggestRuleId', () => {
  it('builds a readable id from the make and description', () => {
    expect(suggestRuleId('Mazda', 'No distressed language')).toBe('mazda-no-distressed-language');
  });

  it('avoids colliding with ids already in the pack', () => {
    const taken = ['mazda-no-distressed-language'];
    expect(suggestRuleId('Mazda', 'No distressed language', taken)).toBe('mazda-no-distressed-language-2');
  });
});
