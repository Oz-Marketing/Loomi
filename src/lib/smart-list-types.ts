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
  | 'multiselect'
  // Stored as text, comparable as a number. Vehicle year and mileage
  // arrive from CRM exports as strings ("72,500", "2019") and are stored
  // that way, but "mileage over 60,000" and "year between 2019 and 2022"
  // are core automotive segments that text operators can't express.
  //
  // This type offers BOTH families and dispatches on the operator, which
  // is what makes it additive: every saved segment using `contains` or
  // `equals` on these fields keeps working untouched. Re-typing them to
  // plain `number` would have invalidated those segments — and with the
  // engine now failing closed, invalid means "matches nobody", silently.
  | 'numeric_text'
  // A reference to another saved segment. The value is an Audience id.
  | 'segment_ref';

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

// Segment composition. `in_segment` / `not_in_segment` reference another
// saved segment by id; the referenced DEFINITION is evaluated against
// the same contact, so composition costs nothing extra at resolve time
// and can't drift from what the referenced segment means today.
export type SegmentRefOperator = 'in_segment' | 'not_in_segment';

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
  | SelectOperator
  | SegmentRefOperator;

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
  in_segment: 'is in segment',
  not_in_segment: 'is not in segment',
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
  segment_ref: ['in_segment', 'not_in_segment'],
  numeric_text: [
    'num_gte',
    'num_lte',
    'num_gt',
    'num_lt',
    'num_between',
    'num_equals',
    'num_not_equals',
    'contains',
    'equals',
    'not_equals',
    'is_empty',
    'is_not_empty',
  ],
};

// Operators that need no value input
export const NO_VALUE_OPERATORS: FilterOperator[] = ['is_empty', 'is_not_empty', 'overdue', 'is_true', 'is_false'];

// Operators that need BOTH bounds (`value` and `value2`). A range
// missing its upper bound is incomplete, not open-ended — the engine
// and the validator both treat it as a non-match / an error rather
// than silently comparing against one side.
export const RANGE_OPERATORS: FilterOperator[] = ['between', 'num_between'];

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
  | 'history'
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
  // Country is on the Contact row and is a required part of address-based
  // matching when a segment is pushed to an ad platform, so it's filterable.
  { key: 'country', label: 'Country', type: 'text', category: 'contact' },
  { key: 'source', label: 'Source', type: 'text', category: 'contact' },

  // Vehicle
  { key: 'vehicleYear', label: 'Vehicle Year', type: 'numeric_text', category: 'vehicle' },
  { key: 'vehicleMake', label: 'Vehicle Make', type: 'text', category: 'vehicle' },
  { key: 'vehicleModel', label: 'Vehicle Model', type: 'text', category: 'vehicle' },
  { key: 'vehicleVin', label: 'VIN', type: 'text', category: 'vehicle' },
  { key: 'vehicleMileage', label: 'Mileage', type: 'numeric_text', category: 'vehicle' },

  // Lifecycle dates
  { key: 'dateAdded', label: 'Date Added', type: 'date', category: 'lifecycle' },
  { key: 'purchaseDate', label: 'Purchase Date', type: 'date', category: 'lifecycle' },
  { key: 'lastServiceDate', label: 'Last Service Date', type: 'date', category: 'lifecycle' },
  { key: 'nextServiceDate', label: 'Next Service Date', type: 'date', category: 'lifecycle' },
  { key: 'leaseEndDate', label: 'Lease End Date', type: 'date', category: 'lifecycle' },
  { key: 'warrantyEndDate', label: 'Warranty End Date', type: 'date', category: 'lifecycle' },
  { key: 'dateOfBirth', label: 'Date of Birth', type: 'date', category: 'lifecycle' },

  // Messaging.
  //
  // The booleans are lifetime ("has EVER opened"), which decays toward
  // "everyone" as a roster ages — a 6-year-old contact who opened one
  // email in 2021 is not an engaged contact. They're kept because saved
  // segments reference them; the date fields below are what new segments
  // should use, since recency is the thing that actually predicts
  // response.
  { key: 'hasReceivedMessage', label: 'Has Received Any Message', type: 'boolean', category: 'messaging' },
  { key: 'hasReceivedEmail', label: 'Has Received Email', type: 'boolean', category: 'messaging' },
  { key: 'hasReceivedSms', label: 'Has Received SMS', type: 'boolean', category: 'messaging' },
  { key: 'hasOpenedEmail', label: 'Has Opened Email', type: 'boolean', category: 'messaging' },
  { key: 'hasClickedEmail', label: 'Has Clicked Email', type: 'boolean', category: 'messaging' },
  { key: 'lastMessageDate', label: 'Last Message Date', type: 'date', category: 'messaging' },
  { key: 'lastEmailDeliveredAt', label: 'Last Email Delivered', type: 'date', category: 'messaging' },
  { key: 'lastEmailOpenedAt', label: 'Last Email Opened', type: 'date', category: 'messaging' },
  { key: 'lastEmailClickedAt', label: 'Last Email Clicked', type: 'date', category: 'messaging' },
  { key: 'lastSmsAt', label: 'Last SMS Sent', type: 'date', category: 'messaging' },
  // Opt-out state. Visible here so a segment can SEE it — but note that
  // exports don't rely on anyone remembering to add these conditions:
  // the sync eligibility gate excludes opted-out and suppressed contacts
  // unconditionally (see src/lib/segments/eligibility.ts).
  { key: 'dndEmail', label: 'Opted Out of Email', type: 'boolean', category: 'messaging' },
  { key: 'dndSms', label: 'Opted Out of SMS', type: 'boolean', category: 'messaging' },

  // Purchase / service history — rolled up from ContactEvent.
  //
  // Labels say where the number comes from, because the lifecycle
  // section above has similar-sounding fields sourced from the CRM's
  // latest-value snapshot on the contact record. The two can disagree
  // and a dealer needs to know which one they're filtering on.
  { key: 'serviceVisitCount', label: 'Service Visits (lifetime count)', type: 'number', category: 'history' },
  { key: 'saleCount', label: 'Vehicles Purchased (lifetime count)', type: 'number', category: 'history' },
  { key: 'lifetimeSpend', label: 'Lifetime Spend ($)', type: 'number', category: 'history' },
  { key: 'lastServiceEventAt', label: 'Last Service Visit (from history)', type: 'date', category: 'history' },
  { key: 'firstServiceEventAt', label: 'First Service Visit (from history)', type: 'date', category: 'history' },
  { key: 'lastSaleEventAt', label: 'Last Purchase (from history)', type: 'date', category: 'history' },
  { key: 'firstSaleEventAt', label: 'First Purchase (from history)', type: 'date', category: 'history' },

  // Meta
  { key: 'tags', label: 'Tags', type: 'tags', category: 'meta' },
  // Static list membership. Options are injected per-account by
  // getFilterableFields (the ids are account-scoped, so there's no
  // meaningful static option list). Modelled as multiselect so it reuses
  // the tags operator family: includes_any / includes_all / excludes.
  //
  // `excludes` is the one that matters for ad audiences — it's how you
  // express "everyone in this segment EXCEPT the people on our
  // do-not-target list" without hand-maintaining a second segment.
  { key: 'listIds', label: 'List Membership', type: 'multiselect', category: 'meta' },
  // Segment composition. Options are injected per-account, like lists.
  //
  // This is what makes a suppression audience expressible: "everyone in
  // Lapsed Service, who is NOT in Recently Purchased". Without it, the
  // only way to exclude a cohort is to restate its conditions inline and
  // keep the two copies in sync by hand.
  { key: 'segmentRef', label: 'Segment', type: 'segment_ref', category: 'meta' },
];

// Group fields by category for the filter builder dropdown
export const FIELD_CATEGORIES: { key: FieldCategory; label: string }[] = [
  { key: 'contact', label: 'Contact Info' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'lifecycle', label: 'Lifecycle Dates' },
  { key: 'messaging', label: 'Messaging' },
  { key: 'history', label: 'Purchase & Service History' },
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
  lists?: Array<{ id: string; name: string }> | null,
  segments?: Array<{ id: string; name: string }> | null,
): FieldDefinition[] {
  if (
    (!customFields || customFields.length === 0) &&
    (!lists || lists.length === 0) &&
    (!segments || segments.length === 0)
  ) {
    return FILTERABLE_FIELDS;
  }
  const out: FieldDefinition[] = FILTERABLE_FIELDS.map((f) => {
    if (f.key === 'listIds' && lists?.length) {
      return { ...f, options: lists.map((l) => ({ value: l.id, label: l.name })) };
    }
    if (f.key === 'segmentRef' && segments?.length) {
      return { ...f, options: segments.map((sg) => ({ value: sg.id, label: sg.name })) };
    }
    return f;
  });
  if (!customFields || customFields.length === 0) return out;
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
  'numeric_text',
  'segment_ref',
]);

function isValidFieldType(value: unknown): value is FieldType {
  return typeof value === 'string' && FIELD_TYPE_SET.has(value as FieldType);
}
