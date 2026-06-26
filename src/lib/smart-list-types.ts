// ── Audience Filter Type Definitions ──

// Field types determine which operators are available.
//
// `select` and `multiselect` exist for custom fields that declare a
// finite option list; the filter UI renders a dropdown of declared
// options instead of a free-text input. `number` mirrors text for the
// stored representation (strings on the wire) but exposes numeric
// operators (gt/lt/between) in the builder.
export type FieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'tags'
  | 'boolean'
  | 'select'
  | 'multiselect';

// Operators by field type
export type TextOperator =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'is_empty'
  | 'is_not_empty';

export type NumberOperator =
  | 'num_equals'
  | 'num_not_equals'
  | 'num_gt'
  | 'num_lt'
  | 'num_gte'
  | 'num_lte'
  | 'num_between'
  | 'is_empty'
  | 'is_not_empty';

export type DateOperator =
  | 'before'
  | 'after'
  | 'between'
  | 'within_days'
  // Directional, past-only relative operators. `within_days` is
  // bidirectional (matches dates within N days in either direction);
  // these two disambiguate "happened in the last N days" vs "happened
  // more than N days ago" — the date-math the lifecycle flows need for
  // goal-checks ("Last X Date is After N Days") and lapse gates.
  | 'within_last_days'
  | 'more_than_days_ago'
  | 'overdue'
  | 'is_empty'
  | 'is_not_empty';

export type TagsOperator =
  | 'includes_any'
  | 'includes_all'
  | 'excludes'
  | 'is_empty'
  | 'is_not_empty';

export type BooleanOperator = 'is_true' | 'is_false';

export type SelectOperator =
  | 'is_one_of'
  | 'is_not_one_of'
  | 'is_empty'
  | 'is_not_empty';

export type FilterOperator =
  | TextOperator
  | NumberOperator
  | DateOperator
  | TagsOperator
  | BooleanOperator
  | SelectOperator;

// Operator labels for the UI
export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: 'contains',
  not_contains: 'does not contain',
  equals: 'equals',
  not_equals: 'does not equal',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  num_equals: 'equals',
  num_not_equals: 'does not equal',
  num_gt: 'is greater than',
  num_lt: 'is less than',
  num_gte: 'is at least',
  num_lte: 'is at most',
  num_between: 'is between',
  before: 'is before',
  after: 'is after',
  between: 'is between',
  within_days: 'is within (days)',
  within_last_days: 'is within the last (days)',
  more_than_days_ago: 'is more than (days) ago',
  overdue: 'is overdue',
  includes_any: 'includes any of',
  includes_all: 'includes all of',
  excludes: 'excludes',
  is_true: 'is true',
  is_false: 'is false',
  is_one_of: 'is one of',
  is_not_one_of: 'is not one of',
};

// Operators available per field type
export const OPERATORS_BY_TYPE: Record<FieldType, FilterOperator[]> = {
  text: ['contains', 'not_contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty'],
  number: [
    'num_equals',
    'num_not_equals',
    'num_gt',
    'num_lt',
    'num_gte',
    'num_lte',
    'num_between',
    'is_empty',
    'is_not_empty',
  ],
  date: [
    'before',
    'after',
    'between',
    'within_days',
    'within_last_days',
    'more_than_days_ago',
    'overdue',
    'is_empty',
    'is_not_empty',
  ],
  tags: ['includes_any', 'includes_all', 'excludes', 'is_empty', 'is_not_empty'],
  boolean: ['is_true', 'is_false'],
  select: ['is_one_of', 'is_not_one_of', 'is_empty', 'is_not_empty'],
  multiselect: ['includes_any', 'includes_all', 'excludes', 'is_empty', 'is_not_empty'],
};

// Operators that need no value input
export const NO_VALUE_OPERATORS: FilterOperator[] = ['is_empty', 'is_not_empty', 'overdue', 'is_true', 'is_false'];

// ── Filter Definition (stored as JSON in DB) ──

export interface FilterCondition {
  id: string;
  field: string;
  operator: FilterOperator;
  value: string;
  value2?: string; // for 'between' date operator
}

export interface FilterGroup {
  id: string;
  logic: 'AND' | 'OR';
  conditions: FilterCondition[];
}

export interface FilterDefinition {
  version: 1;
  logic: 'AND' | 'OR';
  groups: FilterGroup[];
}

// ── Preset Filter (code constant, not DB record) ──

export interface PresetFilter {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  definition: FilterDefinition;
}

// ── Field Definitions (for the filter builder UI) ──

export type FieldCategory =
  | 'contact'
  | 'vehicle'
  | 'lifecycle'
  | 'messaging'
  | 'meta'
  | 'custom';

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDefinition {
  key: string;
  label: string;
  type: FieldType;
  category: FieldCategory;
  /** True when this field lives in `Contact.customFields[key]` instead
   *  of being a direct column on the Contact row. The engine routes
   *  reads accordingly. */
  isCustom?: boolean;
  /** Populated for select / multiselect fields so the filter builder
   *  can render a dropdown of declared options instead of a free-text
   *  input. */
  options?: FieldOption[];
}

export const FILTERABLE_FIELDS: FieldDefinition[] = [
  // Contact info
  { key: 'firstName', label: 'First Name', type: 'text', category: 'contact' },
  { key: 'lastName', label: 'Last Name', type: 'text', category: 'contact' },
  { key: 'fullName', label: 'Full Name', type: 'text', category: 'contact' },
  { key: 'email', label: 'Email', type: 'text', category: 'contact' },
  { key: 'phone', label: 'Phone', type: 'text', category: 'contact' },
  { key: 'city', label: 'City', type: 'text', category: 'contact' },
  { key: 'state', label: 'State', type: 'text', category: 'contact' },
  { key: 'postalCode', label: 'Postal Code', type: 'text', category: 'contact' },
  { key: 'source', label: 'Source', type: 'text', category: 'contact' },

  // Vehicle
  { key: 'vehicleYear', label: 'Vehicle Year', type: 'text', category: 'vehicle' },
  { key: 'vehicleMake', label: 'Vehicle Make', type: 'text', category: 'vehicle' },
  { key: 'vehicleModel', label: 'Vehicle Model', type: 'text', category: 'vehicle' },
  { key: 'vehicleVin', label: 'VIN', type: 'text', category: 'vehicle' },
  { key: 'vehicleMileage', label: 'Mileage', type: 'text', category: 'vehicle' },

  // Lifecycle dates
  { key: 'dateAdded', label: 'Date Added', type: 'date', category: 'lifecycle' },
  { key: 'purchaseDate', label: 'Purchase Date', type: 'date', category: 'lifecycle' },
  { key: 'lastServiceDate', label: 'Last Service Date', type: 'date', category: 'lifecycle' },
  { key: 'nextServiceDate', label: 'Next Service Date', type: 'date', category: 'lifecycle' },
  { key: 'leaseEndDate', label: 'Lease End Date', type: 'date', category: 'lifecycle' },
  { key: 'warrantyEndDate', label: 'Warranty End Date', type: 'date', category: 'lifecycle' },
  { key: 'dateOfBirth', label: 'Date of Birth', type: 'date', category: 'lifecycle' },

  // Messaging
  { key: 'hasReceivedMessage', label: 'Has Received Any Message', type: 'boolean', category: 'messaging' },
  { key: 'hasReceivedEmail', label: 'Has Received Email', type: 'boolean', category: 'messaging' },
  { key: 'hasReceivedSms', label: 'Has Received SMS', type: 'boolean', category: 'messaging' },
  { key: 'hasOpenedEmail', label: 'Has Opened Email', type: 'boolean', category: 'messaging' },
  { key: 'hasClickedEmail', label: 'Has Clicked Email', type: 'boolean', category: 'messaging' },
  { key: 'lastMessageDate', label: 'Last Message Date', type: 'date', category: 'messaging' },

  // Meta
  { key: 'tags', label: 'Tags', type: 'tags', category: 'meta' },
];

// Group fields by category for the filter builder dropdown
export const FIELD_CATEGORIES: { key: FieldCategory; label: string }[] = [
  { key: 'contact', label: 'Contact Info' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'lifecycle', label: 'Lifecycle Dates' },
  { key: 'messaging', label: 'Messaging' },
  { key: 'meta', label: 'Meta' },
  { key: 'custom', label: 'Custom' },
];

// ── Custom field merge ──────────────────────────────────────────

/**
 * Shape of a custom field that the filter engine can ingest. Matches
 * the relevant subset of CustomFieldDto in
 * `@/lib/contacts/custom-field-types` — we keep this interface local
 * so this module stays free of any cross-feature import.
 */
export interface FilterableCustomField {
  key: string;
  label: string;
  type: FieldType;
  /** Optional category override; defaults to 'custom'. */
  category?: string | null;
  /** For select / multiselect — the declared options. */
  options?: FieldOption[] | null;
}

/**
 * Merge the static built-in fields with an account's declared custom
 * fields. Custom fields are routed to the 'custom' category unless
 * the caller declared their own category label, in which case we
 * surface them in 'Custom' but display the user's category label on
 * the row chip (the filter UI keeps the dropdown grouping by category
 * key, not label). Custom-field types unknown to FieldType fall back
 * to 'text' so the UI doesn't crash on a stale row.
 */
export function getFilterableFields(
  customFields: FilterableCustomField[] | null | undefined,
): FieldDefinition[] {
  if (!customFields || customFields.length === 0) return FILTERABLE_FIELDS;
  const out: FieldDefinition[] = [...FILTERABLE_FIELDS];
  for (const cf of customFields) {
    if (!cf?.key) continue;
    out.push({
      key: cf.key,
      label: cf.label || cf.key,
      type: isValidFieldType(cf.type) ? cf.type : 'text',
      category: 'custom',
      isCustom: true,
      options: cf.options ?? undefined,
    });
  }
  return out;
}

const FIELD_TYPE_SET: ReadonlySet<FieldType> = new Set<FieldType>([
  'text',
  'number',
  'date',
  'tags',
  'boolean',
  'select',
  'multiselect',
]);

function isValidFieldType(value: unknown): value is FieldType {
  return typeof value === 'string' && FIELD_TYPE_SET.has(value as FieldType);
}
