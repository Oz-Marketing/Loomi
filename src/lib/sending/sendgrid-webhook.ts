// ── SendGrid Webhook Signature Verification ──
// SendGrid Event Webhooks use ECDSA with SHA-256 for signature verification.
// Headers: X-Twilio-Email-Event-Webhook-Signature, X-Twilio-Email-Event-Webhook-Timestamp
// The public key is provided in the SendGrid Event Webhook settings (DER-encoded, base64).
//
// SENDGRID_WEBHOOK_VERIFICATION_KEY holds ONE OR MORE of those keys:
//
//   - One key, as SendGrid shows it (base64 DER), with or without the PEM
//     armour. The original single-key form; it reads exactly as it always did.
//   - Several keys separated by commas or newlines, in either form, e.g.
//       SENDGRID_WEBHOOK_VERIFICATION_KEY="MFkwEwYHKoZI...AAA,MFkwEwYHKoZI...BBB"
//
// Each SendGrid account, and each subuser, signs with its OWN key, and all of
// them post to this one endpoint. With a single key configured, a batch from
// any other account fails verification, is answered 401, and its
// unsubscribes and bounces are lost. A request verifies if ANY key verifies it.

import crypto, { type KeyObject } from 'crypto';

const PEM_BLOCK = /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g;

function armour(base64: string): string {
  return `-----BEGIN PUBLIC KEY-----\n${base64}\n-----END PUBLIC KEY-----`;
}

/**
 * Every key the env value could mean, as PEM text.
 *
 * First the whole value, read exactly the way the single-key code read it —
 * so a key that only ever worked as one block (pasted wrapped across several
 * lines, say) still does. Then each comma- or newline-separated entry.
 * Candidates that turn out not to be keys are dropped when parsed.
 */
export function verificationKeyCandidates(value: string): string[] {
  const candidates = [value.includes('-----BEGIN') ? value : armour(value)];

  // An unquoted env value carries "\n" as two literal characters.
  const normalized = value.replace(/\\n/g, '\n');
  candidates.push(...(normalized.match(PEM_BLOCK) ?? []));
  for (const entry of normalized.replace(PEM_BLOCK, '\n').split(/[,\r\n]+/)) {
    const key = entry.trim();
    // A stray armour line is a broken PEM block, not a key of its own.
    if (key && !key.includes('-----')) candidates.push(armour(key));
  }
  return candidates;
}

function parsePublicKey(pem: string): KeyObject | null {
  try {
    return crypto.createPublicKey(pem);
  } catch {
    return null;
  }
}

/** Parsed once per distinct env value, so a bad entry is reported once rather
 *  than on every request. */
let parsedKeys: { source: string; keys: KeyObject[] } | null = null;

function loadVerificationKeys(source: string): KeyObject[] {
  if (parsedKeys?.source === source) return parsedKeys.keys;

  const [whole, ...entries] = verificationKeyCandidates(source);
  const wholeKey = parsePublicKey(whole);
  const entryKeys = entries.map(parsePublicKey);

  // Only meaningful when the value is a LIST — a single key wrapped across
  // lines parses whole, and its lines failing on their own is expected.
  const unusable = entryKeys.filter((key) => !key).length;
  if (!wholeKey && unusable > 0) {
    console.error(
      `[sendgrid:webhook] ${unusable} of ${entries.length} entries in SENDGRID_WEBHOOK_VERIFICATION_KEY are not valid public keys — batches signed with them will be rejected`,
    );
  }

  const keys: KeyObject[] = [];
  const seen = new Set<string>();
  for (const key of [wholeKey, ...entryKeys]) {
    if (!key) continue;
    const fingerprint = key.export({ type: 'spki', format: 'der' }).toString('base64');
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    keys.push(key);
  }
  parsedKeys = { source, keys };
  return keys;
}

/**
 * Verify a SendGrid Event Webhook signature using ECDSA-SHA256.
 *
 * SendGrid's algorithm:
 * 1. Concatenate the timestamp + raw body
 * 2. Verify the ECDSA-SHA256 signature against the EC public key
 *
 * Tried against every configured key; true if any of them verifies.
 *
 * @param rawBody - The raw request body as a string
 * @param signature - The X-Twilio-Email-Event-Webhook-Signature header (base64-encoded)
 * @param timestamp - The X-Twilio-Email-Event-Webhook-Timestamp header
 */
export function verifySendGridWebhookSignature(
  rawBody: string,
  signature: string,
  timestamp?: string,
): boolean {
  const configured = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
  if (!configured) {
    console.warn('[sendgrid:webhook] SENDGRID_WEBHOOK_VERIFICATION_KEY not set — cannot verify signature');
    return false;
  }

  if (!signature) {
    return false;
  }

  const keys = loadVerificationKeys(configured);
  if (keys.length === 0) {
    console.error('[sendgrid:webhook] SENDGRID_WEBHOOK_VERIFICATION_KEY holds no usable public key — cannot verify signature');
    return false;
  }

  // Payload to verify: timestamp + body
  const payload = (timestamp || '') + rawBody;

  for (const key of keys) {
    try {
      const verifier = crypto.createVerify('sha256');
      verifier.update(payload);
      verifier.end();
      if (verifier.verify(key, signature, 'base64')) return true;
    } catch (err) {
      console.error('[sendgrid:webhook] Signature verification error:', err);
    }
  }
  return false;
}
