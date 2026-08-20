// Send-time mergetag substitution for email blasts.
//
// WHY THIS EXISTS
// ───────────────
// The template editor advertises a dotted mergetag namespace
// ({{contact.first_name}}, {{location.name}}, {{unsubscribe_link}}, …) and
// /api/preview substitutes it with sample data (see lib/preview-variables.ts),
// so a blast LOOKS personalized in the editor. But the blast worker used to
// render the stored HTML exactly once, outside the per-recipient loop, and
// substitute nothing — so every one of those tokens shipped to the inbox
// literally as `{{contact.first_name}}`. Flows hit the same bug earlier and
// fixed it in services/loomi-flows.ts; this is the blast-side equivalent.
//
// It deliberately does NOT reuse lib/flows/mergetags.ts: that pattern only
// matches bare identifiers ({{firstName}}), which is the flow builder's
// namespace. The email editor's namespace is dotted, so the two need
// different patterns. The token spellings here MUST stay in lockstep with
// buildPreviewVariableMap() in lib/preview-variables.ts — that function is
// what the user sees in preview, and any drift between the two means "looked
// right in preview, wrong in the inbox", which is the exact failure this
// module exists to prevent.

/** Dotted or bare identifier inside {{ }}, tolerant of inner whitespace. */
const BLAST_MERGETAG_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*\}\}/g;

/** Keys are bare (no braces), e.g. `contact.first_name`. */
export type BlastMergetagContext = Record<string, string>;

export interface BlastContactData {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  vehicleYear?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleVin?: string | null;
  vehicleMileage?: string | null;
  lastServiceDate?: Date | null;
  nextServiceDate?: Date | null;
  leaseEndDate?: Date | null;
  warrantyEndDate?: Date | null;
  purchaseDate?: Date | null;
  dateOfBirth?: Date | null;
  customFields?: unknown;
}

export interface BlastAccountData {
  dealer?: string | null;
  senderEmail?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  website?: string | null;
}

/**
 * Escape a substituted VALUE for HTML. Contact data is user-supplied (CSV
 * imports, form fills, CRM syncs) and lands inside an HTML document, so an
 * apostrophe in "O'Brien" or a stray `<` would otherwise corrupt the markup
 * — or worse, inject it. Values are escaped; the surrounding template HTML
 * is authored in Loomi and left alone.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** ISO date (YYYY-MM-DD) — matches what the preview map renders. */
function isoDate(value: Date | null | undefined): string {
  if (!value) return '';
  const time = value.getTime();
  if (Number.isNaN(time)) return '';
  return value.toISOString().slice(0, 10);
}

function str(value: string | null | undefined): string {
  return value == null ? '' : String(value);
}

/**
 * Build the substitution context for one recipient.
 *
 * `unsubscribeToken` is what {{unsubscribe_link}} resolves to. On the
 * SendGrid path that's SendGrid's own `[%unsubscribe_url%]` substitution
 * tag, which SendGrid swaps for a real hosted URL at delivery — so a
 * designer who wires a button to {{unsubscribe_link}} in the editor gets a
 * working, per-recipient unsubscribe link with no extra plumbing.
 */
export function buildBlastMergetagContext(input: {
  contact?: BlastContactData | null;
  account?: BlastAccountData | null;
  /** Fallback when the Contact row is gone but the recipient row remains. */
  recipientEmail?: string | null;
  recipientFullName?: string | null;
  unsubscribeToken: string;
  messageId?: string;
}): BlastMergetagContext {
  const c = input.contact;
  const a = input.account;

  const first = str(c?.firstName);
  const last = str(c?.lastName);
  const full =
    str(c?.fullName).trim()
    || `${first} ${last}`.trim()
    || str(input.recipientFullName).trim();

  const ctx: BlastMergetagContext = {
    'contact.first_name': first,
    'contact.last_name': last,
    'contact.full_name': full,
    'contact.email': str(c?.email) || str(input.recipientEmail),
    'contact.phone': str(c?.phone),
    'contact.address1': str(c?.address1),
    'contact.city': str(c?.city),
    'contact.state': str(c?.state),
    'contact.postal_code': str(c?.postalCode),
    'contact.country': str(c?.country),
    'contact.vehicle_year': str(c?.vehicleYear),
    'contact.vehicle_make': str(c?.vehicleMake),
    'contact.vehicle_model': str(c?.vehicleModel),
    'contact.vehicle_vin': str(c?.vehicleVin),
    'contact.vehicle_mileage': str(c?.vehicleMileage),
    'contact.last_service_date': isoDate(c?.lastServiceDate),
    'contact.next_service_date': isoDate(c?.nextServiceDate),
    'contact.lease_end_date': isoDate(c?.leaseEndDate),
    'contact.warranty_end_date': isoDate(c?.warrantyEndDate),
    'contact.purchase_date': isoDate(c?.purchaseDate),
    'contact.date_of_birth': isoDate(c?.dateOfBirth),

    'location.name': str(a?.dealer),
    'location.email': str(a?.senderEmail),
    'location.phone': str(a?.phone),
    'location.address': str(a?.address),
    'location.city': str(a?.city),
    'location.state': str(a?.state),
    'location.postal_code': str(a?.postalCode),
    'location.website': str(a?.website),

    unsubscribe_link: input.unsubscribeToken,
    'message.id': str(input.messageId),
  };

  // Custom CSV/CRM columns, addressable as {{custom_values.<key>}} to match
  // the editor's variable picker. Built-ins win on collision.
  const blob = c?.customFields;
  if (blob && typeof blob === 'object' && !Array.isArray(blob)) {
    for (const [key, value] of Object.entries(blob as Record<string, unknown>)) {
      if (value == null) continue;
      const token = `custom_values.${key}`;
      if (token in ctx) continue;
      ctx[token] = typeof value === 'string' ? value : String(value);
    }
  }

  return ctx;
}

export interface ApplyBlastMergetagsOptions {
  /**
   * HTML-escape substituted values. True for the HTML part, false for the
   * text/plain part (where escaping would render visible `&amp;`).
   */
  escape: boolean;
}

/**
 * Substitute `{{key}}` placeholders.
 *
 * A KNOWN key with an empty value resolves to an empty string — an
 * unpersonalized greeting reads better than a literal `{{contact.first_name}}`.
 * An UNKNOWN key is left intact, matching the flow renderer and the preview:
 * silently deleting it would hide the typo, and it's the one case a human
 * can still catch by proofreading. findUnknownMergetags() below exists so
 * preflight can catch it before a send instead.
 */
export function applyBlastMergetags(
  input: string,
  ctx: BlastMergetagContext,
  options: ApplyBlastMergetagsOptions,
): string {
  if (!input) return '';
  return input.replace(BLAST_MERGETAG_PATTERN, (match, rawKey: string) => {
    if (!(rawKey in ctx)) return match;
    const value = ctx[rawKey] ?? '';
    return options.escape ? escapeHtml(value) : value;
  });
}

/**
 * Mergetags in `input` that no context key satisfies — i.e. the ones that
 * would ship to the inbox as literal `{{…}}`. Used by preflight to block a
 * send on a typo'd or unsupported token.
 */
export function findUnknownMergetags(
  input: string,
  ctx: BlastMergetagContext,
): string[] {
  if (!input) return [];
  const unknown = new Set<string>();
  for (const match of input.matchAll(BLAST_MERGETAG_PATTERN)) {
    const key = match[1];
    if (!(key in ctx)) unknown.add(key);
  }
  return [...unknown];
}

/** Collapse spelling variations so near-misses can be compared. */
function normalizeTagKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Best guess at the tag a user MEANT when they typed an unknown one.
 *
 * Exists because the preflight blocker used to say only "check the variable
 * picker for the supported list", which is a scavenger hunt when the tag is
 * one prefix away from correct. The common cases are a namespace that
 * doesn't exist ({{email.unsubscribe_link}} → {{unsubscribe_link}}) and
 * camelCase where the namespace is snake_case ({{contact.firstName}} →
 * {{contact.first_name}}), so match on the last segment first and fall back
 * to comparing the whole key with punctuation stripped.
 *
 * Returns null rather than a bad guess — a wrong suggestion is worse than
 * none, because the user will try it.
 */
export function suggestMergetag(
  unknownKey: string,
  ctx: BlastMergetagContext,
): string | null {
  const validKeys = Object.keys(ctx);
  const lastSegment = (key: string) => key.split('.').pop() || key;
  const wantedTail = normalizeTagKey(lastSegment(unknownKey));
  if (!wantedTail) return null;

  const tailMatch = validKeys.find(
    (key) => normalizeTagKey(lastSegment(key)) === wantedTail,
  );
  if (tailMatch) return tailMatch;

  const wantedWhole = normalizeTagKey(unknownKey);
  return validKeys.find((key) => normalizeTagKey(key) === wantedWhole) || null;
}

/** Every mergetag key referenced by `input`, known or not. */
export function listMergetags(input: string): string[] {
  if (!input) return [];
  const found = new Set<string>();
  for (const match of input.matchAll(BLAST_MERGETAG_PATTERN)) {
    found.add(match[1]);
  }
  return [...found];
}
