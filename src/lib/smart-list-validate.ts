// Structural + semantic validation for a stored FilterDefinition.
//
// The engine (`smart-list-engine.ts`) fails CLOSED on anything it can't
// interpret, which keeps a bad filter from matching the whole database.
// But a segment that silently matches nobody is its own kind of bad, so
// this module is the other half: the API rejects definitions the engine
// would refuse to honour, and says which condition is wrong.
//
// Previously `/api/audiences` accepted any JSON with `version: 1` and an
// array of `groups` — an unknown field, an operator from the wrong type
// family, or a `contains` with no value all persisted happily.
//
// Field-level checks only run when the caller supplies the field
// catalogue. Org-wide segments are validated against the built-ins alone
// (they can't reference an account's custom fields), account-scoped ones
// against built-ins + that account's custom fields.

import {
  NO_VALUE_OPERATORS,
  OPERATORS_BY_TYPE,
  OPERATOR_LABELS,
  RANGE_OPERATORS,
  type FieldDefinition,
  type FilterCondition,
  type FilterDefinition,
  type FilterOperator,
} from './smart-list-types';

// Bounds exist to keep a pathological definition from turning into an
// expensive scan (and, later, a pathological SQL translation). They're
// far above any hand-built segment: the seeded lifecycle presets top out
// at a handful of conditions.
export const MAX_GROUPS = 25;
export const MAX_CONDITIONS_PER_GROUP = 50;
export const MAX_TOTAL_CONDITIONS = 250;
export const MAX_VALUE_LENGTH = 2000;

const ALL_OPERATORS = new Set<string>(Object.keys(OPERATOR_LABELS));

export interface FilterValidationError {
  /** Dot-path to the offending node, e.g. `groups[0].conditions[2].operator`. */
  path: string;
  message: string;
}

export type FilterValidationResult =
  | { ok: true; definition: FilterDefinition }
  | { ok: false; errors: FilterValidationError[] };

/**
 * Parse and validate a filter definition supplied as a JSON string
 * (the form `Audience.filters` is stored in).
 */
export function parseAndValidateFilterDefinition(
  raw: unknown,
  fields?: FieldDefinition[],
): FilterValidationResult {
  if (typeof raw !== 'string') {
    return { ok: false, errors: [{ path: 'filters', message: 'filters must be a JSON string' }] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errors: [{ path: 'filters', message: 'filters must be valid JSON' }] };
  }
  return validateFilterDefinition(parsed, fields);
}

/**
 * Validate an already-parsed filter definition. Returns every problem
 * found rather than stopping at the first, so the builder can highlight
 * all the broken rows at once.
 */
export function validateFilterDefinition(
  value: unknown,
  fields?: FieldDefinition[],
): FilterValidationResult {
  const errors: FilterValidationError[] = [];

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: [{ path: 'filters', message: 'Filter definition must be an object' }] };
  }

  const def = value as Partial<FilterDefinition>;

  if (def.version !== 1) {
    errors.push({ path: 'version', message: 'Unsupported filter version (expected 1)' });
  }
  if (def.logic !== 'AND' && def.logic !== 'OR') {
    errors.push({ path: 'logic', message: "logic must be 'AND' or 'OR'" });
  }
  if (!Array.isArray(def.groups)) {
    errors.push({ path: 'groups', message: 'groups must be an array' });
    return { ok: false, errors };
  }

  // A definition with no usable conditions is the fail-open shape the
  // engine now refuses to honour, so reject it at the door instead of
  // storing a segment that can only ever match nobody.
  if (def.groups.length === 0) {
    errors.push({ path: 'groups', message: 'A segment needs at least one condition' });
  }
  if (def.groups.length > MAX_GROUPS) {
    errors.push({ path: 'groups', message: `Too many groups (max ${MAX_GROUPS})` });
  }

  const fieldMap = fields ? new Map(fields.map((f) => [f.key, f])) : null;
  let totalConditions = 0;

  def.groups.forEach((group, gi) => {
    const gPath = `groups[${gi}]`;
    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      errors.push({ path: gPath, message: 'Group must be an object' });
      return;
    }
    if (group.logic !== 'AND' && group.logic !== 'OR') {
      errors.push({ path: `${gPath}.logic`, message: "Group logic must be 'AND' or 'OR'" });
    }
    if (!Array.isArray(group.conditions)) {
      errors.push({ path: `${gPath}.conditions`, message: 'conditions must be an array' });
      return;
    }
    if (group.conditions.length === 0) {
      errors.push({ path: `${gPath}.conditions`, message: 'Group has no conditions' });
    }
    if (group.conditions.length > MAX_CONDITIONS_PER_GROUP) {
      errors.push({
        path: `${gPath}.conditions`,
        message: `Too many conditions in one group (max ${MAX_CONDITIONS_PER_GROUP})`,
      });
    }

    totalConditions += group.conditions.length;

    group.conditions.forEach((condition, ci) => {
      validateCondition(condition, `${gPath}.conditions[${ci}]`, fieldMap, errors);
    });
  });

  if (totalConditions > MAX_TOTAL_CONDITIONS) {
    errors.push({
      path: 'groups',
      message: `Too many conditions overall (max ${MAX_TOTAL_CONDITIONS})`,
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, definition: value as FilterDefinition };
}

function validateCondition(
  raw: unknown,
  path: string,
  fieldMap: Map<string, FieldDefinition> | null,
  errors: FilterValidationError[],
): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push({ path, message: 'Condition must be an object' });
    return;
  }
  const condition = raw as Partial<FilterCondition>;

  const field = typeof condition.field === 'string' ? condition.field.trim() : '';
  if (!field) {
    errors.push({ path: `${path}.field`, message: 'Condition is missing a field' });
  }

  const operator = typeof condition.operator === 'string' ? condition.operator : '';
  if (!operator || !ALL_OPERATORS.has(operator)) {
    errors.push({
      path: `${path}.operator`,
      message: `Unknown operator${operator ? ` "${operator}"` : ''}`,
    });
    return;
  }
  const op = operator as FilterOperator;

  // Field-level checks need the catalogue. Without it we've still
  // validated shape, operator existence, and value presence.
  const def = field && fieldMap ? fieldMap.get(field) : undefined;
  if (field && fieldMap && !def) {
    errors.push({
      path: `${path}.field`,
      message: `Unknown field "${field}" — it may have been deleted or renamed`,
    });
  } else if (def && !OPERATORS_BY_TYPE[def.type].includes(op)) {
    // The fail-open case that motivated this module: re-typing a custom
    // field leaves saved conditions holding an operator from the old
    // type's family.
    errors.push({
      path: `${path}.operator`,
      message: `Operator "${OPERATOR_LABELS[op]}" doesn't apply to ${def.label} (${def.type})`,
    });
  }

  const needsValue = !NO_VALUE_OPERATORS.includes(op);
  const value = typeof condition.value === 'string' ? condition.value : '';
  const value2 = typeof condition.value2 === 'string' ? condition.value2 : '';

  if (needsValue && !value.trim()) {
    errors.push({ path: `${path}.value`, message: 'Condition is missing a value' });
  }
  if (RANGE_OPERATORS.includes(op) && !value2.trim()) {
    errors.push({ path: `${path}.value2`, message: 'Range condition is missing its upper bound' });
  }
  if (value.length > MAX_VALUE_LENGTH || value2.length > MAX_VALUE_LENGTH) {
    errors.push({ path: `${path}.value`, message: `Value too long (max ${MAX_VALUE_LENGTH})` });
  }

  // A select condition naming an option that doesn't exist can never
  // match; surface it rather than shipping an always-empty segment.
  if (def?.options?.length && (op === 'is_one_of' || op === 'is_not_one_of')) {
    const declared = new Set(def.options.map((o) => o.value.toLowerCase()));
    const unknown = value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .filter((v) => !declared.has(v.toLowerCase()));
    if (unknown.length > 0) {
      errors.push({
        path: `${path}.value`,
        message: `${def.label} has no option ${unknown.map((u) => `"${u}"`).join(', ')}`,
      });
    }
  }
}

/** Flatten validation errors into a single human-readable message for
 *  an API error body. */
export function formatFilterErrors(errors: FilterValidationError[]): string {
  return errors.map((e) => `${e.path}: ${e.message}`).join('; ');
}
