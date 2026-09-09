/**
 * MX verification — does this domain accept mail at all?
 *
 * The domain list in ./email-domains.ts catches the typos we have already
 * seen. This catches the ones we haven't: a domain with no MX record cannot
 * receive mail from anyone, whatever it looks like. `wilsonpaintandfloors.om`
 * and `ziprider.con` fail here without needing to be enumerated anywhere.
 *
 * ── WHERE THIS BELONGS, AND WHERE IT DOESN'T ────────────────────────────────
 * At IMPORT and on demand — never in the per-recipient send loop. A DNS
 * round-trip per recipient would add minutes to a large blast and make sending
 * depend on a resolver being reachable, turning a transient DNS blip into
 * failed sends. The send path keeps using the synchronous domain list; this is
 * the slower, more thorough pass that runs when contacts arrive.
 *
 * ── FAIL OPEN, ALWAYS ───────────────────────────────────────────────────────
 * A lookup that errors or times out returns `unknown`, never `invalid`. A
 * resolver hiccup must not mark a real customer undeliverable — the cost of a
 * wrong `invalid` (a person silently stops hearing from the dealership) is far
 * higher than the cost of a wrong `valid` (one bounce).
 */
import { promises as dns } from 'node:dns';

export type MxVerdict = 'has-mx' | 'no-mx' | 'unknown';

interface CacheEntry {
  verdict: MxVerdict;
  at: number;
}

/**
 * In-process cache. An import batch is thousands of contacts across a few
 * hundred domains, so this turns a per-contact lookup into a per-domain one.
 * Deliberately not persisted: DNS is already cached by the resolver, records
 * change, and a stale `no-mx` that outlives a domain fix is worse than a
 * repeated query.
 */
const cache = new Map<string, CacheEntry>();
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_ENTRIES = 5_000;
const TIMEOUT_MS = 3_000;

/** Visible for tests — drops everything so cases can't leak into each other. */
export function clearMxCache(): void {
  cache.clear();
}

function cached(domain: string): MxVerdict | null {
  const hit = cache.get(domain);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(domain);
    return null;
  }
  return hit.verdict;
}

function remember(domain: string, verdict: MxVerdict): void {
  // Never cache `unknown`: it means the lookup failed, not that we learned
  // something, and caching it would keep a transient failure alive for hours.
  if (verdict === 'unknown') return;
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(domain, { verdict, at: Date.now() });
}

/**
 * Does `domain` publish an MX record?
 *
 * A domain with an A record but no MX can still receive mail by the implicit-MX
 * rule, so that case counts as `has-mx` rather than a rejection.
 */
export async function checkMx(domain: string): Promise<MxVerdict> {
  const key = domain.trim().toLowerCase();
  if (!key) return 'unknown';

  const hit = cached(key);
  if (hit) return hit;

  let verdict: MxVerdict = 'unknown';
  try {
    const records = await withTimeout(dns.resolveMx(key), TIMEOUT_MS);
    verdict = records.length > 0 ? 'has-mx' : 'no-mx';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      // The domain resolves to nothing, or holds no MX. Fall back to an A/AAAA
      // lookup before calling it dead — implicit MX is rare but real.
      try {
        await withTimeout(dns.resolve(key), TIMEOUT_MS);
        verdict = 'has-mx';
      } catch {
        verdict = 'no-mx';
      }
    } else {
      // SERVFAIL, timeout, resolver unreachable — we learned nothing.
      verdict = 'unknown';
    }
  }

  remember(key, verdict);
  return verdict;
}

/** The domain half of an address, lowercased, or null if there isn't one. */
export function domainOf(email: string | null | undefined): string | null {
  const value = String(email || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return null;
  return value.slice(at + 1);
}

/**
 * MX verdict for an address. `unknown` for anything without a parseable
 * domain, so a caller can never read "no domain" as "confirmed dead".
 */
export async function checkEmailMx(email: string | null | undefined): Promise<MxVerdict> {
  const domain = domainOf(email);
  return domain ? checkMx(domain) : 'unknown';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('dns timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
