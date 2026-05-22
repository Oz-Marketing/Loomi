// ── SendGrid Webhook Signature Verification ──
// SendGrid Event Webhooks use ECDSA with SHA-256 for signature verification.
// Headers: X-Twilio-Email-Event-Webhook-Signature, X-Twilio-Email-Event-Webhook-Timestamp
// The public key is provided in the SendGrid Event Webhook settings (DER-encoded, base64).

import crypto from 'crypto';

/**
 * Verify a SendGrid Event Webhook signature using ECDSA-SHA256.
 *
 * SendGrid's algorithm:
 * 1. Concatenate the timestamp + raw body
 * 2. Verify the ECDSA-SHA256 signature against the EC public key
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
  const publicKey = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
  if (!publicKey) {
    console.warn('[sendgrid:webhook] SENDGRID_WEBHOOK_VERIFICATION_KEY not set — cannot verify signature');
    return false;
  }

  if (!signature) {
    return false;
  }

  try {
    // SendGrid provides the public key as a base64-encoded DER key.
    // Wrap it in PEM format for Node.js crypto.
    const pemKey = publicKey.includes('-----BEGIN')
      ? publicKey
      : `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`;

    // Payload to verify: timestamp + body
    const payload = (timestamp || '') + rawBody;

    const verifier = crypto.createVerify('sha256');
    verifier.update(payload);
    verifier.end();

    return verifier.verify(pemKey, signature, 'base64');
  } catch (err) {
    console.error('[sendgrid:webhook] Signature verification error:', err);
    return false;
  }
}
