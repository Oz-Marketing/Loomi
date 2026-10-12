// How a failed send is treated depends on what the failure PROVES.
//
//  retry      — SendGrid demonstrably did not take the message (429, a 500 or
//               503 it answered with, a connection that was never opened, or
//               our own code failing before the request). Retrying cannot
//               double-send, so the recipient stays pending and a later pass
//               tries again, up to MAX_ATTEMPTS.
//  ambiguous  — the message may or may not have been accepted (a timeout, a
//               dropped connection, a 502/504 from a gateway in front of
//               SendGrid). Retrying risks mailing a real customer twice, so
//               the row is marked failed and says so plainly.
//  permanent  — SendGrid refused this message for a reason a retry won't fix
//               (a 400 for a malformed address, an oversized body).
//  auth       — SendGrid refused the account's API key. Not the recipient's
//               fault: the blast pauses with everyone still pending, and
//               resumes on its own once the key is fixed.
//
// Before this split, every failure was final: a two-minute SendGrid blip in the
// middle of a large blast left thousands of recipients `failed` forever, and
// the only recovery was duplicating the blast, which re-mailed everyone else.

import { SendGridError } from './sendgrid';
import { TwilioError } from './twilio';

export type SendFailureKind = 'retry' | 'ambiguous' | 'permanent' | 'auth';

/** Twilio adds one: the handset opted out at the carrier (error 21610). */
export type SmsFailureKind = SendFailureKind | 'optout';

/** Attempts (the first one included) before a retryable failure is final. */
export const MAX_ATTEMPTS = 5;

/** Connection errors raised before any request bytes reach SendGrid. */
const NEVER_CONNECTED_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/** Thrown for failures that happen in our code before any request is made. */
export class PreSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreSendError';
  }
}

function errorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const direct = (err as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    const nested = (cause as { code?: unknown }).code;
    if (typeof nested === 'string') return nested;
  }
  return undefined;
}

export function classifySendFailure(err: unknown): SendFailureKind {
  if (err instanceof PreSendError) return 'retry';
  if (err instanceof SendGridError) {
    if (err.status === 401 || err.status === 403) return 'auth';
    // status 0 is our own abort: the request may have been accepted.
    if (err.status === 0 || err.status === 502 || err.status === 504) return 'ambiguous';
    if (err.status === 429 || (err.status >= 500 && err.status < 600)) return 'retry';
    return 'permanent';
  }
  const code = errorCode(err);
  if (code && NEVER_CONNECTED_CODES.has(code)) return 'retry';
  return 'ambiguous';
}

/** The same classification for a Twilio send. */
export function classifyTwilioFailure(err: unknown): SmsFailureKind {
  if (err instanceof PreSendError) return 'retry';
  if (err instanceof TwilioError) {
    // 21610: "Attempt to send to unsubscribed recipient" — they replied STOP
    // to this sender, whether or not our inbound webhook recorded it.
    if (err.twilioCode === 21610) return 'optout';
    if (err.status === 401 || err.status === 403 || err.twilioCode === 20003) return 'auth';
    if (err.status === 0 || err.status === 502 || err.status === 504) return 'ambiguous';
    // A 2xx without a message SID: Twilio may well have taken it.
    if (err.status >= 200 && err.status < 300) return 'ambiguous';
    if (err.status === 429 || (err.status >= 500 && err.status < 600)) return 'retry';
    return 'permanent';
  }
  const code = errorCode(err);
  if (code && NEVER_CONNECTED_CODES.has(code)) return 'retry';
  return 'ambiguous';
}

const TEMPORARY_PREFIX = /^Temporary failure \(attempt (\d+) of \d+\): /;

/** How many attempts a recipient row's `error` says have already been made. */
export function attemptsSoFar(error: string | null | undefined): number {
  const match = TEMPORARY_PREFIX.exec(error || '');
  return match ? Number(match[1]) : 0;
}

/** The `error` text for a recipient left pending after a retryable failure. */
export function temporaryFailureNote(attempt: number, message: string): string {
  return `Temporary failure (attempt ${attempt} of ${MAX_ATTEMPTS}): ${message}`;
}

/**
 * A display name SendGrid will accept. Its `to.name` / `from.name` may not
 * contain `,` or `;` (a contact saved as "Smith, John" was rejected with a 400
 * and marked failed), and angle brackets or quotes would corrupt the header.
 */
export function sanitizeDisplayName(name: string | null | undefined): string | undefined {
  const cleaned = String(name || '')
    .replace(/[,;<>"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || undefined;
}
