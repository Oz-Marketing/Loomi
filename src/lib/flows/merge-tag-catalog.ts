/**
 * Catalog of merge tags offered by the flow editor's "Custom Tags" picker,
 * plus helpers for detecting/labelling tokens in the inspector UI.
 *
 * IMPORTANT: this list is deliberately limited to the keys that the flow
 * renderer actually substitutes at send time — see `mergetagCtx()` in
 * `src/lib/services/loomi-flows.ts`. Offering a tag the renderer doesn't
 * resolve would emit a literal `{{token}}` in the sent message, so the
 * built-ins below must stay in sync with that context builder. Account
 * custom fields resolve via the `customFields` spread (snake_case keys) and
 * are merged in at runtime from the account's declared fields.
 */

export interface FlowTag {
  /** Bare token key, e.g. `firstName` or a custom field's snake_case key. */
  key: string;
  label: string;
  group: string;
}

/** Built-in tags that `mergetagCtx` resolves today. Keep in sync. */
export const FLOW_BUILTIN_TAGS: FlowTag[] = [
  // Contact
  { key: 'firstName', label: 'First Name', group: 'Contact' },
  { key: 'lastName', label: 'Last Name', group: 'Contact' },
  { key: 'fullName', label: 'Full Name', group: 'Contact' },
  { key: 'email', label: 'Email', group: 'Contact' },
  { key: 'phone', label: 'Phone', group: 'Contact' },
  // Vehicle
  { key: 'vehicleYear', label: 'Vehicle Year', group: 'Vehicle' },
  { key: 'vehicleMake', label: 'Vehicle Make', group: 'Vehicle' },
  { key: 'vehicleModel', label: 'Vehicle Model', group: 'Vehicle' },
  // Lifecycle
  { key: 'dateOfBirth', label: 'Date of Birth', group: 'Lifecycle' },
  // System (handy in webhook payloads)
  { key: 'contactId', label: 'Contact ID', group: 'System' },
  { key: 'accountKey', label: 'Account Key', group: 'System' },
  { key: 'flowId', label: 'Flow ID', group: 'System' },
  { key: 'enrollmentId', label: 'Enrollment ID', group: 'System' },
];

/** Order groups are shown in the picker dropdown. */
export const FLOW_TAG_GROUP_ORDER = ['Contact', 'Vehicle', 'Lifecycle', 'Custom', 'System'];

/** Wrap a bare key into its insertable token. */
export function tokenFor(key: string): string {
  return `{{${key}}}`;
}

// Splitting variant (whole token captured) — mirrors FLOW_MERGETAG_PATTERN
// in src/lib/flows/mergetags.ts so what we highlight matches what renders.
export const MERGETAG_SPLIT_PATTERN = /(\{\{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\}\})/g;
// Matches a single token and captures the bare key.
export const MERGETAG_KEY_PATTERN = /^\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}$/;

/** Extract the bare key from a token string, or null if not a token. */
export function tokenKey(segment: string): string | null {
  const m = segment.match(MERGETAG_KEY_PATTERN);
  return m ? m[1] : null;
}

/**
 * Build a key→label lookup for rendering pills: built-ins plus the account's
 * declared custom fields. Unknown keys (typos / unsupported) fall through to
 * the raw key at the call site.
 */
export function buildTagLabelMap(
  customFields?: { key: string; label: string }[] | null,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const t of FLOW_BUILTIN_TAGS) map[t.key] = t.label;
  for (const cf of customFields ?? []) {
    if (cf?.key) map[cf.key] = cf.label || cf.key;
  }
  return map;
}
