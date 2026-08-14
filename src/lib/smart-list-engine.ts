import {
  NO_VALUE_OPERATORS,
  RANGE_OPERATORS,
  type FieldDefinition,
  type FieldType,
  type FilterCondition,
  type FilterDefinition,
  type FilterGroup,
  type FilterOperator,
} from './smart-list-types';
import type { Contact } from '@/lib/contacts/types';

// ── Fail-closed contract ────────────────────────────────────────
//
// Every evaluator below returns FALSE for anything it doesn't
// understand: an unknown operator, an operator that doesn't belong to
// the field's declared type, a missing value, an empty group, an empty
// definition.
//
// This used to be the other way around (`default: return true`), which
// meant a filter the engine couldn't interpret matched EVERY contact.
// That's the wrong direction for a segment: the failure mode of
// "matches nobody" is a visibly empty audience someone fixes, while
// "matches everybody" is an invisible blast/export to the entire
// database. Reachable in practice by re-typing a custom field
// (date → text) out from under saved segments that reference it.
//
// Save-time validation (`smart-list-validate.ts`) is what surfaces
// these as errors; this module is the last line of defence for filter
// JSON already sitting in the database.

/**
 * Evaluate a FilterDefinition against a list of contacts.
 * All filtering is client-side against already-fetched data.
 *
 * `fields` is the merged field set (built-ins + the account's custom
 * fields). When provided, the engine routes custom-field reads to
 * `contact.customFields[key]` and uses the field's declared type to
 * pick the operator family. When omitted, the engine falls back to
 * legacy direct-property reads — built-in fields still work, but
 * custom fields are silently ignored.
 *
 * A definition with no groups matches NOTHING. Callers that want
 * "no filter yet → show everything" (e.g. the segment editor's live
 * preview before any condition is entered) must short-circuit on
 * `groups.length === 0` themselves rather than relying on this.
 */
export function evaluateFilter(
  contacts: Contact[],
  definition: FilterDefinition,
  fields?: FieldDefinition[],
  /** Definitions of referenced segments, keyed by audience id. Required
   *  only when the definition composes other segments; load them with
   *  `loadSegmentRefs` (server) before calling. */
  refs?: Map<string, FilterDefinition>,
): Contact[] {
  if (!definition.groups?.length) return [];
  const fieldMap = buildFieldMap(fields);
  return contacts.filter((contact) =>
    matchesDefinition(contact, definition, fieldMap, refs),
  );
}

/** Whether one contact satisfies a definition. Split out so a segment
 *  reference can recurse into the referenced definition. */
function matchesDefinition(
  contact: Contact,
  definition: FilterDefinition,
  fieldMap: Map<string, FieldDefinition> | null,
  refs: Map<string, FilterDefinition> | undefined,
  depth = 0,
): boolean {
  if (!definition.groups?.length) return false;
  // Mirrors MAX_SEGMENT_REF_DEPTH. The loader rejects cycles up front,
  // so this is a belt-and-braces stop for a definition assembled by
  // some other path.
  if (depth > 5) return false;

  const groupResults = definition.groups.map((group) =>
    evaluateGroup(contact, group, fieldMap, refs, depth),
  );
  return definition.logic === 'AND'
    ? groupResults.every(Boolean)
    : groupResults.some(Boolean);
}

function buildFieldMap(
  fields: FieldDefinition[] | undefined,
): Map<string, FieldDefinition> | null {
  if (!fields) return null;
  const map = new Map<string, FieldDefinition>();
  for (const f of fields) map.set(f.key, f);
  return map;
}

function evaluateGroup(
  contact: Contact,
  group: FilterGroup,
  fieldMap: Map<string, FieldDefinition> | null,
  refs?: Map<string, FilterDefinition>,
  depth = 0,
): boolean {
  // A group with no conditions expresses nothing, so it narrows to
  // nothing. See the fail-closed note at the top of the file.
  if (!group.conditions?.length) return false;

  const results = group.conditions.map((condition) =>
    evaluateCondition(contact, condition, fieldMap, refs, depth),
  );

  return group.logic === 'AND'
    ? results.every(Boolean)
    : results.some(Boolean);
}

function evaluateCondition(
  contact: Contact,
  condition: FilterCondition,
  fieldMap: Map<string, FieldDefinition> | null,
  refs?: Map<string, FilterDefinition>,
  depth = 0,
): boolean {
  const { field, operator, value, value2 } = condition;
  const def = fieldMap?.get(field) ?? null;

  // Segment composition: evaluate the REFERENCED definition against this
  // same contact. Fails closed when the reference wasn't loaded — an
  // unresolvable reference must not silently widen the audience.
  if (operator === 'in_segment' || operator === 'not_in_segment') {
    const referenced = refs?.get(value?.trim() ?? '');
    if (!referenced) return false;
    const inSegment = matchesDefinition(
      contact,
      referenced,
      fieldMap,
      refs,
      depth + 1,
    );
    return operator === 'in_segment' ? inSegment : !inSegment;
  }

  // Operators that compare against something need that something. An
  // empty target is not "match everyone" — `contains ""` is true for
  // every string, which is precisely the fail-open case this guard
  // exists to stop. The builder strips these on save; filter JSON
  // written before that (or straight through the API) still reaches
  // here.
  if (!operatorHasRequiredValues(operator, value, value2)) return false;

  // Read the raw value from the right place: custom fields live under
  // the `customFields` JSON blob, everything else is a direct property.
  let raw: unknown;
  if (def?.isCustom) {
    const blob = (contact as Contact & { customFields?: Record<string, unknown> })
      .customFields;
    raw = blob ? blob[field] : undefined;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    raw = (contact as any)[field];
  }

  // When a definition is available, route by the declared field type.
  // Without a definition, fall back to legacy operator-name dispatch
  // so callers that don't pass fields still get the original behavior
  // for built-in fields.
  const type: FieldType | null = def?.type ?? inferTypeFromOperator(operator);

  switch (type) {
    case 'tags':
    case 'multiselect':
      return evaluateTagsCondition(toStringArray(raw), operator, value);
    case 'boolean':
      return evaluateBooleanCondition(raw, operator);
    case 'date':
      return evaluateDateCondition(toScalarString(raw), operator, value, value2);
    case 'number':
      return evaluateNumberCondition(raw, operator, value, value2);
    case 'select':
      return evaluateSelectCondition(toScalarString(raw), operator, value);
    case 'numeric_text':
      // Stored as text, comparable either way — the operator decides.
      return NUMBER_OPERATORS.has(operator)
        ? evaluateNumberCondition(raw, operator, value, value2)
        : evaluateTextCondition(toScalarString(raw), operator, value);
    case 'text':
    default:
      return evaluateTextCondition(toScalarString(raw), operator, value);
  }
}

/**
 * True when `operator` has every value it needs to express a
 * comparison. No-value operators (is_empty / is_true / overdue / …)
 * always pass; range operators need both bounds; everything else needs
 * a non-blank `value`.
 */
export function operatorHasRequiredValues(
  operator: string,
  value: string | undefined,
  value2: string | undefined,
): boolean {
  if (NO_VALUE_OPERATORS.includes(operator as FilterOperator)) return true;
  if (!value || !value.trim()) return false;
  if (RANGE_OPERATORS.includes(operator as FilterOperator)) {
    return !!value2 && !!value2.trim();
  }
  return true;
}

// Operator-name → FieldType fallback for callers that don't pass a
// field map. Mirrors the original dispatch order (date operators win
// before text). New numeric and select operators are mapped too so a
// stale caller without a field map still routes correctly when
// editing custom fields by key alone.
function inferTypeFromOperator(operator: string): FieldType {
  if (operator === 'is_true' || operator === 'is_false') return 'boolean';
  if (
    operator === 'includes_any' ||
    operator === 'includes_all' ||
    operator === 'excludes'
  ) {
    return 'tags';
  }
  if (operator === 'is_one_of' || operator === 'is_not_one_of') return 'select';
  if (
    operator === 'num_equals' ||
    operator === 'num_not_equals' ||
    operator === 'num_gt' ||
    operator === 'num_lt' ||
    operator === 'num_gte' ||
    operator === 'num_lte' ||
    operator === 'num_between'
  ) {
    return 'number';
  }
  if (
    operator === 'before' ||
    operator === 'after' ||
    operator === 'between' ||
    operator === 'within_days' ||
    operator === 'within_last_days' ||
    operator === 'more_than_days_ago' ||
    operator === 'overdue'
  ) {
    return 'date';
  }
  return 'text';
}

function toScalarString(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (raw instanceof Date) return raw.toISOString();
  return '';
}

function toStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => (typeof entry === 'string' ? entry : String(entry)))
      .filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    // Comma-separated stored value (custom multiselect imports often
    // arrive this way). Split conservatively so a tag value like
    // "loyalty, gold" stays as two entries.
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

// ── Text Operators ──

function evaluateTextCondition(
  fieldValue: string,
  operator: string,
  value: string,
): boolean {
  const lower = fieldValue.toLowerCase();
  const target = value.toLowerCase();

  switch (operator) {
    case 'contains':
      return lower.includes(target);
    case 'not_contains':
      return !lower.includes(target);
    case 'equals':
      return lower === target;
    case 'not_equals':
      return lower !== target;
    case 'is_empty':
      return fieldValue === '';
    case 'is_not_empty':
      return fieldValue !== '';
    // Operator doesn't belong to this field type — no match.
    default:
      return false;
  }
}

// ── Number Operators ──

// Number fields are stored as strings on the wire (everything in
// `Contact.customFields` is JSON-stringified), so we coerce on read.
// `value` from the UI is also a string for the same reason — single
// source of stringification rules across the codebase.
function evaluateNumberCondition(
  raw: unknown,
  operator: string,
  value: string,
  value2: string | undefined,
): boolean {
  const target = parseNumeric(value);
  const target2 = parseNumeric(value2);
  const actual = parseNumeric(typeof raw === 'string' ? raw : String(raw ?? ''));

  switch (operator) {
    case 'is_empty':
      return actual == null;
    case 'is_not_empty':
      return actual != null;
    case 'num_equals':
      return actual != null && target != null && actual === target;
    case 'num_not_equals':
      return actual != null && target != null && actual !== target;
    case 'num_gt':
      return actual != null && target != null && actual > target;
    case 'num_lt':
      return actual != null && target != null && actual < target;
    case 'num_gte':
      return actual != null && target != null && actual >= target;
    case 'num_lte':
      return actual != null && target != null && actual <= target;
    case 'num_between':
      return (
        actual != null &&
        target != null &&
        target2 != null &&
        actual >= target &&
        actual <= target2
      );
    // Operator doesn't belong to this field type — no match.
    default:
      return false;
  }
}

const NUMBER_OPERATORS: ReadonlySet<string> = new Set([
  'num_equals',
  'num_not_equals',
  'num_gt',
  'num_lt',
  'num_gte',
  'num_lte',
  'num_between',
]);

// Plain decimal only, with thousands separators tolerated because CRM
// exports are full of "72,500".
//
// This is deliberately narrower than `Number()`, which also accepts hex
// ("0x10" → 16) and exponent notation ("1e3" → 1000). Neither is a
// meaningful mileage or year, and more importantly the SQL translator
// has to reproduce this rule exactly — a shared, restricted grammar is
// checkable; JS's full coercion table is not.
const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;

function parseNumeric(value: string | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim().replace(/,/g, '');
  if (!trimmed || !NUMERIC_TEXT.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

// ── Boolean Operators ──

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (!lower) return false;
    if (['true', 'yes', 'y', '1'].includes(lower)) return true;
    if (['false', 'no', 'n', '0'].includes(lower)) return false;
  }
  return false;
}

function evaluateBooleanCondition(
  rawValue: unknown,
  operator: string,
): boolean {
  const boolValue = toBoolean(rawValue);
  switch (operator) {
    case 'is_true':
      return boolValue;
    case 'is_false':
      return !boolValue;
    // Operator doesn't belong to this field type — no match.
    default:
      return false;
  }
}

// ── Date Operators ──

function evaluateDateCondition(
  fieldValue: string,
  operator: string,
  value: string,
  value2?: string,
): boolean {
  const parsedDate = parseDateValue(fieldValue);
  const parsedValue = parseDateValue(value);
  const parsedValue2 = parseDateValue(value2);
  const todayStart = startOfDay(new Date());

  switch (operator) {
    case 'is_empty':
      return fieldValue === '';
    case 'is_not_empty':
      return fieldValue !== '';
    case 'overdue': {
      if (!parsedDate) return false;
      // Compare by calendar day to avoid marking "today" as overdue.
      return startOfDay(parsedDate).getTime() < todayStart.getTime();
    }
    case 'before': {
      if (!parsedDate || !parsedValue) return false;
      return parsedDate.getTime() < parsedValue.getTime();
    }
    case 'after': {
      if (!parsedDate || !parsedValue) return false;
      return parsedDate.getTime() > parsedValue.getTime();
    }
    case 'between': {
      if (!parsedDate || !parsedValue || !parsedValue2) return false;
      return parsedDate.getTime() >= parsedValue.getTime() && parsedDate.getTime() <= parsedValue2.getTime();
    }
    case 'within_days': {
      if (!parsedDate || !value) return false;
      const days = parseInt(value, 10);
      if (isNaN(days)) return false;
      const future = endOfDay(new Date(todayStart.getTime() + days * 24 * 60 * 60 * 1000));
      // within_days: date is between start of today and end of Nth day.
      return parsedDate.getTime() >= todayStart.getTime() && parsedDate.getTime() <= future.getTime();
    }
    case 'within_last_days': {
      // Past-only: the date falls in [N days ago 00:00 .. end of today].
      // This is what "Last X Date is After N Days" means in the lifecycle
      // specs — the event happened within the last N days.
      if (!parsedDate || !value) return false;
      const days = parseInt(value, 10);
      if (isNaN(days)) return false;
      const lower = todayStart.getTime() - days * 24 * 60 * 60 * 1000;
      const upper = endOfDay(new Date(todayStart)).getTime();
      return parsedDate.getTime() >= lower && parsedDate.getTime() <= upper;
    }
    case 'more_than_days_ago': {
      // Past-only, beyond N: the date is strictly older than N days ago
      // (calendar-day comparison). Powers lapse gates ("lapsed more than
      // 6 months"). Future dates never match.
      if (!parsedDate || !value) return false;
      const days = parseInt(value, 10);
      if (isNaN(days)) return false;
      const cutoff = todayStart.getTime() - days * 24 * 60 * 60 * 1000;
      return startOfDay(parsedDate).getTime() < cutoff;
    }
    // Operator doesn't belong to this field type — no match.
    default:
      return false;
  }
}

// Exported so the SQL translator can compute identical bounds. Two
// implementations of "what does `more_than_days_ago: 180` mean" is
// exactly how a fast path and a slow path drift apart.
export { parseDateValue as parseFilterDate, startOfDay as startOfFilterDay, endOfDay as endOfFilterDay };

function parseDateValue(value?: string): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d{10}$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isNaN(seconds)) {
      const d = new Date(seconds * 1000);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  if (/^\d{11,13}$/.test(trimmed)) {
    const millis = Number(trimmed);
    if (!Number.isNaN(millis)) {
      const d = new Date(millis);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return null;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

// ── Tags Operators ──

function evaluateTagsCondition(
  tags: string[],
  operator: string,
  value: string,
): boolean {
  const lowerTags = tags.map((t) => t.toLowerCase());

  switch (operator) {
    case 'is_empty':
      return tags.length === 0;
    case 'is_not_empty':
      return tags.length > 0;
    case 'includes_any': {
      const targets = parseTagList(value);
      return targets.some((t) => lowerTags.includes(t));
    }
    case 'includes_all': {
      const targets = parseTagList(value);
      return targets.every((t) => lowerTags.includes(t));
    }
    case 'excludes': {
      const targets = parseTagList(value);
      return !targets.some((t) => lowerTags.includes(t));
    }
    // Operator doesn't belong to this field type — no match.
    default:
      return false;
  }
}

function parseTagList(value: string): string[] {
  return value
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

// ── Select Operators ──

// Select fields store a single value matched against a declared option
// list. `is_one_of` / `is_not_one_of` accept comma-separated targets
// for symmetry with the tags multi-input UX.
function evaluateSelectCondition(
  fieldValue: string,
  operator: string,
  value: string,
): boolean {
  const lower = fieldValue.toLowerCase();
  switch (operator) {
    case 'is_empty':
      return fieldValue === '';
    case 'is_not_empty':
      return fieldValue !== '';
    case 'is_one_of': {
      const targets = parseTagList(value);
      return targets.includes(lower);
    }
    case 'is_not_one_of': {
      const targets = parseTagList(value);
      return !targets.includes(lower);
    }
    // Operator doesn't belong to this field type — no match.
    default:
      return false;
  }
}
