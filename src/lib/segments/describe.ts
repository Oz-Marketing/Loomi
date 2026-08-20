// A filter definition, in words.
//
// Used by the "filtering by…" bar on the Contacts page so the rules
// being applied are visible on the page that's applying them. Reading a
// row count and having to open a builder to find out WHY it's that
// number is how a filtered list gets mistaken for the whole list.
//
// Client-safe — no Prisma, no server imports.

import {
  NO_VALUE_OPERATORS,
  OPERATOR_LABELS,
  RANGE_OPERATORS,
  type FieldDefinition,
  type FilterCondition,
  type FilterDefinition,
} from '@/lib/smart-list-types';

function labelForField(fieldKey: string, fields: FieldDefinition[]): string {
  return fields.find((f) => f.key === fieldKey)?.label ?? fieldKey;
}

/**
 * Render the stored value the way the builder showed it: an option's
 * label rather than its stored value, a segment's name rather than its
 * cuid.
 */
function labelForValue(
  condition: FilterCondition,
  fields: FieldDefinition[],
): string {
  const field = fields.find((f) => f.key === condition.field);
  const raw = (condition.value ?? '').trim();
  if (!raw) return '';

  if (field?.options?.length) {
    // Multi-value operators store a comma list; map each part.
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    const mapped = parts.map(
      (part) => field.options!.find((o) => o.value === part)?.label ?? part,
    );
    return mapped.join(', ');
  }
  return raw;
}

/** One condition as a sentence fragment: `Last Service Date is before 02/20/2026`. */
export function describeCondition(
  condition: FilterCondition,
  fields: FieldDefinition[],
): string {
  const field = labelForField(condition.field, fields);
  const operator = OPERATOR_LABELS[condition.operator] ?? condition.operator;

  if (NO_VALUE_OPERATORS.includes(condition.operator)) {
    return `${field} ${operator}`;
  }
  const value = labelForValue(condition, fields);
  if (RANGE_OPERATORS.includes(condition.operator)) {
    const upper = (condition.value2 ?? '').trim();
    return `${field} ${operator} ${value} and ${upper}`.trim();
  }
  return `${field} ${operator} ${value}`.trim();
}

export interface DescribedGroup {
  /** How the conditions inside this group combine. */
  logic: 'AND' | 'OR';
  conditions: string[];
}

/** Every group's conditions, rendered. Empty groups are dropped. */
export function describeDefinition(
  definition: FilterDefinition | null | undefined,
  fields: FieldDefinition[],
): DescribedGroup[] {
  if (!definition || !Array.isArray(definition.groups)) return [];
  return definition.groups
    .map((group) => ({
      logic: group.logic,
      conditions: (group.conditions ?? []).map((c) => describeCondition(c, fields)),
    }))
    .filter((g) => g.conditions.length > 0);
}

/** Total conditions across every group. */
export function countConditions(
  definition: FilterDefinition | null | undefined,
): number {
  if (!definition || !Array.isArray(definition.groups)) return 0;
  return definition.groups.reduce((acc, g) => acc + (g.conditions?.length ?? 0), 0);
}

/** A one-line summary for tooltips and menu labels. */
export function summarizeDefinition(
  definition: FilterDefinition | null | undefined,
  fields: FieldDefinition[],
): string {
  const groups = describeDefinition(definition, fields);
  if (groups.length === 0) return 'No conditions';
  const joiner = definition?.logic === 'OR' ? ' OR ' : ' AND ';
  return groups
    .map((g) => {
      const inner = g.conditions.join(g.logic === 'OR' ? ' or ' : ' and ');
      return groups.length > 1 ? `(${inner})` : inner;
    })
    .join(joiner);
}
