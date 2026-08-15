/**
 * Signed OAuth `state` for the Business Profile connect flow.
 *
 * ── WHY NOT ODT'S VERSION ───────────────────────────────────────────────────
 * Oz Dealer Tools puts the bare org id in `state` and trusts it on the way back
 * (`GBPReport::oauthCallback` reads `state` and writes the token to that org).
 * `state` is attacker-controlled — it is a query parameter on a URL the user
 * can be sent to — so anyone who can get a staff member to click a crafted
 * callback link can bind a Google grant to an org of their choosing. That is
 * the exact CSRF that `state` exists to prevent.
 *
 * Here `state` is an HMAC-signed payload carrying the account, the user who
 * started the flow, a nonce, and an expiry. The callback rejects anything it
 * did not issue, anything older than ten minutes, and anything started by a
 * different user than the one completing it.
 *
 * The signing key is derived from the token-encryption secret with a domain
 * separation label, so a state blob can never be confused with — or used as —
 * ciphertext from `encryptToken`.
 */
import crypto from 'crypto';
import { requireTokenEncryptionSecrets } from '@/lib/crypto/secrets';

/** A consent round-trip is a few seconds of clicking; ten minutes is generous. */
const TTL_MS = 10 * 60 * 1000;
const LABEL = 'loomi:gbp-oauth-state:v1';

export interface GbpOAuthState {
  accountKey: string;
  userId: string;
  nonce: string;
  expiresAt: number;
}

function signingKeys(): Buffer[] {
  // Every configured secret, so a key rotation mid-flow doesn't strand a
  // consent screen that is already open in someone's browser.
  return requireTokenEncryptionSecrets().map((s) =>
    crypto.createHash('sha256').update(`${LABEL}|${s}`).digest(),
  );
}

const b64url = (b: Buffer) => b.toString('base64url');

function hmac(key: Buffer, payload: string): string {
  return b64url(crypto.createHmac('sha256', key).update(payload).digest());
}

export function signState(accountKey: string, userId: string, now = Date.now()): string {
  const state: GbpOAuthState = {
    accountKey,
    userId,
    nonce: crypto.randomBytes(12).toString('base64url'),
    expiresAt: now + TTL_MS,
  };
  const payload = b64url(Buffer.from(JSON.stringify(state), 'utf8'));
  const [primary] = signingKeys();
  return `${payload}.${hmac(primary, payload)}`;
}

/**
 * Returns the payload, or null for anything we did not issue, anything expired,
 * or anything malformed. Callers must treat null as "abort the flow" — never as
 * "fall back to a query parameter".
 */
export function verifyState(raw: string | null | undefined, now = Date.now()): GbpOAuthState | null {
  if (!raw) return null;
  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return null;

  const provided = Buffer.from(signature);
  const matches = signingKeys().some((key) => {
    const expected = Buffer.from(hmac(key, payload));
    // Length check first: timingSafeEqual throws on a length mismatch, and an
    // attacker controls the length.
    return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
  });
  if (!matches) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  const s = parsed as Partial<GbpOAuthState>;
  if (
    typeof s?.accountKey !== 'string' ||
    typeof s?.userId !== 'string' ||
    typeof s?.nonce !== 'string' ||
    typeof s?.expiresAt !== 'number'
  ) {
    return null;
  }
  if (s.expiresAt <= now) return null;

  return s as GbpOAuthState;
}
