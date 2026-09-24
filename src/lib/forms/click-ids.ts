/**
 * Ad-click ids on form submissions.
 *
 * Crediting a sale back to the ad that produced the lead (offline
 * conversion upload) needs the ad platform's own id for that click:
 *
 *   gclid    Google Ads auto-tagging.
 *   gbraid   Google Ads, in place of a gclid on some iOS traffic
 *   wbraid     (app-to-web and web-to-app respectively).
 *   fbclid   Meta.
 *   msclkid  Microsoft Advertising.
 *
 * They reach a submission two ways, in precedence order:
 *
 *   1. The form page's own URL, `/f/<slug>?gclid=…`. For an embedded form
 *      that is the loader copying them off the host page — and, when the
 *      host URL has no Google click, out of Google's `_gcl_*` cookies there
 *      (see `embed-loader.ts`).
 *   2. The `loomi_lp_click` cookie LpTracker writes when a visitor lands on
 *      a Loomi landing page with a click id, so a form further into that
 *      visit still carries it.
 *
 * Each network's click comes from ONE source. Google's three ids are
 * alternatives for the same click, so a gbraid on the URL is never paired
 * with an older gclid from a cookie — a fresh click beats a remembered one.
 *
 * Every value is untrusted — a host page we don't control, a cookie, a
 * direct POST to a CORS-open endpoint — and passes `sanitizeClickId`, which
 * drops (never repairs) anything that isn't a plausible id.
 */
import type { RawSearchParams } from './embed-params';

export const CLICK_ID_KEYS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid'] as const;

export type ClickIdKey = (typeof CLICK_ID_KEYS)[number];
export type ClickIds = Partial<Record<ClickIdKey, string>>;

/** Hidden submit-payload fields: `__loomi_click_gclid` etc. Shares the
 *  `__loomi_` namespace so it can't collide with a customer's field id. */
export const CLICK_ID_FIELD_PREFIX = '__loomi_click_';

/** Landing-page cookie carrying click ids across a visit. */
export const LP_CLICK_COOKIE = 'loomi_lp_click';

/** Google, Meta and Microsoft all keep a click attributable for 90 days. */
export const LP_CLICK_TTL_DAYS = 90;

export const MAX_CLICK_ID_LENGTH = 256;

const CLICK_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/** A network's ids travel together — see the precedence note above. */
const CLICK_ID_NETWORKS: readonly (readonly ClickIdKey[])[] = [
  ['gclid', 'gbraid', 'wbraid'],
  ['fbclid'],
  ['msclkid'],
];

/**
 * The value when it could be a real click id, else null. Too long or any
 * character outside `[A-Za-z0-9._-]` drops it outright: a truncated or
 * "cleaned" id would be a different id, and uploading it would credit
 * nothing (or the wrong click).
 */
export function sanitizeClickId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > MAX_CLICK_ID_LENGTH || !CLICK_ID_PATTERN.test(value)) return null;
  return value;
}

/** The recognized, valid ids out of any key → value map. */
export function sanitizeClickIds(raw: Record<string, unknown> | null | undefined): ClickIds {
  const out: ClickIds = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of CLICK_ID_KEYS) {
    const value = sanitizeClickId(raw[key]);
    if (value) out[key] = value;
  }
  return out;
}

/** Click ids off a public form URL, as Next hands `searchParams` to a page. */
export function parseClickIdParams(searchParams: RawSearchParams): ClickIds {
  const flat: Record<string, unknown> = {};
  for (const key of CLICK_ID_KEYS) {
    const value = searchParams[key];
    // Repeated params arrive as an array — take the first, like the rest
    // of the embed params.
    flat[key] = Array.isArray(value) ? value[0] : value;
  }
  return sanitizeClickIds(flat);
}

/** Click ids off a raw `location.search` string. */
export function clickIdsFromSearch(search: string): ClickIds {
  const params = new URLSearchParams(search);
  const flat: Record<string, unknown> = {};
  for (const key of CLICK_ID_KEYS) flat[key] = params.get(key) ?? undefined;
  return sanitizeClickIds(flat);
}

/**
 * Click ids from `primary` (this page's URL), with `fallback` (the LP
 * cookie) filling in any network `primary` has nothing for. A network is
 * taken whole from one side — never a URL gbraid with a cookie gclid.
 */
export function mergeClickIds(
  primary: ClickIds | null | undefined,
  fallback: ClickIds | null | undefined,
): ClickIds {
  const out: ClickIds = {};
  for (const network of CLICK_ID_NETWORKS) {
    const source = network.some((key) => primary?.[key]) ? primary : fallback;
    for (const key of network) {
      const value = source?.[key];
      if (value) out[key] = value;
    }
  }
  return out;
}

/** The LP cookie's JSON value back into click ids; `{}` when missing or bad. */
export function parseClickIdCookie(value: string | null | undefined): ClickIds {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return sanitizeClickIds(parsed as Record<string, unknown>);
  } catch {
    return {};
  }
}

/** Read the `loomi_lp_click` cookie in the browser; `{}` on the server. */
export function readLpClickCookie(): ClickIds {
  if (typeof document === 'undefined') return {};
  const target = `${LP_CLICK_COOKIE}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(target)) continue;
    try {
      return parseClickIdCookie(decodeURIComponent(trimmed.slice(target.length)));
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Pull the `__loomi_click_*` fields out of a submit payload — deleting
 * every one, known or not, so none reach `submission.data` — and keep the
 * valid ids. The browser already filtered them; this pass is the one that
 * counts, since the submit endpoint is public and CORS-open.
 */
export function takeClickIdFields(rawData: Record<string, unknown>): ClickIds {
  const collected: Record<string, unknown> = {};
  for (const field of Object.keys(rawData)) {
    if (!field.startsWith(CLICK_ID_FIELD_PREFIX)) continue;
    collected[field.slice(CLICK_ID_FIELD_PREFIX.length)] = rawData[field];
    delete rawData[field];
  }
  return sanitizeClickIds(collected);
}
