import { describe, it, expect } from 'vitest';
import {
  formatFilterErrors,
  parseAndValidateFilterDefinition,
  validateFilterDefinition,
  MAX_GROUPS,
} from './smart-list-validate';
import { getFilterableFields, type FilterDefinition } from './smart-list-types';
import { LIFECYCLE_PRESETS } from './smart-list-presets';

const fields = getFilterableFields([
  {
    key: 'deal_type',
    label: 'Deal Type',
    type: 'select',
    category: 'custom',
    options: [
      { value: 'Purchase', label: 'Purchase' },
      { value: 'Lease', label: 'Lease' },
    ],
  },
  { key: 'last_service_date', label: 'Last Service Date', type: 'date', category: 'custom' },
]);

function def(
  conditions: Array<Record<string, unknown>>,
): FilterDefinition {
  return {
    version: 1,
    logic: 'AND',
    groups: [{ id: 'g', logic: 'AND', conditions: conditions as never }],
  };
}

const errorPaths = (value: unknown) => {
  const result = validateFilterDefinition(value, fields);
  return result.ok ? [] : result.errors.map((e) => e.path);
};

describe('accepts valid definitions', () => {
  it('passes a well-formed condition', () => {
    const result = validateFilterDefinition(
      def([{ id: 'r', field: 'last_service_date', operator: 'more_than_days_ago', value: '180' }]),
      fields,
    );
    expect(result.ok).toBe(true);
  });

  it('passes a no-value operator without a value', () => {
    const result = validateFilterDefinition(
      def([{ id: 'r', field: 'email', operator: 'is_not_empty', value: '' }]),
      fields,
    );
    expect(result.ok).toBe(true);
  });
});

describe('rejects the fail-open shapes', () => {
  it('rejects an unknown field', () => {
    expect(
      errorPaths(def([{ id: 'r', field: 'nope', operator: 'contains', value: 'x' }])),
    ).toContain('groups[0].conditions[0].field');
  });

  it('rejects an operator from the wrong type family', () => {
    // `last_service_date` is a date; `contains` belongs to text.
    expect(
      errorPaths(def([{ id: 'r', field: 'last_service_date', operator: 'contains', value: 'x' }])),
    ).toContain('groups[0].conditions[0].operator');
  });

  it('rejects an unknown operator', () => {
    expect(
      errorPaths(def([{ id: 'r', field: 'email', operator: 'sounds_like', value: 'x' }])),
    ).toContain('groups[0].conditions[0].operator');
  });

  it('rejects a value-taking operator with no value', () => {
    expect(
      errorPaths(def([{ id: 'r', field: 'email', operator: 'contains', value: '  ' }])),
    ).toContain('groups[0].conditions[0].value');
  });

  it('rejects a range operator with no upper bound', () => {
    expect(
      errorPaths(def([{ id: 'r', field: 'dateAdded', operator: 'between', value: '2026-01-01' }])),
    ).toContain('groups[0].conditions[0].value2');
  });

  it('rejects a select value that is not a declared option', () => {
    expect(
      errorPaths(def([{ id: 'r', field: 'deal_type', operator: 'is_one_of', value: 'Rental' }])),
    ).toContain('groups[0].conditions[0].value');
  });

  it('rejects an empty definition — it can only ever match nobody', () => {
    expect(errorPaths({ version: 1, logic: 'AND', groups: [] })).toContain('groups');
  });

  it('rejects a group with no conditions', () => {
    expect(
      errorPaths({ version: 1, logic: 'AND', groups: [{ id: 'g', logic: 'AND', conditions: [] }] }),
    ).toContain('groups[0].conditions');
  });

  it('rejects an unsupported version', () => {
    expect(errorPaths({ version: 2, logic: 'AND', groups: [] })).toContain('version');
  });

  it('caps group count', () => {
    const groups = Array.from({ length: MAX_GROUPS + 1 }, (_, i) => ({
      id: `g${i}`,
      logic: 'AND',
      conditions: [{ id: 'r', field: 'email', operator: 'is_not_empty', value: '' }],
    }));
    expect(errorPaths({ version: 1, logic: 'AND', groups })).toContain('groups');
  });

  it('reports every problem, not just the first', () => {
    const result = validateFilterDefinition(
      def([
        { id: 'a', field: 'nope', operator: 'contains', value: 'x' },
        { id: 'b', field: 'email', operator: 'contains', value: '' },
      ]),
      fields,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('custom fields are scoped', () => {
  it('rejects a custom-field reference when validating org-wide (built-ins only)', () => {
    // Org-wide segments get no custom fields — a key that resolves inside
    // a sub-account must not silently persist at org level.
    const result = validateFilterDefinition(
      def([{ id: 'r', field: 'deal_type', operator: 'is_one_of', value: 'Purchase' }]),
      getFilterableFields(null),
    );
    expect(result.ok).toBe(false);
  });
});

describe('shipped presets', () => {
  // These get seeded straight into Audience rows (bypassing the API), so
  // nothing else would catch it if one drifted into a shape the API then
  // refuses to accept on edit.
  it('every lifecycle preset validates against the built-in fields', () => {
    for (const preset of LIFECYCLE_PRESETS) {
      const result = validateFilterDefinition(preset.definition, getFilterableFields(null));
      expect(result.ok, `${preset.id}: ${result.ok ? '' : formatFilterErrors(result.errors)}`).toBe(
        true,
      );
    }
  });
});

describe('parseAndValidateFilterDefinition', () => {
  it('rejects non-JSON', () => {
    const result = parseAndValidateFilterDefinition('{not json', fields);
    expect(result.ok).toBe(false);
  });

  it('rejects a non-string payload', () => {
    const result = parseAndValidateFilterDefinition({ version: 1 }, fields);
    expect(result.ok).toBe(false);
  });

  it('accepts a valid JSON string', () => {
    const result = parseAndValidateFilterDefinition(
      JSON.stringify(def([{ id: 'r', field: 'city', operator: 'equals', value: 'Ogden' }])),
      fields,
    );
    expect(result.ok).toBe(true);
  });
});
