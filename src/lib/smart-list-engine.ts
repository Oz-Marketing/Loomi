import type {
  FilterDefinition,
  FilterCondition,
  FilterGroup,
  FieldDefinition,
  FieldType,
} from './smart-list-types';
import type { Contact } from '@/lib/contacts/types';

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
 */
export function evaluateFilter(
  contacts: Contact[],
  definition: FilterDefinition,
  fields?: FieldDefinition[],
): Contact[] {
  if (!definition.groups.length) return contacts;
  const fieldMap = buildFieldMap(fields);

  return contacts.filter((contact) => {
    const groupResults = definition.groups.map((group) =>
      evaluateGroup(contact, group, fieldMap),
    );

    return definition.logic === 'AND'
      ? groupResults.every(Boolean)
      : groupResults.some(Boolean);
  });
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
): boolean {
  if (!group.conditions.length) return true;

  const results = group.conditions.map((condition) =>
    evaluateCondition(contact, condition, fieldMap),
  );

  return group.logic === 'AND'
    ? results.every(Boolean)
    : results.some(Boolean);
}

function evaluateCondition(
  contact: Contact,
  condition: FilterCondition,
  fieldMap: Map<string, FieldDefinition> | null,
): boolean {
  const { field, operator, value, value2 } = condition;
  const def = fieldMap?.get(field) ?? null;

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
    case 'text':
    default:
      return evaluateTextCondition(toScalarString(raw), operator, value);
  }
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
    default:
      return true;
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
    default:
      return true;
  }
}

function parseNumeric(value: string | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
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
    default:
      return true;
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
    default:
      return true;
  }
}

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
    default:
      return true;
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
    default:
      return true;
  }
}
