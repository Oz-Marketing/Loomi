import { describe, it, expect } from 'vitest';
import {
  applyFieldPrefs,
  hidableFields,
  parseHiddenFields,
  protectedFieldKeys,
  sanitizeHiddenFields,
} from './field-prefs';
import type { OemOfferRule } from './compliance';
import type { FieldSpec } from './types';
import { boundFieldKeys, templateInSchedule } from './doc-types';

const FIELDS: FieldSpec[] = [
  { key: 'offerType', label: 'Offer type', type: 'select' },
  { key: 'monthlyPayment', label: 'Monthly payment', type: 'text' },
  { key: 'leaseTerm', label: 'Lease term', type: 'text' },
  { key: 'aprRate', label: 'APR rate', type: 'text' },
  { key: 'tagline', label: 'Tagline', type: 'text' },
  { key: 'stockNumber', label: 'Stock #', type: 'text' },
  { key: 'dealerCode', label: 'Dealer code', type: 'text' },
  { key: 'disclaimer', label: 'Disclaimer', type: 'textarea' },
];

const SUBARU: OemOfferRule = {
  make: 'Subaru',
  requiredFields: { lease: ['securityDeposit'], apr: ['stockNumber'] },
};

describe('protectedFieldKeys', () => {
  it('protects only offer type and the disclaimer with no offer type given', () => {
    const p = protectedFieldKeys();
    expect([...p].sort()).toEqual(['disclaimer', 'offerType']);
  });

  // The first cut protected everything required by ANY type, which left a
  // lease-only dealer looking at a list of padlocks.
  it('does not protect a field required only by a different offer type', () => {
    expect(protectedFieldKeys(undefined, 'lease').has('aprRate')).toBe(false);
  });

  it('protects what the given offer type requires', () => {
    const p = protectedFieldKeys(undefined, 'lease');
    expect(p.has('monthlyPayment')).toBe(true);
    expect(p.has('leaseTerm')).toBe(true);
  });

  it("protects a manufacturer's requirement for that type", () => {
    expect(protectedFieldKeys(SUBARU, 'lease').has('securityDeposit')).toBe(true);
    expect(protectedFieldKeys(SUBARU, 'apr').has('securityDeposit')).toBe(false);
  });
});

describe('hidableFields', () => {
  it('locks only the two unconditional fields', () => {
    const rows = hidableFields(FIELDS);
    const locked = rows.filter((r) => r.lockedReason).map((r) => r.key).sort();
    expect(locked).toEqual(['disclaimer', 'offerType']);
  });

  // Hiding works, but the field returns when the offer type needs it — saying so
  // is what stops that looking like a bug later.
  it('notes which offer types will show a hidden field anyway', () => {
    const row = hidableFields(FIELDS).find((r) => r.key === 'monthlyPayment');
    expect(row?.lockedReason).toBeUndefined();
    expect(row?.note).toBe('Still shows on Lease offers');
  });

  it('leaves a genuinely optional field with no note at all', () => {
    const row = hidableFields(FIELDS).find((r) => r.key === 'tagline');
    expect(row?.lockedReason).toBeUndefined();
    expect(row?.note).toBeUndefined();
  });

  it('does not omit protected fields from the list', () => {
    expect(hidableFields(FIELDS).map((r) => r.key)).toEqual(FIELDS.map((f) => f.key));
  });
});

describe('sanitizeHiddenFields', () => {
  it('keeps per-type requirements hidable and strips only the unconditional pair', () => {
    expect(sanitizeHiddenFields(['monthlyPayment', 'offerType', 'disclaimer', 'tagline'], FIELDS)).toEqual([
      'monthlyPayment',
      'tagline',
    ]);
  });

  it('drops keys the template does not have', () => {
    expect(sanitizeHiddenFields(['tagline', 'nonsense'], FIELDS)).toEqual(['tagline']);
  });

  it('de-duplicates and ignores blanks', () => {
    expect(sanitizeHiddenFields(['tagline', 'tagline', '', '  '], FIELDS)).toEqual(['tagline']);
  });

  it('does not reject the whole request because one key is protected', () => {
    expect(sanitizeHiddenFields(['disclaimer', 'tagline'], FIELDS)).toEqual(['tagline']);
  });
});

describe('applyFieldPrefs', () => {
  it('removes hidden fields', () => {
    const out = applyFieldPrefs(FIELDS, ['tagline', 'dealerCode']);
    expect(out.map((f) => f.key)).not.toContain('tagline');
    expect(out.map((f) => f.key)).not.toContain('dealerCode');
  });

  it('returns the list untouched when nothing is hidden', () => {
    expect(applyFieldPrefs(FIELDS, [])).toBe(FIELDS);
    expect(applyFieldPrefs(FIELDS, null)).toBe(FIELDS);
  });

  // The safety property: you can hide APR rate as a lease dealer, and it comes
  // straight back the moment the ad is an APR offer — so no ad is ever blocked
  // on a value with nowhere to type it.
  it('puts back a hidden field that the CURRENT offer type requires', () => {
    expect(applyFieldPrefs(FIELDS, ['aprRate'], undefined, 'lease').map((f) => f.key)).not.toContain('aprRate');
    expect(applyFieldPrefs(FIELDS, ['aprRate'], undefined, 'apr').map((f) => f.key)).toContain('aprRate');
  });

  it("honours a manufacturer's requirement for the current type", () => {
    expect(applyFieldPrefs(FIELDS, ['stockNumber'], SUBARU, 'lease').map((f) => f.key)).not.toContain('stockNumber');
    expect(applyFieldPrefs(FIELDS, ['stockNumber'], SUBARU, 'apr').map((f) => f.key)).toContain('stockNumber');
  });

  it('never removes the disclaimer or the offer type', () => {
    const out = applyFieldPrefs(FIELDS, ['disclaimer', 'offerType'], undefined, 'lease');
    expect(out.map((f) => f.key)).toContain('disclaimer');
    expect(out.map((f) => f.key)).toContain('offerType');
  });
});

describe('parseHiddenFields', () => {
  it('parses a stored array', () => {
    expect(parseHiddenFields('["tagline","dealerCode"]')).toEqual(['tagline', 'dealerCode']);
  });

  it('degrades to nothing hidden on junk', () => {
    expect(parseHiddenFields('not json')).toEqual([]);
    expect(parseHiddenFields('{"a":1}')).toEqual([]);
    expect(parseHiddenFields(null)).toEqual([]);
  });

  it('drops non-string entries', () => {
    expect(parseHiddenFields('["tagline",5,null]')).toEqual(['tagline']);
  });
});

describe('templateInSchedule', () => {
  const on = (schedule: { start?: string | null; end?: string | null } | undefined, d: Date) =>
    templateInSchedule({ schedule }, d);

  it('shows a template with no window', () => {
    expect(on(undefined, new Date(2026, 6, 15))).toBe(true);
    expect(on({}, new Date(2026, 6, 15))).toBe(true);
  });

  // The bug this fixes: only the automation resolver honoured `schedule`, so a
  // Christmas plate sat in the human library in July.
  it('hides a template before its window opens and after it closes', () => {
    const w = { start: '2026-12-01', end: '2026-12-26' };
    expect(on(w, new Date(2026, 6, 15))).toBe(false);
    expect(on(w, new Date(2026, 11, 10))).toBe(true);
    expect(on(w, new Date(2027, 0, 5))).toBe(false);
  });

  it('treats both bounds as inclusive local days', () => {
    const w = { start: '2026-08-01', end: '2026-08-31' };
    // Late on the final day, where a UTC reading would already have expired it.
    expect(on(w, new Date(2026, 7, 31, 23, 30))).toBe(true);
    expect(on(w, new Date(2026, 7, 1, 0, 5))).toBe(true);
    expect(on(w, new Date(2026, 8, 1, 0, 5))).toBe(false);
  });

  it('supports half-open windows', () => {
    expect(on({ start: '2026-01-01' }, new Date(2030, 0, 1))).toBe(true);
    expect(on({ end: '2026-01-01' }, new Date(2025, 0, 1))).toBe(true);
    expect(on({ end: '2026-01-01' }, new Date(2026, 5, 1))).toBe(false);
  });
});

describe('hidableFields — only what the template renders', () => {
  // Every doc carries the full system-field schema since it became fixed, so an
  // unfiltered list offered choices that do nothing: hiding "Vehicle image URL"
  // on a template with no image element changes nothing the dealer can see.
  const bound = new Set(['tagline', 'dealerCode']);

  it('drops fields the template never binds', () => {
    const keys = hidableFields(FIELDS, undefined, bound).map((r) => r.key);
    expect(keys).toContain('tagline');
    expect(keys).toContain('dealerCode');
    expect(keys).not.toContain('stockNumber');
  });

  // They still gate export, so "why can't I export" has a visible answer.
  it('keeps the unconditional fields even when unbound', () => {
    const keys = hidableFields(FIELDS, undefined, bound).map((r) => r.key);
    expect(keys).toContain('offerType');
    expect(keys).toContain('disclaimer');
  });

  it('shows everything when no binding set is supplied (code templates)', () => {
    expect(hidableFields(FIELDS).map((r) => r.key)).toEqual(FIELDS.map((f) => f.key));
  });
});

describe('boundFieldKeys', () => {
  it('collects field and brand binding keys', () => {
    const doc = {
      elements: [
        { id: 'a', type: 'text', binding: { kind: 'field', key: 'tagline' } },
        { id: 'b', type: 'logo', binding: { kind: 'brand', key: 'logoUrl' } },
        { id: 'c', type: 'text' },
      ],
    } as Parameters<typeof boundFieldKeys>[0];
    expect([...boundFieldKeys(doc)].sort()).toEqual(['logoUrl', 'tagline']);
  });

  // A condition names a field the form has to expose, or the user can never
  // satisfy it.
  it('includes fields named only by a visibleWhen condition', () => {
    const doc = {
      elements: [
        {
          id: 'a',
          type: 'text',
          binding: { kind: 'field', key: 'aprRate' },
          visibleWhen: { field: 'offerType', in: ['apr'] },
        },
      ],
    } as Parameters<typeof boundFieldKeys>[0];
    expect([...boundFieldKeys(doc)].sort()).toEqual(['aprRate', 'offerType']);
  });
});
