import { describe, it, expect } from 'vitest';
import {
  pickDisclaimerTemplate,
  rankDisclaimerTemplates,
  type DisclaimerTemplateRow,
} from './disclaimer-resolve';

function row(over: Partial<DisclaimerTemplateRow> = {}): DisclaimerTemplateRow {
  return { id: 'r1', name: 'Row', make: null, body: 'Body.', isDefault: false, ...over };
}

describe('rankDisclaimerTemplates', () => {
  it('puts make-specific templates ahead of globals', () => {
    const ranked = rankDisclaimerTemplates([
      row({ id: 'global', make: null, name: 'Global lease' }),
      row({ id: 'subaru', make: 'Subaru', name: 'Subaru lease' }),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['subaru', 'global']);
  });

  it('puts isDefault ahead within the same make scope', () => {
    const ranked = rankDisclaimerTemplates([
      row({ id: 'alt', make: 'Subaru', name: 'Alt', isDefault: false }),
      row({ id: 'std', make: 'Subaru', name: 'Standard', isDefault: true }),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['std', 'alt']);
  });

  it('falls back to name order', () => {
    const ranked = rankDisclaimerTemplates([
      row({ id: 'b', name: 'Beta' }),
      row({ id: 'a', name: 'Alpha' }),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the input', () => {
    const rows = [row({ id: 'b', name: 'Beta' }), row({ id: 'a', name: 'Alpha' })];
    rankDisclaimerTemplates(rows);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('pickDisclaimerTemplate', () => {
  it('honours an explicitly requested template', () => {
    const rows = [row({ id: 'a', isDefault: true }), row({ id: 'b' })];
    expect(pickDisclaimerTemplate(rows, 'b')?.id).toBe('b');
  });

  it('returns null for a requested template that is not a candidate', () => {
    expect(pickDisclaimerTemplate([row({ id: 'a' })], 'missing')).toBeNull();
  });

  it('auto-applies the make-specific default over the global default', () => {
    const rows = [
      row({ id: 'global', make: null, isDefault: true }),
      row({ id: 'subaru', make: 'Subaru', isDefault: true }),
    ];
    expect(pickDisclaimerTemplate(rows)?.id).toBe('subaru');
  });

  it('never auto-applies a template that is not flagged isDefault', () => {
    // Merely having templates on file must not change an automated ad's legal
    // text — without an explicit default we fall through to the code default.
    const rows = [row({ id: 'a', make: 'Subaru' }), row({ id: 'b', make: null })];
    expect(pickDisclaimerTemplate(rows)).toBeNull();
  });

  it('returns null when there are no candidates at all', () => {
    expect(pickDisclaimerTemplate([])).toBeNull();
  });
});
