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
// different patterns.
//
// PREVIEW == SEND
// ───────────────
// "Looked right in preview, wrong in the inbox" is the failure this module
// exists to prevent, so the preview no longer keeps its own copy of anything:
// lib/preview-variables.ts builds its map from contactMergeValues() and
// accountMergeValues() below, and substitutes and audits through the same
// parser and filters. What a tag means is defined once, here.
//
// SYNTAX
// ──────
//   {{contact.first_name}}                       a value
//   {{ contact.first_name | default: "there" }}  a fallback for a blank value
//   {{contact.first_name | upper}}               upper, lower, capitalize, title
//   {{custom_values.Trade In Value}}             custom keys match regardless of
//                                                case, spaces, _ and -
// A tag this module can't honor — an unknown key, an unknown filter, a broken
// argument — is left exactly as written so a typo stays visible, and
// analyzeMergetags() reports it so preflight can stop the send first.

import {
  accountMergeValues,
  CUSTOM_VALUES_PREFIX,
  normalizeMergeKey,
  parseJsonObject,
  type AccountMergeSource,
} from '@/lib/sending/account-merge-values';
import { decodeHtmlEntities, escapeHtml } from '@/lib/sending/html-entities';

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
  /** A Date from the database, or an ISO string from the contacts API. */
  lastServiceDate?: Date | string | null;
  nextServiceDate?: Date | string | null;
  leaseEndDate?: Date | string | null;
  warrantyEndDate?: Date | string | null;
  purchaseDate?: Date | string | null;
  dateOfBirth?: Date | string | null;
  customFields?: unknown;
}

/**
 * The account behind {{location.*}} and the account-backed
 * {{custom_values.*}} tags. See ./account-merge-values.ts for the mapping and
 * ./blast-account-data.ts for the loader that fills every field it reads.
 */
export type BlastAccountData = AccountMergeSource;

export const CONTACT_TOKEN_KEYS = [
  'contact.first_name',
  'contact.last_name',
  'contact.full_name',
  'contact.email',
  'contact.phone',
  'contact.address1',
  'contact.city',
  'contact.state',
  'contact.postal_code',
  'contact.country',
  'contact.vehicle_year',
  'contact.vehicle_make',
  'contact.vehicle_model',
  'contact.vehicle_vin',
  'contact.vehicle_mileage',
  'contact.last_service_date',
  'contact.next_service_date',
  'contact.lease_end_date',
  'contact.warranty_end_date',
  'contact.purchase_date',
  'contact.date_of_birth',
] as const;

/**
 * Tags whose value is a transport token (`[%unsubscribe_url%]`) that the
 * provider swaps for a real URL at delivery. Never URL-encoded: an encoded
 * token is a token SendGrid no longer recognizes, which breaks the one link
 * that legally has to work. `unsubscribe_url` is accepted as an alias because
 * the seeded library templates — and most other ESPs — spell it that way.
 */
const TRANSPORT_TOKEN_KEYS = new Set(['unsubscribe_link', 'unsubscribe_url']);

// ── Dates ───────────────────────────────────────────────────────────────

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** An ISO date or date-time — what the CSV importer stores for a custom date field. */
const ISO_DATE_LIKE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i;

const zoneValidity = new Map<string, boolean>();

function validTimeZone(zone: string | null | undefined): string | null {
  const trimmed = (zone || '').trim();
  if (!trimmed) return null;
  let ok = zoneValidity.get(trimmed);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
      ok = true;
    } catch {
      ok = false;
    }
    zoneValidity.set(trimmed, ok);
  }
  return ok ? trimmed : null;
}

function calendarDate(year: number, month: number, day: number): string {
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/**
 * A date as a US reader expects it: "October 31, 2026".
 *
 * Dates used to render as UTC ISO (`2026-10-31`), and anything rendered in a
 * US zone instead risks the classic off-by-one: a lease end imported as
 * "2026-10-31" is stored as midnight UTC, which is the evening of October 30
 * in Utah. A date-only value is a CALENDAR date, not an instant, so a bare
 * `YYYY-MM-DD` and a timestamp at exactly midnight UTC are both read straight
 * off the calendar. Only a value with a real time of day is an instant, and
 * that is placed on the account's own calendar day when its zone is known.
 */
export function formatMergeDate(
  value: Date | string | null | undefined,
  timeZone?: string | null,
): string {
  if (value === null || value === undefined) return '';
  let date: Date;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const dateOnly = ISO_DATE_ONLY.exec(trimmed);
    if (dateOnly) {
      return calendarDate(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
    }
    date = new Date(trimmed);
    // Not a date after all — show it the way it was typed.
    if (Number.isNaN(date.getTime())) return trimmed;
  } else {
    date = value;
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  }

  if (
    date.getUTCHours() === 0
    && date.getUTCMinutes() === 0
    && date.getUTCSeconds() === 0
    && date.getUTCMilliseconds() === 0
  ) {
    return calendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: validTimeZone(timeZone) ?? 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

// ── Values ──────────────────────────────────────────────────────────────

function clean(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/**
 * Render one custom-field value as text a customer can read.
 *
 * Contact custom fields are a loose JSON blob fed by CSV imports and CRM
 * syncs, so a value can be anything. `String(value)` turned an object into
 * "[object Object]" in a real inbox; arrays (multi-selects) join with commas,
 * an object contributes its `value` when it has one and is otherwise treated
 * as empty, booleans read as Yes/No, and ISO dates get the same friendly
 * format as the built-in date tags.
 */
export function stringifyMergeValue(value: unknown, timeZone?: string | null): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return ISO_DATE_LIKE.test(trimmed) ? formatMergeDate(trimmed, timeZone) : trimmed;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value instanceof Date) return formatMergeDate(value, timeZone);
  if (Array.isArray(value)) {
    return value
      .map((entry) => stringifyMergeValue(entry, timeZone))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'object') {
    const inner = (value as Record<string, unknown>).value;
    if (inner !== undefined && (inner === null || typeof inner !== 'object')) {
      return stringifyMergeValue(inner, timeZone);
    }
  }
  return '';
}

/** The {{contact.*}} values for one contact. Every key always present. */
export function contactMergeValues(
  contact?: BlastContactData | null,
  options: { timeZone?: string | null } = {},
): Record<string, string> {
  const c: BlastContactData = contact ?? {};
  const tz = options.timeZone;
  const first = clean(c.firstName);
  const last = clean(c.lastName);
  return {
    'contact.first_name': first,
    'contact.last_name': last,
    'contact.full_name': clean(c.fullName) || `${first} ${last}`.trim(),
    'contact.email': clean(c.email),
    'contact.phone': clean(c.phone),
    'contact.address1': clean(c.address1),
    'contact.city': clean(c.city),
    'contact.state': clean(c.state),
    'contact.postal_code': clean(c.postalCode),
    'contact.country': clean(c.country),
    'contact.vehicle_year': clean(c.vehicleYear),
    'contact.vehicle_make': clean(c.vehicleMake),
    'contact.vehicle_model': clean(c.vehicleModel),
    'contact.vehicle_vin': clean(c.vehicleVin),
    'contact.vehicle_mileage': clean(c.vehicleMileage),
    'contact.last_service_date': formatMergeDate(c.lastServiceDate, tz),
    'contact.next_service_date': formatMergeDate(c.nextServiceDate, tz),
    'contact.lease_end_date': formatMergeDate(c.leaseEndDate, tz),
    'contact.warranty_end_date': formatMergeDate(c.warrantyEndDate, tz),
    'contact.purchase_date': formatMergeDate(c.purchaseDate, tz),
    'contact.date_of_birth': formatMergeDate(c.dateOfBirth, tz),
  };
}

/**
 * Lay a contact's custom fields over `ctx` as {{custom_values.<key>}}.
 *
 * Resolution order for custom_values.X: the contact's own field X when it has
 * a value, else the account's custom value X, else empty. Keys are matched
 * normalized, so a contact column `Trade In Value` overrides an account value
 * saved as `trade_in_value` rather than becoming a second tag beside it. A
 * blank contact cell never erases the account's value. Mutates and returns
 * `ctx`.
 */
export function applyContactCustomFields(
  ctx: BlastMergetagContext,
  customFields: unknown,
  options: { timeZone?: string | null } = {},
): BlastMergetagContext {
  const fields = parseJsonObject(customFields);
  if (!fields) return ctx;

  const byNormalized = new Map<string, string>();
  for (const key of Object.keys(ctx)) {
    if (!key.startsWith(CUSTOM_VALUES_PREFIX)) continue;
    const norm = normalizeMergeKey(key.slice(CUSTOM_VALUES_PREFIX.length));
    if (norm && !byNormalized.has(norm)) byNormalized.set(norm, key);
  }

  for (const [rawKey, rawValue] of Object.entries(fields)) {
    const key = rawKey.trim();
    const norm = normalizeMergeKey(key);
    if (!norm) continue;
    const value = stringifyMergeValue(rawValue, options.timeZone);
    const existing = byNormalized.get(norm);
    if (existing) {
      if (value) ctx[existing] = value;
      continue;
    }
    const token = `${CUSTOM_VALUES_PREFIX}${key}`;
    ctx[token] = value;
    byNormalized.set(norm, token);
  }
  return ctx;
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
  const timeZone = input.account?.timezone ?? null;
  const ctx: BlastMergetagContext = {
    ...contactMergeValues(input.contact, { timeZone }),
    ...accountMergeValues(input.account),
    unsubscribe_link: input.unsubscribeToken,
    unsubscribe_url: input.unsubscribeToken,
    'message.id': clean(input.messageId),
  };
  if (!ctx['contact.full_name']) {
    ctx['contact.full_name'] = clean(input.recipientFullName);
  }
  if (!ctx['contact.email']) ctx['contact.email'] = clean(input.recipientEmail);
  return applyContactCustomFields(ctx, input.contact?.customFields, { timeZone });
}

// ── Parsing ─────────────────────────────────────────────────────────────

/**
 * Anything between double braces. Deliberately broad: a tag the engine can't
 * honor still has to be FOUND, or it ships literally with no warning — which
 * is exactly how `{{contact.first_name | upper}}` (a seeded library template)
 * and Handlebars-style `{{#if}}` blocks used to reach inboxes.
 */
const TAG_PATTERN = /\{\{([^{}]{0,1000})\}\}/g;

/** Supported filters and how many arguments each takes. */
const FILTER_ARITY: Record<string, number> = {
  default: 1,
  upper: 0,
  lower: 0,
  capitalize: 0,
  title: 0,
};
export const SUPPORTED_MERGETAG_FILTERS = Object.keys(FILTER_ARITY);

/**
 * Quote characters a filter argument may be wrapped in. Rich-text editing and
 * copy-paste from a document turn `"there"` into curly quotes, which must
 * still read as quotes.
 */
const DOUBLE_QUOTES = '"\u{201c}\u{201d}\u{201e}\u{201f}\u{2033}';
const SINGLE_QUOTES = "'\u{2018}\u{2019}\u{201a}\u{201b}\u{2032}";

export interface MergetagFilterCall {
  name: string;
  args: string[];
}

export type MergetagProblemKind =
  | 'unknown_key'
  | 'unknown_filter'
  | 'bad_filter_args'
  | 'malformed';

export interface ParsedMergetag {
  /** The tag as written — entities decoded, whitespace collapsed. */
  source: string;
  /** `contact.first_name`, `custom_values.Trade In Value`, … '' when unreadable. */
  key: string;
  filters: MergetagFilterCall[];
  /** Why the tag can't be honored, independent of any context. */
  problem: { kind: Exclude<MergetagProblemKind, 'unknown_key'>; filter?: string } | null;
}

function quoteKind(ch: string): 'double' | 'single' | null {
  if (DOUBLE_QUOTES.includes(ch)) return 'double';
  if (SINGLE_QUOTES.includes(ch)) return 'single';
  return null;
}

/** Split on `separator` outside quotes. Null when a quote never closes. */
function splitOutsideQuotes(text: string, separator: string): string[] | null {
  const parts: string[] = [];
  let current = '';
  let open: 'double' | 'single' | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (open) {
      current += ch;
      if (ch === '\\' && i + 1 < text.length) {
        current += text[i + 1];
        i += 1;
      } else if (quoteKind(ch) === open) {
        open = null;
      }
      continue;
    }
    const kind = quoteKind(ch);
    if (kind) {
      open = kind;
      current += ch;
      continue;
    }
    if (ch === separator) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (open) return null;
  parts.push(current);
  return parts;
}

/** A filter's arguments: quoted strings or numbers. Null when unreadable. */
function parseFilterArgs(text: string): string[] | null {
  const pieces = splitOutsideQuotes(text, ',');
  if (!pieces) return null;
  const args: string[] = [];
  for (const piece of pieces) {
    const p = piece.trim();
    if (!p) return null;
    const open = quoteKind(p[0]);
    if (open) {
      // The matching close must be the last character — `"a" "b"` is not one
      // argument.
      let close = -1;
      for (let i = 1; i < p.length; i += 1) {
        if (p[i] === '\\') {
          i += 1;
          continue;
        }
        if (quoteKind(p[i]) === open) {
          close = i;
          break;
        }
      }
      if (close !== p.length - 1) return null;
      args.push(p.slice(1, -1).replace(/\\(.)/g, '$1'));
    } else if (/^-?\d+(?:\.\d+)?$/.test(p)) {
      args.push(p);
    } else {
      // An unquoted word. Liquid would read it as a variable; guessing that
      // it was meant as text would make `default: contact.nickname` render
      // the words "contact.nickname".
      return null;
    }
  }
  return args;
}

function parsePath(path: string): string {
  const trimmed = path.trim();
  const custom = /^custom_values\s*\.\s*([\s\S]+)$/i.exec(trimmed);
  if (custom) {
    const rest = custom[1].trim();
    return rest ? `${CUSTOM_VALUES_PREFIX}${rest}` : '';
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(trimmed)) return trimmed;
  // A near-miss ("contact.first name", "contact.first-name") is still a key
  // the user meant to type: keep it, so it is reported as unknown WITH a
  // suggestion. Real template syntax ({{#if x}}, {{ fn(1) }}) is not a key.
  if (/^[A-Za-z_][A-Za-z0-9_ .-]*$/.test(trimmed)) return trimmed;
  return '';
}

/** Parse the text between `{{` and `}}`. Never throws. */
export function parseMergetag(inner: string): ParsedMergetag {
  // Rendered HTML escapes the quotes in `default: "there"` to &quot;, so the
  // tag is read decoded. Outside HTML there is nothing to decode.
  const decoded = decodeHtmlEntities(inner).trim();
  const source = decoded.replace(/\s+/g, ' ');
  if (!decoded) return { source, key: '', filters: [], problem: { kind: 'malformed' } };

  // The key can't contain a pipe, and it MAY contain an apostrophe
  // ({{custom_values.Salesperson’s Name}}), so quotes only count after it.
  const pipe = decoded.indexOf('|');
  const key = parsePath(pipe === -1 ? decoded : decoded.slice(0, pipe));
  if (!key) return { source, key: '', filters: [], problem: { kind: 'malformed' } };
  if (pipe === -1) return { source, key, filters: [], problem: null };

  const segments = splitOutsideQuotes(decoded.slice(pipe + 1), '|');
  if (!segments) {
    return { source, key, filters: [], problem: { kind: 'bad_filter_args' } };
  }
  const filters: MergetagFilterCall[] = [];
  for (const segment of segments) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::([\s\S]*))?$/.exec(segment);
    if (!match) {
      return {
        source,
        key,
        filters: [],
        problem: { kind: 'unknown_filter', filter: segment.trim() || '(empty)' },
      };
    }
    const name = match[1].toLowerCase();
    // Own-property check: `| constructor` must not find Object.prototype.
    if (!Object.prototype.hasOwnProperty.call(FILTER_ARITY, name)) {
      return { source, key, filters: [], problem: { kind: 'unknown_filter', filter: match[1] } };
    }
    const args = match[2] === undefined ? [] : parseFilterArgs(match[2]);
    if (!args || args.length !== FILTER_ARITY[name]) {
      return { source, key, filters: [], problem: { kind: 'bad_filter_args', filter: name } };
    }
    filters.push({ name, args });
  }
  return { source, key, filters, problem: null };
}

// ── Resolution ──────────────────────────────────────────────────────────

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * A lookup bound to one context. Own properties only — `rawKey in ctx` used to
 * find Object.prototype, so {{constructor}} or {{toString}} resolved to a
 * function and threw for every recipient. Custom keys fall back to the
 * normalized comparison; built-in keys stay exact so a typo is caught.
 */
function makeResolver(ctx: BlastMergetagContext): (key: string) => string | undefined {
  let customIndex: Map<string, string> | null = null;
  return (key: string) => {
    if (hasOwn(ctx, key)) {
      const value: unknown = ctx[key];
      return typeof value === 'string' ? value : value == null ? '' : String(value);
    }
    if (!key.startsWith(CUSTOM_VALUES_PREFIX)) return undefined;
    if (!customIndex) {
      customIndex = new Map();
      for (const existing of Object.keys(ctx)) {
        if (!existing.startsWith(CUSTOM_VALUES_PREFIX)) continue;
        const norm = normalizeMergeKey(existing.slice(CUSTOM_VALUES_PREFIX.length));
        if (norm && !customIndex.has(norm)) customIndex.set(norm, existing);
      }
    }
    const hit = customIndex.get(normalizeMergeKey(key.slice(CUSTOM_VALUES_PREFIX.length)));
    if (hit === undefined) return undefined;
    const value: unknown = ctx[hit];
    return typeof value === 'string' ? value : value == null ? '' : String(value);
  };
}

/** The raw (pre-filter) value of `key` in `ctx`, or undefined when unknown. */
export function resolveMergetagValue(
  ctx: BlastMergetagContext,
  key: string,
): string | undefined {
  return makeResolver(ctx)(key);
}

function capitalizeFirst(value: string): string {
  const index = value.search(/\S/);
  if (index === -1) return value;
  const first = String.fromCodePoint(value.codePointAt(index)!);
  return value.slice(0, index) + first.toLocaleUpperCase('en-US') + value.slice(index + first.length);
}

function titleCase(value: string): string {
  // Lower first so a CRM's ALL-CAPS "JOHN SMITH" reads "John Smith".
  return value
    .toLocaleLowerCase('en-US')
    .replace(/(^|[\s\-/(])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toLocaleUpperCase('en-US'));
}

/** Run a parsed filter pipeline over a value. */
export function applyMergetagFilters(value: string, filters: MergetagFilterCall[]): string {
  let out = value;
  for (const filter of filters) {
    switch (filter.name) {
      case 'default':
        if (!out.trim()) out = filter.args[0] ?? '';
        break;
      case 'upper':
        out = out.toLocaleUpperCase('en-US');
        break;
      case 'lower':
        out = out.toLocaleLowerCase('en-US');
        break;
      case 'capitalize':
        out = capitalizeFirst(out);
        break;
      case 'title':
        out = titleCase(out);
        break;
      default:
        break;
    }
  }
  return out;
}

/** The final text of a tag, or null when it must be left as written. */
function renderTag(
  parsed: ParsedMergetag,
  resolve: (key: string) => string | undefined,
): string | null {
  if (parsed.problem) return null;
  const raw = resolve(parsed.key);
  if (raw === undefined) return null;
  return applyMergetagFilters(raw, parsed.filters);
}

// ── URL-aware output ────────────────────────────────────────────────────

/**
 * Replace lone surrogates, which make encodeURIComponent throw. With the `u`
 * flag a valid pair is ONE code point, so the range only matches the halves
 * that have no partner.
 */
function wellFormed(value: string): string {
  return value.replace(/[\u{d800}-\u{dfff}]/gu, '\u{fffd}');
}

/** For a value inside a query string or fragment: encode everything. */
function encodeQueryValue(value: string): string {
  return encodeURIComponent(wellFormed(value));
}

const URL_SAFE_CHAR = /[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=]/;

/**
 * For a value inside a URL's path: encode only what a URL can't carry (spaces,
 * quotes, non-ASCII), keep its structure, and leave an existing `%XX` escape
 * alone rather than double-encoding it.
 */
function encodeUrlPathValue(value: string): string {
  const s = wellFormed(value);
  let out = '';
  for (let i = 0; i < s.length; ) {
    const ch = String.fromCodePoint(s.codePointAt(i)!);
    if (ch === '%') {
      out += /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3)) ? '%' : '%25';
    } else if (URL_SAFE_CHAR.test(ch)) {
      out += ch;
    } else {
      out += encodeURIComponent(ch);
    }
    i += ch.length;
  }
  return out;
}

const BARE_HOST =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#]|$)/i;

/**
 * Give a scheme-less web address one. Account websites are often stored as
 * "dealer.com", and `href="dealer.com"` is a RELATIVE link — it resolves
 * against wherever the email is being read and goes nowhere useful.
 */
export function withUrlScheme(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (BARE_HOST.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

/** A value that opens a URL attribute: it supplies the scheme and host. */
function urlStartValue(value: string, attribute: string): string {
  // Browsers ignore control characters and whitespace inside a scheme, so
  // "java\tscript:" has to be caught the same way.
  const probe = value.replace(/[\u{0}-\u{20}]+/gu, '').toLowerCase();
  if (probe.startsWith('javascript:') || probe.startsWith('vbscript:')) return '';
  if (attribute === 'href' && probe.startsWith('data:')) return '';
  return withUrlScheme(value);
}

type UrlPosition = 'start' | 'path' | 'query';

function urlPositionInAttribute(before: string): UrlPosition {
  if (!before.trim()) return 'start';
  // Decode first: `&#39;` in a path contains a `#` that is not a fragment.
  return /[?#]/.test(decodeHtmlEntities(before)) ? 'query' : 'path';
}

/** Is the tag at `offset` part of a URL written out in plain text? */
function urlPositionInText(text: string, offset: number): UrlPosition | null {
  const before = text.slice(Math.max(0, offset - 2048), offset);
  const token = /[^\s()<>"]*$/.exec(before)?.[0] ?? '';
  if (!/^(?:https?:\/\/|mailto:|tel:|sms:)/i.test(token)) return null;
  return /[?#]/.test(token) ? 'query' : 'path';
}

function encodeForUrlPosition(value: string, position: UrlPosition, attribute: string): string {
  if (position === 'query') return encodeQueryValue(value);
  if (position === 'path') return encodeUrlPathValue(value);
  return urlStartValue(value, attribute);
}

/** Matches a URL-bearing attribute OR a bare tag, so one pass sees both. */
const HTML_SCAN =
  /(\s(?:href|src|background|poster)\s*=\s*)(?:"([^"]*)"|'([^']*)')|\{\{([^{}]{0,1000})\}\}/gi;

// ── Substitution ────────────────────────────────────────────────────────

export interface ApplyBlastMergetagsOptions {
  /**
   * True for HTML (the body): values are HTML-escaped, and a tag inside an
   * href/src attribute is URL-encoded for where it sits. False for plain text
   * (the subject, preview text, the text/plain part, SMS), where escaping
   * would render a visible `&amp;`.
   */
  escape: boolean;
}

function substituteInUrlAttribute(
  attrValue: string,
  attribute: string,
  resolve: (key: string) => string | undefined,
): string {
  return attrValue.replace(TAG_PATTERN, (match, inner: string, offset: number) => {
    const parsed = parseMergetag(inner);
    const value = renderTag(parsed, resolve);
    if (value === null) return match;
    if (TRANSPORT_TOKEN_KEYS.has(parsed.key)) return escapeHtml(value);

    const before = attrValue.slice(0, offset);
    const after = attrValue.slice(offset + match.length);
    let out = encodeForUrlPosition(value, urlPositionInAttribute(before), attribute);
    // {{location.website}}/service with a website saved as "https://x.com/".
    if (!before.trim() && out.endsWith('/') && after.startsWith('/')) out = out.slice(0, -1);
    return escapeHtml(out);
  });
}

/**
 * Substitute `{{…}}` tags.
 *
 * A KNOWN key with an empty value resolves to an empty string (or its
 * `default:`) — an unpersonalized greeting reads better than a literal
 * `{{contact.first_name}}`. An UNKNOWN key, an unknown filter or a broken
 * argument is left intact, matching the preview: silently deleting it would
 * hide the typo, and it's the one case a human can still catch by
 * proofreading. analyzeMergetags() exists so preflight catches it first.
 *
 * Substituted values are never re-scanned, so a contact whose name is
 * literally "{{location.email}}" stays that string.
 */
export function applyBlastMergetags(
  input: string,
  ctx: BlastMergetagContext,
  options: ApplyBlastMergetagsOptions,
): string {
  if (!input) return '';
  const resolve = makeResolver(ctx);

  if (options.escape) {
    return input.replace(
      HTML_SCAN,
      (
        match: string,
        attrPrefix: string | undefined,
        doubleQuoted: string | undefined,
        singleQuoted: string | undefined,
        inner: string | undefined,
      ) => {
        if (attrPrefix !== undefined) {
          const value = doubleQuoted ?? singleQuoted ?? '';
          if (!value.includes('{{')) return match;
          const quote = doubleQuoted !== undefined ? '"' : "'";
          const attribute = (/([A-Za-z]+)\s*=\s*$/.exec(attrPrefix)?.[1] ?? 'href').toLowerCase();
          return `${attrPrefix}${quote}${substituteInUrlAttribute(value, attribute, resolve)}${quote}`;
        }
        const parsed = parseMergetag(inner ?? '');
        const value = renderTag(parsed, resolve);
        return value === null ? match : escapeHtml(value);
      },
    );
  }

  return input.replace(TAG_PATTERN, (match, inner: string, offset: number, whole: string) => {
    const parsed = parseMergetag(inner);
    const value = renderTag(parsed, resolve);
    if (value === null) return match;
    if (TRANSPORT_TOKEN_KEYS.has(parsed.key)) return value;
    const position = urlPositionInText(whole, offset);
    return position ? encodeForUrlPosition(value, position, 'href') : value;
  });
}

// ── Analysis ────────────────────────────────────────────────────────────

export interface MergetagProblem {
  kind: MergetagProblemKind;
  /** The tag as written, without braces. */
  tag: string;
  /** The key it names ('' when unreadable). */
  key: string;
  /** The offending filter, for filter problems. */
  filter?: string;
}

/**
 * Every tag in `input` that would ship to the inbox as literal `{{…}}` text,
 * and why. Deduplicated, in order of first appearance.
 */
export function analyzeMergetags(
  input: string,
  ctx: BlastMergetagContext,
): MergetagProblem[] {
  if (!input) return [];
  const resolve = makeResolver(ctx);
  const seen = new Set<string>();
  const problems: MergetagProblem[] = [];
  for (const match of input.matchAll(TAG_PATTERN)) {
    const parsed = parseMergetag(match[1]);
    let problem: MergetagProblem | null = null;
    if (parsed.problem) {
      problem = {
        kind: parsed.problem.kind,
        tag: parsed.source,
        key: parsed.key,
        ...(parsed.problem.filter ? { filter: parsed.problem.filter } : {}),
      };
    } else if (resolve(parsed.key) === undefined) {
      problem = { kind: 'unknown_key', tag: parsed.source, key: parsed.key };
    }
    if (!problem) continue;
    const id = `${problem.kind}|${problem.tag}`;
    if (seen.has(id)) continue;
    seen.add(id);
    problems.push(problem);
  }
  return problems;
}

/**
 * Mergetags in `input` that no context key satisfies — i.e. the ones that
 * would ship to the inbox as literal `{{…}}`. An unknown key is reported as
 * its key; a filter or syntax problem as the whole tag, since the key itself
 * may be fine. Prefer analyzeMergetags() for the reason.
 */
export function findUnknownMergetags(
  input: string,
  ctx: BlastMergetagContext,
): string[] {
  const out = new Set<string>();
  for (const problem of analyzeMergetags(input, ctx)) {
    out.add(problem.kind === 'unknown_key' ? problem.key : problem.tag);
  }
  return [...out];
}

export interface MergetagOccurrence {
  parsed: ParsedMergetag;
  /** `href`, `src`, … when the tag sits inside a URL attribute; else null. */
  attribute: string | null;
  /** True when the tag is that attribute's entire value. */
  wholeAttribute: boolean;
}

/**
 * Every tag occurrence in `input`, with where it sits. `html: true` reads URL
 * attributes the way applyBlastMergetags() does, so a caller can tell a tag
 * that IS a link from one inside a sentence.
 */
export function scanMergetags(
  input: string,
  options: { html?: boolean } = {},
): MergetagOccurrence[] {
  if (!input) return [];
  const out: MergetagOccurrence[] = [];
  if (!options.html) {
    for (const match of input.matchAll(TAG_PATTERN)) {
      out.push({ parsed: parseMergetag(match[1]), attribute: null, wholeAttribute: false });
    }
    return out;
  }
  for (const match of input.matchAll(HTML_SCAN)) {
    const [, attrPrefix, doubleQuoted, singleQuoted, inner] = match;
    if (attrPrefix === undefined) {
      out.push({ parsed: parseMergetag(inner ?? ''), attribute: null, wholeAttribute: false });
      continue;
    }
    const value = doubleQuoted ?? singleQuoted ?? '';
    if (!value.includes('{{')) continue;
    const attribute = (/([A-Za-z]+)\s*=\s*$/.exec(attrPrefix)?.[1] ?? 'href').toLowerCase();
    for (const tag of value.matchAll(TAG_PATTERN)) {
      out.push({
        parsed: parseMergetag(tag[1]),
        attribute,
        wholeAttribute: tag[0].length === value.trim().length,
      });
    }
  }
  return out;
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
 * doesn't exist ({{email.unsubscribe_link}} → {{unsubscribe_link}}), a
 * namespace flattened into the key ({{vehicle.year}} →
 * {{contact.vehicle_year}}), and camelCase where the namespace is snake_case
 * ({{contact.firstName}} → {{contact.first_name}}). When the namespace DOES
 * exist the guess stays inside it: {{contact.name}} must not become
 * {{location.name}}, the dealership.
 *
 * Returns null rather than a bad guess — a wrong suggestion is worse than
 * none, because the user will try it.
 */
export function suggestMergetag(
  unknownKey: string,
  ctx: BlastMergetagContext,
): string | null {
  const validKeys = Object.keys(ctx);
  const namespaceOf = (key: string) => (key.includes('.') ? key.slice(0, key.indexOf('.')) : '');
  const lastSegment = (key: string) => key.split('.').pop() || key;

  const wantedNamespace = namespaceOf(unknownKey);
  const namespaces = new Set(validKeys.map(namespaceOf));
  const pool = wantedNamespace && namespaces.has(wantedNamespace)
    ? validKeys.filter((key) => namespaceOf(key) === wantedNamespace)
    : validKeys;

  const wantedTail = normalizeTagKey(lastSegment(unknownKey));
  if (!wantedTail) return null;
  const wantedWhole = normalizeTagKey(unknownKey);

  return (
    pool.find((key) => normalizeTagKey(lastSegment(key)) === wantedTail)
    ?? validKeys.find((key) => normalizeTagKey(key) === wantedWhole)
    ?? pool.find((key) => normalizeTagKey(lastSegment(key)) === wantedWhole)
    ?? null
  );
}

/** Every mergetag key referenced by `input`, known or not. */
export function listMergetags(input: string): string[] {
  if (!input) return [];
  const found = new Set<string>();
  for (const match of input.matchAll(TAG_PATTERN)) {
    const parsed = parseMergetag(match[1]);
    if (parsed.key) found.add(parsed.key);
  }
  return [...found];
}
