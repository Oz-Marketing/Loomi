import type { FilterDefinition, FilterCondition, FilterGroup } from './smart-list-types';
import type { Contact } from '@/lib/contacts/types';

/**
 * Evaluate a FilterDefinition against a list of contacts.
 * All filtering is client-side against already-fetched data.
 */
export function evaluateFilter(
  contacts: Contact[],
  definition: FilterDefinition,
): Contact[] {
  if (!definition.groups.length) return contacts;

  return contacts.filter((contact) => {
    const groupResults = definition.groups.map((group) =>
      evaluateGroup(contact, group),
    );

    return definition.logic === 'AND'
      ? groupResults.every(Boolean)
      : groupResults.some(Boolean);
  });
}

function evaluateGroup(contact: Contact, group: FilterGroup): boolean {
  if (!group.conditions.length) return true;

  const results = group.conditions.map((condition) =>
    evaluateCondition(contact, condition),
  );

  return group.logic === 'AND'
    ? results.every(Boolean)
    : results.some(Boolean);
}

function evaluateCondition(contact: Contact, condition: FilterCondition): boolean {
  const { field, operator, value, value2 } = condition;

  // Get the raw field value from the contact
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (contact as any)[field];

  // Tags field is an array
  if (field === 'tags') {
    const tags = Array.isArray(raw) ? (raw as string[]) : [];
    return evaluateTagsCondition(tags, operator, value);
  }

  if (operator === 'is_true' || operator === 'is_false') {
    return evaluateBooleanCondition(raw, operator);
  }

  const fieldValue = raw == null ? '' : String(raw).trim();

  // Determine if this is a date field by checking the operator type
  const dateOperators = ['before', 'after', 'between', 'within_days', 'overdue'];
  if (dateOperators.includes(operator)) {
    return evaluateDateCondition(fieldValue, operator, value, value2);
  }

  return evaluateTextCondition(fieldValue, operator, value);
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
