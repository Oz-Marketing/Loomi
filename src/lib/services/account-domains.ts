/**
 * AccountDomain service — claim, verify, and resolve customer-owned
 * hostnames that point at our infra via CNAME.
 *
 * Verification path:
 *   1. Customer enters `offers.dealership.com` → we create the row
 *      with a random token + null verifiedAt.
 *   2. UI shows DNS instructions: TXT `_loomi.offers.dealership.com`
 *      = the token, plus CNAME `offers.dealership.com` → our infra.
 *   3. Customer clicks Verify → we resolveTxt() the TXT record. Match
 *      → set verifiedAt; mismatch/missing → friendly error.
 *
 * The CNAME isn't checked here — DNS propagation timing means it
 * sometimes lags the TXT record. We block traffic on `verifiedAt`,
 * not on CNAME presence, so the customer can verify quickly and the
 * page lights up as soon as DNS finishes converging.
 */
import { randomBytes } from 'crypto';
import { promises as dns } from 'dns';
import type { AccountDomain } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  CloudflareApiError,
  deleteCustomHostname,
  getCustomHostnameStatus,
  isCloudflareConfigured,
  normalizeSslStatus,
  registerCustomHostname,
} from '@/lib/cloudflare/saas';

export class AccountDomainServiceError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = 'AccountDomainServiceError';
  }
}

export interface AccountDomainSummary {
  id: string;
  accountKey: string;
  hostname: string;
  verificationToken: string;
  verifiedAt: string | null;
  homeLandingPageId: string | null;
  /** Cloudflare SSL provisioning status normalized to three buckets.
   *  Null when Cloudflare integration isn't configured (DNS-only
   *  verification path) or when the hostname hasn't been registered
   *  with CF yet (i.e. before verification). */
  cloudflareSslStatus: 'pending' | 'active' | 'failed' | null;
  /** Pre-formatted DNS instructions the UI can show as-is. */
  dns: {
    txtName: string;
    txtValue: string;
    cnameName: string;
    cnameTarget: string;
  };
  createdAt: string;
  updatedAt: string;
}

/** Lowercased, scheme/path-stripped form of whatever the user typed.
 *  Throws on shapes that obviously won't resolve (empty, single label,
 *  contains a path/scheme). */
export function normalizeHostname(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    throw new AccountDomainServiceError('Hostname is required.');
  }
  // Strip http(s):// + path if the user pasted a URL.
  const withoutScheme = trimmed.replace(/^https?:\/\//, '').split('/')[0]!;
  // Strip a trailing dot (FQDN form) — Postgres unique index is
  // case + dot sensitive otherwise.
  const stripped = withoutScheme.replace(/\.$/, '');
  if (!HOSTNAME_RE.test(stripped)) {
    throw new AccountDomainServiceError(
      'That doesn\'t look like a valid hostname. Use something like offers.yoursite.com (no http://, no path).',
    );
  }
  if (!stripped.includes('.')) {
    throw new AccountDomainServiceError(
      'Use a fully-qualified hostname (e.g. offers.yoursite.com), not just a single label.',
    );
  }
  return stripped;
}

// Permissive hostname check — matches RFC 1123 letter/digit/hyphen
// labels separated by dots. Stricter validation (TLD existence, etc.)
// happens implicitly at DNS lookup time.
const HOSTNAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/i;

function cnameTarget(): string {
  // The DNS target the customer points their hostname at. Production
  // should set LP_CNAME_TARGET to a dedicated proxy hostname (e.g.
  // cname.loomilm.com) so we can swap edge infra without forcing
  // every dealer to update DNS. Accepts both prefixed and unprefixed
  // variable names; falls back to the studio host since that already
  // accepts traffic.
  const explicit =
    process.env.LP_CNAME_TARGET ?? process.env.NEXT_PUBLIC_LP_CNAME_TARGET;
  if (explicit) return explicit.replace(/\/+$/, '');
  // Last-resort fallback — parse from NEXTAUTH_URL so dev/local works
  // without extra config.
  const nextAuth = process.env.NEXTAUTH_URL;
  if (nextAuth) {
    try {
      return new URL(nextAuth).host;
    } catch {
      /* malformed */
    }
  }
  return 'studio.loomilm.com';
}

function toSummary(row: AccountDomain): AccountDomainSummary {
  return {
    id: row.id,
    accountKey: row.accountKey,
    hostname: row.hostname,
    verificationToken: row.verificationToken,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    homeLandingPageId: row.homeLandingPageId,
    cloudflareSslStatus: (row.cloudflareSslStatus as
      | 'pending'
      | 'active'
      | 'failed'
      | null) ?? null,
    dns: {
      txtName: `_loomi.${row.hostname}`,
      txtValue: `loomi-verify=${row.verificationToken}`,
      cnameName: row.hostname,
      cnameTarget: cnameTarget(),
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── List / read ────────────────────────────────────────────────────

export async function listAccountDomains(accountKey: string): Promise<AccountDomainSummary[]> {
  const rows = await prisma.accountDomain.findMany({
    where: { accountKey },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toSummary);
}

export async function getAccountDomain(
  id: string,
  accountKeys: string[] | null,
): Promise<AccountDomainSummary | null> {
  const row = await prisma.accountDomain.findUnique({ where: { id } });
  if (!row) return null;
  if (accountKeys && accountKeys.length > 0 && !accountKeys.includes(row.accountKey)) {
    return null;
  }
  return toSummary(row);
}

// Used by middleware + the public LP route — does NOT enforce account
// scope (the lookup is by hostname, which already identifies the row).
export async function findVerifiedDomainByHostname(
  hostname: string,
): Promise<AccountDomain | null> {
  const row = await prisma.accountDomain.findUnique({
    where: { hostname: hostname.toLowerCase() },
  });
  if (!row || !row.verifiedAt) return null;
  return row;
}

/**
 * The account's CANONICAL custom domain — the host whose URLs we treat
 * as the real address of that account's landing pages.
 *
 * Used to build `publicUrl` / `rel=canonical` and to decide whether a
 * studio-host request should redirect. Only VERIFIED rows count: an
 * unverified hostname doesn't resolve yet, so pointing canonical tags
 * (or redirects) at it would send traffic into a hole.
 *
 * An account may hold several verified domains. We pick the OLDEST by
 * `createdAt` so the answer is stable — a canonical URL that reshuffles
 * when someone adds a second domain would de-index the first one.
 */
export async function findCanonicalDomainForAccount(
  accountKey: string,
): Promise<AccountDomain | null> {
  return prisma.accountDomain.findFirst({
    where: { accountKey, verifiedAt: { not: null } },
    orderBy: { createdAt: 'asc' },
  });
}

// ── Create / verify / update / delete ──────────────────────────────

export async function createAccountDomain(input: {
  accountKey: string;
  hostname: string;
}): Promise<AccountDomainSummary> {
  const hostname = normalizeHostname(input.hostname);
  const existing = await prisma.accountDomain.findUnique({ where: { hostname } });
  if (existing) {
    // Friendly error whether it's the same account or another — we
    // don't want to expose another customer's domain claim, but the
    // owner needs to know.
    if (existing.accountKey === input.accountKey) {
      throw new AccountDomainServiceError(
        'You\'ve already added that hostname for this account.',
        409,
      );
    }
    throw new AccountDomainServiceError(
      'That hostname is already claimed by another account. Contact support if you believe this is in error.',
      409,
    );
  }
  const verificationToken = randomBytes(16).toString('hex');
  const row = await prisma.accountDomain.create({
    data: {
      accountKey: input.accountKey,
      hostname,
      verificationToken,
    },
  });
  return toSummary(row);
}

/**
 * Resolve the TXT record at `_loomi.<hostname>` and check whether any
 * value matches `loomi-verify=<token>`. On match, persists verifiedAt
 * and returns the updated row. On mismatch, throws with a friendly
 * message describing what we saw vs. expected.
 */
export async function verifyAccountDomain(
  id: string,
  accountKeys: string[] | null,
): Promise<AccountDomainSummary> {
  const row = await prisma.accountDomain.findUnique({ where: { id } });
  if (!row) {
    throw new AccountDomainServiceError('Domain not found.', 404);
  }
  if (accountKeys && accountKeys.length > 0 && !accountKeys.includes(row.accountKey)) {
    throw new AccountDomainServiceError('Domain not found.', 404);
  }
  if (row.verifiedAt) {
    return toSummary(row);
  }

  const txtName = `_loomi.${row.hostname}`;
  const expected = `loomi-verify=${row.verificationToken}`;
  let records: string[][];
  try {
    records = await dns.resolveTxt(txtName);
  } catch (err) {
    // ENOTFOUND / ENODATA / etc. — DNS hasn't propagated, or the
    // record was added at the wrong host.
    const code = (err as NodeJS.ErrnoException).code ?? 'unknown';
    throw new AccountDomainServiceError(
      `No TXT record found at ${txtName} (DNS error: ${code}). Make sure the record is published and DNS has propagated (this can take 5–60 minutes).`,
      422,
    );
  }

  // resolveTxt returns string[][] (one TXT record can be split into
  // multiple chunks). Join each record's chunks before comparing.
  const flat = records.map((parts) => parts.join(''));
  const matched = flat.some((value) => value.trim() === expected);
  if (!matched) {
    throw new AccountDomainServiceError(
      `TXT record at ${txtName} doesn\'t match. Expected "${expected}".`,
      422,
    );
  }

  let updated = await prisma.accountDomain.update({
    where: { id: row.id },
    data: { verifiedAt: new Date() },
  });

  // Hand off to Cloudflare for SaaS so they provision SSL + route
  // traffic for the customer's hostname. Best-effort: a CF failure
  // shouldn't roll back the verification (DNS already proves
  // ownership), so we log + surface via cloudflareSslStatus='failed'
  // and let the caller retry from the Domains tab.
  if (isCloudflareConfigured()) {
    try {
      const registered = await registerCustomHostname(updated.hostname);
      if (registered) {
        updated = await prisma.accountDomain.update({
          where: { id: row.id },
          data: {
            cloudflareCustomHostnameId: registered.id,
            cloudflareSslStatus: normalizeSslStatus(
              registered.status,
              registered.ssl.status,
            ),
          },
        });
      }
    } catch (err) {
      console.error('[account-domains] CF register failed', err);
      updated = await prisma.accountDomain.update({
        where: { id: row.id },
        data: { cloudflareSslStatus: 'failed' },
      });
      // Throw out so the UI shows the CF error message; the DB row
      // is still verified though, so the user can retry without
      // re-doing DNS verification.
      const message =
        err instanceof CloudflareApiError
          ? `Verified, but Cloudflare registration failed: ${err.message}. Retry from the Domains tab.`
          : 'Verified, but Cloudflare registration failed. Retry from the Domains tab.';
      throw new AccountDomainServiceError(message, 502);
    }
  }

  return toSummary(updated);
}

/**
 * Re-fetch the current Cloudflare SSL status for a verified domain
 * and persist it. Useful when SSL was 'pending' at verification time
 * and the dealer wants to know whether the cert has finished
 * provisioning. No-op when CF isn't configured or the domain has no
 * registered hostname id yet.
 */
export async function refreshAccountDomainSsl(
  id: string,
  accountKeys: string[] | null,
): Promise<AccountDomainSummary> {
  const row = await prisma.accountDomain.findUnique({ where: { id } });
  if (!row) throw new AccountDomainServiceError('Domain not found.', 404);
  if (accountKeys && accountKeys.length > 0 && !accountKeys.includes(row.accountKey)) {
    throw new AccountDomainServiceError('Domain not found.', 404);
  }
  if (!row.cloudflareCustomHostnameId || !isCloudflareConfigured()) {
    return toSummary(row);
  }

  try {
    const status = await getCustomHostnameStatus(row.cloudflareCustomHostnameId);
    if (!status) return toSummary(row);
    const updated = await prisma.accountDomain.update({
      where: { id: row.id },
      data: {
        cloudflareSslStatus: normalizeSslStatus(status.status, status.ssl.status),
      },
    });
    return toSummary(updated);
  } catch (err) {
    console.error('[account-domains] CF status check failed', err);
    if (err instanceof CloudflareApiError) {
      throw new AccountDomainServiceError(
        `Could not check SSL status: ${err.message}`,
        502,
      );
    }
    throw new AccountDomainServiceError(
      'Could not check SSL status. Try again in a moment.',
      502,
    );
  }
}

export async function setAccountDomainHome(
  id: string,
  accountKeys: string[] | null,
  homeLandingPageId: string | null,
): Promise<AccountDomainSummary> {
  const row = await prisma.accountDomain.findUnique({ where: { id } });
  if (!row) throw new AccountDomainServiceError('Domain not found.', 404);
  if (accountKeys && accountKeys.length > 0 && !accountKeys.includes(row.accountKey)) {
    throw new AccountDomainServiceError('Domain not found.', 404);
  }

  if (homeLandingPageId) {
    // The chosen LP must belong to the same account and be published.
    // Allowing draft LPs as home would leak the draft URL to anyone
    // who hits the root path.
    const page = await prisma.landingPage.findUnique({ where: { id: homeLandingPageId } });
    if (!page) throw new AccountDomainServiceError('Landing page not found.', 404);
    if (page.accountKey !== row.accountKey) {
      throw new AccountDomainServiceError(
        'You can only set a landing page from the same account as the domain.',
        403,
      );
    }
  }

  const updated = await prisma.accountDomain.update({
    where: { id: row.id },
    data: { homeLandingPageId },
  });
  return toSummary(updated);
}

export async function deleteAccountDomain(
  id: string,
  accountKeys: string[] | null,
): Promise<void> {
  const row = await prisma.accountDomain.findUnique({ where: { id } });
  if (!row) throw new AccountDomainServiceError('Domain not found.', 404);
  if (accountKeys && accountKeys.length > 0 && !accountKeys.includes(row.accountKey)) {
    throw new AccountDomainServiceError('Domain not found.', 404);
  }

  // Remove the hostname from Cloudflare first so they stop routing
  // traffic + revoke the cert. We swallow CF errors (the dealer's
  // intent is "remove this from our system" — a stuck CF row is an
  // ops problem, not a reason to block the local cleanup). The
  // local row gets deleted regardless.
  if (row.cloudflareCustomHostnameId && isCloudflareConfigured()) {
    try {
      await deleteCustomHostname(row.cloudflareCustomHostnameId);
    } catch (err) {
      console.error('[account-domains] CF delete failed', err);
    }
  }

  await prisma.accountDomain.delete({ where: { id: row.id } });
}
