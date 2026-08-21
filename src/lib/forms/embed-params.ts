/**
 * Query-string parameters for embedded forms.
 *
 * A form embedded on a third-party page (typically a Dealer.com VDP) can
 * pass page context into the form through the iframe's query string:
 *
 *   note_{fieldKey}  Overrides that field's help text for this page load
 *                    only. Display-only — never submitted, never stored.
 *   meta_{key}       Captured as submission metadata. Not rendered on the
 *                    form; travels with the submission so automations,
 *                    the CRM feed, and lead emails can read it.
 *
 * Everything here arrives from a page we don't control, so treat every
 * value as hostile:
 *
 *   - Values are stripped to printable ASCII (0x20–0x7E). That kills
 *     control characters, bidi/zero-width tricks, and anything that would
 *     break the ADF XML document downstream. It deliberately KEEPS `<`,
 *     `>`, `&`, and quotes — those are legitimate in a vehicle title — so
 *     every consumer must escape on output. React does this for us in the
 *     admin UI; `notify.ts` and `adf.ts` escape explicitly.
 *   - `note_` values cap at 128 chars, `meta_` at 256.
 *   - `meta_` keys must match /^[a-z0-9_]{1,40}$/ and the whole record
 *     caps at 20 keys, so a crafted URL can't bloat the submission row.
 *   - `note_` only applies to fields the form actually declares; unknown
 *     keys are dropped rather than accumulated.
 *
 * Parsing happens on the server in `/f/[slug]/page.tsx` so the first
 * render already carries the overridden help text — no flash of the
 * builder-authored default. The metadata rides to the submit endpoint as
 * `__loomi_meta_*` form fields, which the route re-sanitizes with these
 * same rules (a direct POST never touches this parser).
 */

export const NOTE_PARAM_PREFIX = 'note_';
export const META_PARAM_PREFIX = 'meta_';

/** Prefix for the hidden submit-payload fields that carry metadata from
 *  the browser to the API. Shares the `__loomi_` namespace with the LP
 *  attribution fields so it can't collide with a customer's field id. */
export const META_FIELD_PREFIX = '__loomi_meta_';

export const MAX_NOTE_LENGTH = 128;
export const MAX_META_VALUE_LENGTH = 256;
export const MAX_META_KEYS = 20;

const META_KEY_PATTERN = /^[a-z0-9_]{1,40}$/;

/** Anything outside printable ASCII, space through tilde. */
const NON_PRINTABLE_ASCII = /[^\x20-\x7E]+/g;

export interface EmbedParams {
  /** fieldKey → help text override. Only contains keys that exist on the form. */
  noteOverrides: Record<string, string>;
  /** Sanitized submission metadata, capped at {@link MAX_META_KEYS} entries. */
  metadata: Record<string, string>;
}

export const EMPTY_EMBED_PARAMS: EmbedParams = Object.freeze({
  noteOverrides: {},
  metadata: {},
});

/**
 * Strip to printable ASCII, collapse the surrounding whitespace, and cap
 * the length. Returns null when nothing usable survives — callers treat
 * that as "param absent" so the authored default wins.
 *
 * Trimming runs twice on purpose: once so the cap applies to real
 * content rather than leading spaces, and once after the slice so a cut
 * mid-space doesn't leave a trailing blank.
 */
export function sanitizeEmbedValue(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(NON_PRINTABLE_ASCII, '').trim().slice(0, maxLength).trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Query-string shape Next.js hands a server component, plus the plain
 *  `Record<string, string>` a URLSearchParams walk produces. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Repeated params (`?meta_vin=a&meta_vin=b`) arrive as an array. Take
 *  the first occurrence — deterministic, and matches how a browser form
 *  would resolve a duplicate. */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Parse `note_*` / `meta_*` out of a public form URL.
 *
 * `fieldNames` is the set of field keys the form actually declares
 * (`getFieldName` for every field block). A `note_` param naming
 * anything else is dropped — an embed pointed at the wrong form
 * shouldn't be able to grow the render payload.
 */
export function parseEmbedParams(
  searchParams: RawSearchParams,
  fieldNames: Iterable<string>,
): EmbedParams {
  const known = fieldNames instanceof Set ? fieldNames : new Set(fieldNames);
  const noteOverrides: Record<string, string> = {};
  const metadata: Record<string, string> = {};

  for (const [rawKey, rawValue] of Object.entries(searchParams)) {
    if (rawKey.startsWith(NOTE_PARAM_PREFIX)) {
      const fieldKey = rawKey.slice(NOTE_PARAM_PREFIX.length);
      if (!known.has(fieldKey)) continue;
      const value = sanitizeEmbedValue(firstValue(rawValue), MAX_NOTE_LENGTH);
      if (value) noteOverrides[fieldKey] = value;
      continue;
    }

    if (rawKey.startsWith(META_PARAM_PREFIX)) {
      // Stop collecting once we're full rather than truncating later, so
      // the cap is on what we ever hold in memory.
      if (Object.keys(metadata).length >= MAX_META_KEYS) continue;
      const metaKey = rawKey.slice(META_PARAM_PREFIX.length);
      if (!META_KEY_PATTERN.test(metaKey)) continue;
      const value = sanitizeEmbedValue(firstValue(rawValue), MAX_META_VALUE_LENGTH);
      if (value) metadata[metaKey] = value;
    }
  }

  return { noteOverrides, metadata };
}

/**
 * Re-apply the key/value rules to metadata arriving on a submit POST.
 *
 * The browser already sanitized these, but the submit endpoint is public
 * and cross-origin: anyone can POST `__loomi_meta_*` directly. This is
 * the check that actually protects the stored record.
 */
export function sanitizeMetadataRecord(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_META_KEYS) break;
    if (!META_KEY_PATTERN.test(key)) continue;
    const clean = sanitizeEmbedValue(value, MAX_META_VALUE_LENGTH);
    if (clean) out[key] = clean;
  }
  return out;
}

/** The five UTM fields `FormSubmission` stores, keyed as they arrive. */
export const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;

export type UtmKey = (typeof UTM_KEYS)[number];
export type UtmParams = Partial<Record<UtmKey, string>>;

/**
 * Pull `?utm_*` off a public form URL.
 *
 * A form embedded on a third-party page can't see the host page's URL —
 * it's a different origin. The embed loader copies the campaign params
 * onto the iframe's own URL (see `lib/forms/embed-loader.ts`), and this
 * is the end that reads them back. Without it the params ride along in
 * the address bar and land nowhere, and only visitors who passed through
 * a Loomi landing page (which sets the `loomi_lp_utm` cookie) carry any
 * attribution at all.
 *
 * Values go through the same sanitizer as `meta_*`: these arrive from a
 * page we don't control.
 */
export function parseUtmParams(searchParams: RawSearchParams): UtmParams {
  const out: UtmParams = {};
  for (const key of UTM_KEYS) {
    const value = sanitizeEmbedValue(
      firstValue(searchParams[`utm_${key}`]),
      MAX_META_VALUE_LENGTH,
    );
    if (value) out[key] = value;
  }
  return out;
}

/**
 * Read a persisted `FormSubmission.metadata` column back into a flat
 * string map. Rows written before this feature (and any hand-edited
 * JSON) come back as `{}` rather than throwing.
 */
export function readSubmissionMetadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}
