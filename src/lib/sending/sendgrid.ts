// SendGrid v3 client for per-sub-account email sending.
//
// We deliberately don't pull in the @sendgrid/mail SDK — the surface we
// need (mail/send + scopes for verify + whitelabel/domains for status)
// is three endpoints, all JSON-over-HTTPS. Direct fetch keeps the
// dependency tree clean and lets us own error shapes + timeouts.
//
// The encrypted key + verified domain live on Account.sendgridApiKey /
// sendgridFromDomain. resolveSendGridConfig() is the only place callers
// read them; everything else takes a plaintext key.

import { prisma } from '@/lib/prisma';
import { decryptToken, encryptToken } from '@/lib/crypto/encryption';

const SENDGRID_BASE = 'https://api.sendgrid.com/v3';
const REQUEST_TIMEOUT_MS = 15_000;

export interface SendGridConfig {
  /** Plaintext API key — call sites never see ciphertext. */
  apiKey: string;
  /** Verified sender domain (informational; used for warnings). */
  fromDomain: string | null;
}

export interface SendGridSendInput {
  apiKey: string;
  from: { email: string; name?: string };
  replyTo?: { email: string; name?: string };
  to: { email: string; name?: string };
  subject: string;
  html: string;
  text?: string;
  /** Tags surfaced in SendGrid's UI + carried into Event webhook payloads. */
  categories?: string[];
  /** Per-recipient custom args echoed back in webhooks; lets us match an
   *  event to its EmailBlastRecipient row without a second lookup. */
  customArgs?: Record<string, string>;
  /**
   * CAN-SPAM / RFC 8058 compliance. When provided, SendGrid replaces every
   * occurrence of `substitutionTag` in the body with a real per-recipient
   * unsubscribe URL, and sets the List-Unsubscribe (+ List-Unsubscribe-Post,
   * when enabled account-side) headers for Gmail/Apple one-click unsubscribe.
   *
   * The CALLER is responsible for putting the tag and the sender's postal
   * address in the body — see injectUnsubscribeFooter() in
   * lib/sending/unsubscribe-footer.ts. We deliberately do NOT pass
   * subscription_tracking's `text`/`html` append fields: SendGrid documents
   * `substitution_tag` as overriding both, so passing them only creates the
   * illusion of a footer that never ships.
   *
   * Skip for transactional sends like "Send test from editor" by omitting
   * this field.
   */
  unsubscribe?: {
    /** Tag to swap for the hosted URL; must appear in the body. */
    substitutionTag: string;
  };
}

export interface SendGridSendResult {
  /** SendGrid's X-Message-Id, opaque. Stored on the recipient row so the
   *  Event webhook can correlate downstream events back to this send. */
  messageId: string;
}

export class SendGridError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
    /** Raw Retry-After header, when SendGrid sent one (429s). */
    public readonly retryAfter: string | null = null,
  ) {
    super(message);
    this.name = 'SendGridError';
  }
}

/**
 * Resolve a sub-account's SendGrid config from the Account row. Returns
 * null when the key isn't set. Transactional callers (form alerts, lead
 * emails, the editor's test send) then fall back to nodemailer SMTP; BLASTS
 * do not — blast-preflight.ts blocks them outright, because the fallback is
 * what once put a full blast on the shared transactional domain.
 *
 * The key is encrypted at rest (AES-256-GCM via @/lib/crypto/encryption);
 * we decrypt on the worker as needed. Encryption fails throw — we'd
 * rather refuse to send than fall back silently to SMTP with a clearly
 * misconfigured account, since the user expects SendGrid behaviour.
 */
export async function resolveSendGridConfig(
  accountKey: string,
): Promise<SendGridConfig | null> {
  const row = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { sendgridApiKey: true, sendgridFromDomain: true },
  });
  if (!row?.sendgridApiKey) return null;
  return {
    apiKey: decryptToken(row.sendgridApiKey),
    fromDomain: row.sendgridFromDomain || null,
  };
}

/**
 * Persist a SendGrid API key for a sub-account. Pass `null` to clear it.
 * Always encrypts before write.
 */
export async function setSendGridApiKey(
  accountKey: string,
  plaintextKey: string | null,
): Promise<void> {
  await prisma.account.update({
    where: { key: accountKey },
    data: {
      sendgridApiKey: plaintextKey ? encryptToken(plaintextKey) : null,
    },
  });
}

export async function setSendGridFromDomain(
  accountKey: string,
  domain: string | null,
): Promise<void> {
  await prisma.account.update({
    where: { key: accountKey },
    data: { sendgridFromDomain: domain },
  });
}

/** Attempts, including the first. Small: the worker retries the blast too. */
const MAX_SEND_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

/**
 * Is this failure worth another attempt?
 *
 * Only for responses that PROVE SendGrid did not accept the message: 429
 * (rate limited) and 5xx (their side). Deliberately NOT for timeouts or
 * network errors — those are ambiguous, SendGrid may have queued the mail
 * before the connection dropped, and a retry would double-send to a real
 * customer. A duplicate blast is worse than a failed row the user can see
 * and re-run.
 */
function isRetryableSendStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function retryDelayMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 30_000);
  }
  return RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fire a single email through SendGrid v3 mail/send. Returns the
 * X-Message-Id from the response headers; throws SendGridError on
 * non-202 responses (SendGrid uses 202 Accepted for queued sends).
 *
 * This is the per-recipient unit. The worker loops over recipients and
 * calls this once per row — SendGrid supports batching via
 * personalizations[], but keeping it 1:1 with EmailBlastRecipient
 * means a single failed send doesn't poison a whole batch and we can
 * update the row status atomically.
 *
 * Retries 429s and 5xxs (see isRetryableSendStatus) so one rate-limit
 * blip mid-blast doesn't permanently mark a batch of recipients failed.
 */
export async function sendEmailViaSendGrid(
  input: SendGridSendInput,
): Promise<SendGridSendResult> {
  let lastError: SendGridError | null = null;

  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
    try {
      return await attemptSendEmailViaSendGrid(input);
    } catch (err) {
      if (
        !(err instanceof SendGridError)
        || !isRetryableSendStatus(err.status)
        || attempt === MAX_SEND_ATTEMPTS
      ) {
        throw err;
      }
      lastError = err;
      await sleep(retryDelayMs(attempt, err.retryAfter));
    }
  }

  // Unreachable: the final attempt either returns or throws above.
  throw lastError ?? new SendGridError('SendGrid send failed', 0);
}

async function attemptSendEmailViaSendGrid(
  input: SendGridSendInput,
): Promise<SendGridSendResult> {
  const body = {
    personalizations: [
      {
        to: [input.to.name ? { email: input.to.email, name: input.to.name } : { email: input.to.email }],
        ...(input.customArgs && Object.keys(input.customArgs).length > 0
          ? { custom_args: input.customArgs }
          : {}),
      },
    ],
    from: input.from.name
      ? { email: input.from.email, name: input.from.name }
      : { email: input.from.email },
    ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    subject: input.subject,
    content: [
      ...(input.text ? [{ type: 'text/plain', value: input.text }] : []),
      { type: 'text/html', value: input.html },
    ],
    ...(input.categories && input.categories.length > 0
      ? { categories: input.categories }
      : {}),
    // Trail SendGrid's tracking on by default — opens via pixel, clicks
    // via link rewrites. Bounces + spam reports come through regardless.
    //
    // subscription_tracking does two things for us: it swaps
    // substitution_tag for the recipient's hosted unsubscribe URL, and it
    // sets the List-Unsubscribe header (plus List-Unsubscribe-Post, when
    // one-click is enabled account-side) for RFC 8058. Recipients who
    // click land on SendGrid's hosted page; the unsubscribe event reaches
    // /api/webhooks/sendgrid/events and becomes an EmailSuppression row.
    //
    // `text`/`html` are intentionally absent: SendGrid overrides both
    // whenever substitution_tag is set, so the footer has to be in the
    // body before we get here.
    tracking_settings: {
      click_tracking: { enable: true, enable_text: false },
      open_tracking: { enable: true },
      ...(input.unsubscribe
        ? {
            subscription_tracking: {
              enable: true,
              substitution_tag: input.unsubscribe.substitutionTag,
            },
          }
        : {}),
    },
    mail_settings: {
      sandbox_mode: { enable: false },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${SENDGRID_BASE}/mail/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SendGridError('SendGrid request timed out', 0);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (res.status !== 202) {
    const payload = await res.json().catch(() => null);
    const errMessage =
      (payload && Array.isArray((payload as { errors?: { message?: string }[] }).errors) &&
        (payload as { errors: { message?: string }[] }).errors[0]?.message) ||
      `SendGrid send failed (${res.status})`;
    throw new SendGridError(
      errMessage,
      res.status,
      payload,
      res.headers.get('retry-after'),
    );
  }

  const messageId = res.headers.get('x-message-id') || '';
  return { messageId };
}

/**
 * Clear an address from SendGrid's own suppression lists.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Deleting our EmailSuppression row only tells the Loomi worker it may
 * send again. SendGrid keeps its own lists and silently drops mail to
 * anything on them, so a support rep who removed the row in Loomi would
 * watch the blast report say "sent" while the customer received nothing.
 * Re-enabling a recipient has to clear both sides.
 *
 * SendGrid splits these across three endpoints by kind, so map from the
 * row's reason rather than shotgunning all three:
 *   unsubscribe → /asm/suppressions/global/{email}
 *   bounce      → /suppression/bounces/{email}
 *   spamreport  → /suppression/spam_reports/{email}
 *
 * A `manual` row has no SendGrid counterpart — it only ever existed on
 * our side — so it resolves to an empty list and makes no API call.
 *
 * Best-effort by design: returns what happened instead of throwing, so a
 * SendGrid outage can't block the local removal the operator asked for.
 */
export type SuppressionReason = 'unsubscribe' | 'bounce' | 'spamreport' | 'manual';

export interface ClearSuppressionResult {
  /** Endpoints we called and SendGrid accepted (204, or 404 = already gone). */
  cleared: string[];
  /** Human-readable failures; empty when everything worked. */
  errors: string[];
}

function suppressionPathsFor(reason: string): string[] {
  switch (reason) {
    case 'unsubscribe':
      return ['/asm/suppressions/global'];
    case 'bounce':
      return ['/suppression/bounces'];
    case 'spamreport':
      return ['/suppression/spam_reports'];
    default:
      // 'manual' and anything unrecognized: nothing to clear upstream.
      return [];
  }
}

export async function clearSendGridSuppression(input: {
  apiKey: string;
  email: string;
  reason: string;
}): Promise<ClearSuppressionResult> {
  const cleared: string[] = [];
  const errors: string[] = [];
  const paths = suppressionPathsFor(input.reason);

  for (const path of paths) {
    const url = `${SENDGRID_BASE}${path}/${encodeURIComponent(input.email)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${input.apiKey}` },
        signal: controller.signal,
      });
      // 204 = removed. 404 = not on that list, which is the same end state.
      if (res.status === 204 || res.status === 404) {
        cleared.push(path);
      } else {
        errors.push(`${path} returned HTTP ${res.status}`);
      }
    } catch (err) {
      errors.push(
        `${path}: ${err instanceof Error && err.name === 'AbortError' ? 'timed out' : err instanceof Error ? err.message : 'unknown error'}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return { cleared, errors };
}

/**
 * Verify an API key by pinging GET /scopes — returns 200 + an array of
 * the key's permitted scopes if valid, 401 if not. Cheap and side-effect
 * free, so safe to call from settings UI.
 */
export interface SendGridVerifyResult {
  ok: boolean;
  scopes?: string[];
  /** Human-readable error from SendGrid (or our own client) when ok=false. */
  error?: string;
}

export async function verifySendGridKey(apiKey: string): Promise<SendGridVerifyResult> {
  if (!apiKey.trim()) {
    return { ok: false, error: 'API key is empty' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${SENDGRID_BASE}/scopes`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (res.status === 200) {
      const payload = (await res.json().catch(() => ({}))) as { scopes?: string[] };
      return { ok: true, scopes: payload.scopes };
    }
    if (res.status === 401) {
      return { ok: false, error: 'SendGrid rejected the key (401 Unauthorized).' };
    }
    return { ok: false, error: `SendGrid returned HTTP ${res.status}.` };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Verification timed out.' };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error.' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check whether a domain is fully authenticated (DKIM + SPF) on the
 * account behind this API key. Returns null when the domain isn't
 * registered with SendGrid; the settings UI uses that to nudge the user
 * to add it via SendGrid's Sender Authentication.
 */
export interface SendGridDomainStatus {
  domain: string;
  valid: boolean;
  /** SendGrid's authentication record subject. Useful for the UI link. */
  id: number | null;
}

export async function checkSendGridDomain(
  apiKey: string,
  domain: string,
): Promise<SendGridDomainStatus | null> {
  if (!apiKey || !domain) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${SENDGRID_BASE}/whitelabel/domains?domain=${encodeURIComponent(domain)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const payload = (await res.json().catch(() => [])) as Array<{
      id?: number;
      domain?: string;
      valid?: boolean;
    }>;
    if (!Array.isArray(payload) || payload.length === 0) return null;
    const match =
      payload.find((d) => d.domain?.toLowerCase() === domain.toLowerCase()) ||
      payload[0];
    return {
      domain: match.domain || domain,
      valid: Boolean(match.valid),
      id: typeof match.id === 'number' ? match.id : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
