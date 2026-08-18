/**
 * Shared "active account" cookie — the single source of truth for which
 * sub-account (or Admin) the user is currently working in, SHARED across the
 * studio / app / reporting surfaces.
 *
 * localStorage can't sync across those subdomains (separate origins), so we
 * use a cookie scoped to the registrable parent domain in prod/staging
 * (`.loomilm.com`, mirroring the NextAuth session cookie in `lib/auth.ts`).
 * In local dev it falls back to a host-only cookie (same as auth), and the
 * existing `?account=<key>` cross-link param still hands the account off
 * between surfaces.
 *
 * Value is one of:
 *   - an account key            → account mode
 *   - ADMIN_VALUE (`__admin__`) → Admin mode (unresolved, pre-default)
 *   - ALL_VALUE (`__all__`)     → the all-accounts overview scope
 *   - `org:<id>`                → LEGACY organization selection; ignored
 *
 * Client read/write live here. Server reads the cookie directly via
 * `next/headers` cookies() using ACTIVE_ACCOUNT_COOKIE (no `document` access),
 * so this module stays import-safe in both environments.
 */

export const ACTIVE_ACCOUNT_COOKIE = 'loomi-active-account';
export const ADMIN_VALUE = '__admin__';
/**
 * The all-accounts overview scope — a DELIBERATE choice, unlike ADMIN_VALUE
 * which is only the unresolved state before a default account is opened. Kept
 * as its own value precisely so the two cannot be confused: the context resolves
 * `admin` into a real account on sight, and would do the same to this one if
 * they shared a value, bouncing anyone who picked the overview straight back out
 * of it.
 */
export const ALL_VALUE = '__all__';
/**
 * Prefix marking a LEGACY organization selection. Organizations were replaced
 * by the Account hierarchy; this stays only so a stale cookie in someone's
 * browser is recognised and discarded instead of read as an account key.
 */
export const ORG_PREFIX = 'org:';

/** True if `value` is a stale org selection left over from a previous session. */
export function parseOrgValue(value: string | null | undefined): string | null {
  if (!value || !value.startsWith(ORG_PREFIX)) return null;
  const id = value.slice(ORG_PREFIX.length);
  return id || null;
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Parent-domain attribute, mirroring the auth session cookie's scoping. */
function domainAttr(): string {
  if (typeof window === 'undefined') return '';
  // Everything in prod + staging lives under loomilm.com, so the registrable
  // domain is always loomilm.com — share the cookie across all subdomains.
  // Local dev (localhost / *.localhost) stays host-only.
  return window.location.hostname.endsWith('loomilm.com') ? '; Domain=.loomilm.com' : '';
}

/** Read the active-account cookie on the client. Returns null if unset. */
export function readActiveAccountCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${ACTIVE_ACCOUNT_COOKIE}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

/** Persist the active account (key or ADMIN_VALUE) on the client. */
export function writeActiveAccountCookie(value: string): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    `${ACTIVE_ACCOUNT_COOKIE}=${encodeURIComponent(value)}` +
    `; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${domainAttr()}${secure}`;
}

// ── Roll-up vs self, for a group account ──────────────────────────────────
//
// A group is an Account with children, and until now "is a group" WAS the
// answer to "does this scope span several accounts" — derived, binary, and
// therefore unanswerable when a group also advertises for itself. Young
// Automotive Group runs its own campaigns, so its own numbers have to be
// reachable, and the only way to ask that question is to make the scope a
// CHOICE rather than a property of the row.
//
// Stored in the same shared cookie style as the active account so a hop between
// Reporting, Projects and Studio does not silently change what you are looking
// at. Keyed by account, because the answer is per group: you may want YAG rolled
// up and another group on its own.

const SELF_SCOPE_COOKIE = 'loomi-self-scope';

/**
 * Parse the stored exception list.
 *
 * Split from the `document.cookie` read so the logic is testable — the test
 * environment is node, with no DOM, so anything touching `document` directly
 * can only be asserted by adding a DOM shim for one function's sake.
 */
export function parseSelfScope(cookieValue: string | null | undefined): Set<string> {
  if (!cookieValue) return new Set();
  return new Set(cookieValue.split(',').filter(Boolean));
}

/** Apply a change to the exception set, returning the value to store. */
export function nextSelfScope(
  current: Set<string>,
  accountKey: string,
  selfOnly: boolean,
): string {
  const keys = new Set(current);
  if (selfOnly) keys.add(accountKey);
  else keys.delete(accountKey);
  return [...keys].join(',');
}

function readSelfScopeCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${SELF_SCOPE_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Is this group account being viewed as ITSELF rather than rolled up? */
export function readSelfScope(accountKey: string | null): boolean {
  if (!accountKey) return false;
  return parseSelfScope(readSelfScopeCookie()).has(accountKey);
}

/**
 * Pin an account to self-only, or return it to rolling up.
 *
 * Stores the EXCEPTIONS rather than the state, so the default survives: a group
 * created tomorrow rolls up without needing a row, and clearing the cookie
 * restores the pre-toggle behavior for every account at once.
 */
export function writeSelfScope(accountKey: string, selfOnly: boolean): void {
  if (typeof document === 'undefined') return;
  const value = nextSelfScope(parseSelfScope(readSelfScopeCookie()), accountKey, selfOnly);
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    `${SELF_SCOPE_COOKIE}=${encodeURIComponent(value)}` +
    `; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${domainAttr()}${secure}`;
}
