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
 *   - ADMIN_VALUE (`__admin__`) → Admin mode
 *   - `org:<organizationId>`    → organization (roll-up) mode
 *
 * Client read/write live here. Server reads the cookie directly via
 * `next/headers` cookies() using ACTIVE_ACCOUNT_COOKIE (no `document` access),
 * so this module stays import-safe in both environments.
 */

export const ACTIVE_ACCOUNT_COOKIE = 'loomi-active-account';
export const ADMIN_VALUE = '__admin__';
/** Prefix marking an organization (roll-up) selection in the cookie value. */
export const ORG_PREFIX = 'org:';

/** Encode an organization id into its cookie value. */
export function encodeOrgValue(organizationId: string): string {
  return `${ORG_PREFIX}${organizationId}`;
}

/** Return the organization id if `value` is an org selection, else null. */
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
