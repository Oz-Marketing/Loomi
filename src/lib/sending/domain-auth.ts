// Is a blast's From domain actually authenticated in SendGrid?
//
// WHY THIS EXISTS
// ───────────────
// Preflight used to compare two strings a person typed: the account's From
// address and the "authenticated domain" field in Sending Config. Nothing
// ever asked SendGrid. "Verify Connection" did ask, but threw the answer
// away. So an account could send From a domain SendGrid had never
// authenticated — or one whose DNS records had since been removed — and the
// mail went out DKIM-signed `d=sendgrid.net`, which fails DMARC alignment
// for the From domain. Under Gmail's and Yahoo's bulk-sender rules that is a
// spam-folder or outright-reject verdict on every message.
//
// This asks SendGrid, with the account's own key, which domains it has
// authenticated and whether their DNS validates, and answers for the actual
// From address.
//
// WHAT COUNTS AS COVERED
// ──────────────────────
// SendGrid signs with the authenticated domain that MATCHES the From domain;
// its docs are explicit that "subdomains don't inherit authentication
// permissions from their parent domain". When nothing matches, it falls back
// to the account's DEFAULT authenticated domain. So the From domain is
// covered by an exact, valid match — or by a valid default domain in the same
// organization (a parent or child of the From domain), whose signature still
// aligns under DMARC's relaxed mode. A valid parent that is NOT the default
// does not sign the subdomain's mail and does not count.
//
// Results are cached per key + domain for ten minutes: preflight runs on every
// Schedule-step render, and the answer changes only when someone edits DNS.

import { createHash } from 'node:crypto';

const SENDGRID_BASE = 'https://api.sendgrid.com/v3';

/** Preflight must never hang on SendGrid: one short budget for the whole check. */
export const DOMAIN_AUTH_TIMEOUT_MS = 8_000;
/** How long a definitive answer is trusted. */
export const DOMAIN_AUTH_CACHE_TTL_MS = 10 * 60 * 1000;
/** A failed lookup is retried soon, but not on every render. */
const UNREACHABLE_CACHE_TTL_MS = 60 * 1000;
const PAGE_SIZE = 50;
const MAX_PAGES = 10;

export type DomainAuthStatus =
  /** SendGrid will sign this From domain with an aligned, validated domain. */
  | 'authenticated'
  /** No authenticated domain covers the From domain. */
  | 'not_authenticated'
  /** The domain is set up in SendGrid but its DNS records don't validate. */
  | 'invalid'
  /** SendGrid rejected the API key itself (401). */
  | 'key_rejected'
  /** The key works but can't read Sender Authentication (403). */
  | 'no_permission'
  /** Network error, timeout, rate limit or a SendGrid outage. */
  | 'unreachable';

export interface DomainAuthResult {
  status: DomainAuthStatus;
  /** The From address's domain that was checked. */
  fromDomain: string;
  /** The SendGrid domain that covers it, when one does. */
  authenticatedDomain: string | null;
  /** Valid authenticated domains on the account — for the remedy text. */
  availableDomains: string[];
  /** One sentence a person can act on. */
  detail: string;
}

interface SendGridDomainRecord {
  domain?: unknown;
  valid?: unknown;
  default?: unknown;
}

const cache = new Map<string, { result: DomainAuthResult; expires: number }>();

/** Test hook: forget every cached answer. */
export function clearDomainAuthCache(): void {
  cache.clear();
}

function cacheKey(apiKey: string, fromDomain: string): string {
  // Never keep the raw key as a map key.
  const digest = createHash('sha256').update(apiKey).digest('hex').slice(0, 24);
  return `${digest}|${fromDomain}`;
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).trim().toLowerCase().replace(/\.+$/, '');
}

function isWithin(child: string, parent: string): boolean {
  return child === parent || child.endsWith(`.${parent}`);
}

class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`SendGrid returned HTTP ${status}`);
  }
}

async function fetchAuthenticatedDomains(
  apiKey: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<SendGridDomainRecord[]> {
  const all: SendGridDomainRecord[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = `${SENDGRID_BASE}/whitelabel/domains?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!res.ok) throw new HttpStatusError(res.status);
    const payload: unknown = await res.json();
    if (!Array.isArray(payload)) throw new HttpStatusError(502);
    all.push(...(payload as SendGridDomainRecord[]));
    if (payload.length < PAGE_SIZE) break;
  }
  return all;
}

/** Decide coverage from SendGrid's domain list. Pure; exported for tests. */
export function evaluateDomainAuth(
  fromDomain: string,
  records: SendGridDomainRecord[],
): DomainAuthResult {
  const domains = records
    .map((record) => ({
      domain: typeof record.domain === 'string'
        ? record.domain.trim().toLowerCase().replace(/\.+$/, '')
        : '',
      valid: record.valid === true,
      isDefault: record.default === true,
    }))
    .filter((record) => record.domain);
  const availableDomains = [...new Set(domains.filter((d) => d.valid).map((d) => d.domain))];

  const exact = domains.filter((d) => d.domain === fromDomain);
  if (exact.some((d) => d.valid)) {
    return {
      status: 'authenticated',
      fromDomain,
      authenticatedDomain: fromDomain,
      availableDomains,
      detail: `${fromDomain} is authenticated in SendGrid.`,
    };
  }
  if (exact.length > 0) {
    return {
      status: 'invalid',
      fromDomain,
      authenticatedDomain: null,
      availableDomains,
      detail: `${fromDomain} is set up in SendGrid, but its DNS records don't validate, so mail can't be DKIM-signed for it.`,
    };
  }

  const fallback = domains.find(
    (d) => d.isDefault && d.valid
      && (isWithin(fromDomain, d.domain) || isWithin(d.domain, fromDomain)),
  );
  if (fallback) {
    return {
      status: 'authenticated',
      fromDomain,
      authenticatedDomain: fallback.domain,
      availableDomains,
      detail: `${fromDomain} isn't authenticated on its own, but SendGrid signs it with the default domain ${fallback.domain}, which aligns.`,
    };
  }

  const related = availableDomains.filter(
    (d) => isWithin(fromDomain, d) || isWithin(d, fromDomain),
  );
  return {
    status: 'not_authenticated',
    fromDomain,
    authenticatedDomain: null,
    availableDomains,
    detail: related.length > 0
      ? `${fromDomain} isn't authenticated in SendGrid. ${related.join(', ')} is, but SendGrid doesn't extend that to ${fromDomain}.`
      : `${fromDomain} isn't authenticated in SendGrid${availableDomains.length > 0 ? ` (authenticated: ${availableDomains.join(', ')})` : ''}.`,
  };
}

function failure(status: DomainAuthStatus, fromDomain: string, detail: string): DomainAuthResult {
  return { status, fromDomain, authenticatedDomain: null, availableDomains: [], detail };
}

/**
 * Check `fromEmail`'s domain against the SendGrid account behind `apiKey`.
 * Never throws: every failure is a status the caller can weigh.
 */
export async function checkSenderDomainAuth(input: {
  apiKey: string;
  fromEmail: string;
  /** Skip the cache — Verify Connection wants a fresh answer. The result is still cached. */
  fresh?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<DomainAuthResult> {
  const now = input.now ?? Date.now;
  const fromDomain = emailDomain(input.fromEmail || '');
  if (!fromDomain) {
    return failure('not_authenticated', '', 'There is no From address to check.');
  }
  const apiKey = (input.apiKey || '').trim();
  if (!apiKey) return failure('key_rejected', fromDomain, 'There is no SendGrid API key to check with.');

  const key = cacheKey(apiKey, fromDomain);
  if (!input.fresh) {
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.result;
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOMAIN_AUTH_TIMEOUT_MS);
  let result: DomainAuthResult;
  try {
    const records = await fetchAuthenticatedDomains(apiKey, fetchImpl, controller.signal);
    result = evaluateDomainAuth(fromDomain, records);
  } catch (err) {
    if (err instanceof HttpStatusError && err.status === 401) {
      result = failure('key_rejected', fromDomain, 'SendGrid rejected this API key (401 Unauthorized).');
    } else if (err instanceof HttpStatusError && err.status === 403) {
      result = failure(
        'no_permission',
        fromDomain,
        "This API key can't read Sender Authentication, so the domain couldn't be checked.",
      );
    } else if (err instanceof Error && err.name === 'AbortError') {
      result = failure('unreachable', fromDomain, 'SendGrid did not answer in time.');
    } else {
      result = failure(
        'unreachable',
        fromDomain,
        err instanceof HttpStatusError
          ? `SendGrid returned HTTP ${err.status} while checking the domain.`
          : 'SendGrid could not be reached to check the domain.',
      );
    }
  } finally {
    clearTimeout(timer);
  }

  cache.set(key, {
    result,
    expires: now() + (result.status === 'unreachable' ? UNREACHABLE_CACHE_TTL_MS : DOMAIN_AUTH_CACHE_TTL_MS),
  });
  return result;
}
