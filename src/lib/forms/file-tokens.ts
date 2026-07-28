/**
 * Signed access tokens for form-submission file uploads.
 *
 * Uploads collected by a `field_file` block are lead PII — trade-in titles,
 * insurance cards, credit-app supporting docs — so they're stored with a
 * private ACL and never served straight from the bucket. Two audiences need
 * to reach them:
 *
 *   - Loomi staff, in the submissions drawer. They authenticate with a
 *     session, so their links carry no token and never expire.
 *   - The dealer, from a lead notification email or an ADF lead opened in
 *     their CRM. Nobody in VinSolutions/Tekion has a Loomi login, so those
 *     links carry an HMAC-signed, expiring token instead.
 *
 * The token signs the object key and an expiry together, so it can't be
 * edited to reach a different key or to extend its own lifetime.
 *
 * The signing key is derived from NEXTAUTH_SECRET rather than a new env
 * var — that secret already exists in every environment. It's run through
 * a domain-separation label so a token minted here can never be confused
 * with any other use of the same secret.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SignedFileLink } from './file-links';

/** How long an emailed / CRM-forwarded link stays valid. */
export const FILE_TOKEN_TTL_DAYS = 90;
const FILE_TOKEN_TTL_MS = FILE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

const DOMAIN_LABEL = 'loomi:form-file-access:v1';

function signingKey(): Buffer {
  const secret = (process.env.NEXTAUTH_SECRET || '').trim();
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET is required to sign form file links');
  }
  return createHmac('sha256', secret).update(DOMAIN_LABEL).digest();
}

function sign(key: string, expiresAt: number): string {
  // Length-prefix the key so no (key, exp) pair can be re-split into a
  // different pair that produces the same signed message.
  const message = `${key.length}:${key}:${expiresAt}`;
  return createHmac('sha256', signingKey()).update(message).digest('base64url');
}

/** Mint a signed, expiring token for the given object key. */
export function signFileKey(key: string, now = Date.now()): SignedFileLink {
  const expiresAt = now + FILE_TOKEN_TTL_MS;
  return { key, expiresAt, signature: sign(key, expiresAt) };
}

export type FileTokenVerdict =
  | { ok: true; key: string }
  | { ok: false; reason: 'malformed' | 'expired' | 'bad-signature' };

/**
 * Verify a token minted by {@link signFileKey}. Checks the signature
 * before the expiry so a forged token can't learn anything from the
 * difference between "expired" and "invalid".
 */
export function verifyFileToken(
  params: { key?: string | null; exp?: string | null; sig?: string | null },
  now = Date.now(),
): FileTokenVerdict {
  const key = params.key?.trim();
  const exp = Number(params.exp);
  const sig = params.sig?.trim();
  if (!key || !sig || !Number.isFinite(exp) || exp <= 0) {
    return { ok: false, reason: 'malformed' };
  }

  const expected = Buffer.from(sign(key, exp));
  const presented = Buffer.from(sig);
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
    return { ok: false, reason: 'bad-signature' };
  }
  if (exp < now) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, key };
}

// Key-shape guards and URL builders live in ./file-links so client
// components can use them without bundling node:crypto.
