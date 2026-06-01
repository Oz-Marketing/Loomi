// Cloudflare Turnstile verification for public form submissions.
//
// Turnstile is a free, privacy-preserving CAPTCHA. The widget on the
// public form generates a token; we POST it (with the secret key) to
// Cloudflare's siteverify endpoint, which returns success/failure.
//
// Configuration (both env vars must be set for Turnstile to be active):
//   - NEXT_PUBLIC_TURNSTILE_SITE_KEY  (public; injected into the widget)
//   - TURNSTILE_SECRET_KEY            (server-only; used for verify)
//
// When the secret is unset the verifier is a no-op and the submit
// pipeline falls back to honeypot-only — keeps local dev frictionless
// and lets us ship Turnstile incrementally per environment.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 8_000;

export interface TurnstileVerifyResult {
  ok: boolean;
  /** Machine-readable failure codes from Cloudflare (e.g.
   *  'missing-input-response', 'timeout-or-duplicate'). Empty on success. */
  errorCodes: string[];
  /** Human-readable summary suitable for surfacing on the form. Falls
   *  back to a generic "verification failed" when the API didn't return
   *  a recognisable code. */
  message: string | null;
}

/** True when TURNSTILE_SECRET_KEY is set. Site-key-only configs (public
 *  key set but no secret) are treated as not-configured because we
 *  can't verify without the secret. */
export function isTurnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim());
}

/** Site key for the client widget. Returns null when not set so the
 *  public render path can skip rendering the widget entirely. */
export function getTurnstileSiteKey(): string | null {
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  return key || null;
}

/**
 * Verify a Turnstile token against Cloudflare's siteverify endpoint.
 *
 * Returns ok:false (rather than throwing) on network errors so the
 * caller can decide whether to fail-closed (reject the submission) or
 * fail-open (accept but log). The form submit pipeline fails-closed.
 *
 * Tokens are single-use and valid for ~5 minutes — Cloudflare will
 * return 'timeout-or-duplicate' for replays.
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  remoteIp?: string | null,
): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    // Defensive: callers should gate on isTurnstileConfigured() first,
    // but if they don't, treat a missing secret as "verification not
    // required" rather than blocking the submission.
    return { ok: true, errorCodes: [], message: null };
  }
  if (!token || !token.trim()) {
    return {
      ok: false,
      errorCodes: ['missing-input-response'],
      message: 'Please complete the verification widget before submitting.',
    };
  }

  const form = new URLSearchParams();
  form.set('secret', secret);
  form.set('response', token);
  if (remoteIp && remoteIp !== 'unknown') {
    form.set('remoteip', remoteIp);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: controller.signal,
    });
  } catch (err) {
    return {
      ok: false,
      errorCodes: ['network-error'],
      message:
        err instanceof Error && err.name === 'AbortError'
          ? 'Verification timed out. Please try again.'
          : 'Could not reach the verification service. Please try again.',
    };
  } finally {
    clearTimeout(timer);
  }

  const payload = (await res.json().catch(() => null)) as
    | { success?: boolean; 'error-codes'?: string[] }
    | null;

  if (!payload) {
    return {
      ok: false,
      errorCodes: ['invalid-response'],
      message: 'Verification service returned an unexpected response.',
    };
  }

  if (payload.success) {
    return { ok: true, errorCodes: [], message: null };
  }

  const errorCodes = Array.isArray(payload['error-codes'])
    ? payload['error-codes']
    : [];
  return {
    ok: false,
    errorCodes,
    message: humaniseError(errorCodes),
  };
}

function humaniseError(codes: string[]): string {
  if (codes.includes('timeout-or-duplicate')) {
    return 'Verification expired. Please try again.';
  }
  if (codes.includes('invalid-input-response')) {
    return 'Verification failed. Please try again.';
  }
  if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) {
    // Configuration error on our side — don't expose the detail to the
    // submitter, but tag it for our logs.
    return 'Verification is misconfigured. The site team has been notified.';
  }
  return 'Verification failed. Please try again.';
}

/** Public field name Turnstile's widget injects into the submitted
 *  form. Centralised here so the client renderer + server verifier
 *  agree on the key. */
export const TURNSTILE_RESPONSE_FIELD = 'cf-turnstile-response';
