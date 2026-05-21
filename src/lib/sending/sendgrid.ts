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
import { decryptToken, encryptToken } from '@/lib/esp/encryption';

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
   *  event to its EmailCampaignRecipient row without a second lookup. */
  customArgs?: Record<string, string>;
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
  ) {
    super(message);
    this.name = 'SendGridError';
  }
}

/**
 * Resolve a sub-account's SendGrid config from the Account row. Returns
 * null when the key isn't set — callers fall back to nodemailer SMTP.
 *
 * The key is encrypted at rest (AES-256-GCM via @/lib/esp/encryption);
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

/**
 * Fire a single email through SendGrid v3 mail/send. Returns the
 * X-Message-Id from the response headers; throws SendGridError on
 * non-202 responses (SendGrid uses 202 Accepted for queued sends).
 *
 * This is the per-recipient unit. The worker loops over recipients and
 * calls this once per row — SendGrid supports batching via
 * personalizations[], but keeping it 1:1 with EmailCampaignRecipient
 * means a single failed send doesn't poison a whole batch and we can
 * update the row status atomically.
 */
export async function sendEmailViaSendGrid(
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
    tracking_settings: {
      click_tracking: { enable: true, enable_text: false },
      open_tracking: { enable: true },
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
    throw new SendGridError(errMessage, res.status, payload);
  }

  const messageId = res.headers.get('x-message-id') || '';
  return { messageId };
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
