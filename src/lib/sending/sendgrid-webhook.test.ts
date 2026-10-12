import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifySendGridWebhookSignature } from './sendgrid-webhook';

// Each SendGrid account and subuser signs its Event Webhook with its own key,
// and all of them post to one endpoint. With room for a single key, every
// account but one was answered 401 and its unsubscribes and bounces were
// thrown away. These pin down the list format, and that the original
// single-key value still reads exactly as it did.

function signer() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    // What SendGrid's settings page shows: base64 DER, no armour.
    base64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    pem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    // SendGrid's signature: ECDSA-SHA256 over timestamp + body, DER, base64.
    sign: (payload: string) => crypto.sign('sha256', Buffer.from(payload), privateKey).toString('base64'),
  };
}

const TIMESTAMP = '1760280000';
const BODY = JSON.stringify([{ event: 'delivered', sg_event_id: 'evt-1', email: 'pat@example.com' }]);

const first = signer();
const second = signer();
const stranger = signer();

function configure(value: string) {
  vi.stubEnv('SENDGRID_WEBHOOK_VERIFICATION_KEY', value);
}

function verify(signature: string, body = BODY, timestamp = TIMESTAMP) {
  return verifySendGridWebhookSignature(body, signature, timestamp);
}

beforeEach(() => {
  // Misconfiguration is logged; keep the test output to the assertions.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('verifySendGridWebhookSignature — one key (the original form)', () => {
  it('accepts a signature from a base64 DER key', () => {
    configure(first.base64);
    expect(verify(first.sign(TIMESTAMP + BODY))).toBe(true);
  });

  it('accepts a signature from a PEM key', () => {
    configure(first.pem);
    expect(verify(first.sign(TIMESTAMP + BODY))).toBe(true);
  });

  it('still accepts a base64 key that was pasted wrapped across lines', () => {
    // Read whole, as the single-key code always read it; split per line it
    // would be four broken keys.
    configure(first.base64.match(/.{1,40}/g)!.join('\n'));
    expect(verify(first.sign(TIMESTAMP + BODY))).toBe(true);
  });

  it('rejects a signature from any other key', () => {
    configure(first.base64);
    expect(verify(stranger.sign(TIMESTAMP + BODY))).toBe(false);
  });

  it('rejects a tampered body or timestamp', () => {
    configure(first.base64);
    const signature = first.sign(TIMESTAMP + BODY);
    expect(verify(signature, BODY.replace('delivered', 'unsubscribe'))).toBe(false);
    expect(verify(signature, BODY, '1760280001')).toBe(false);
  });

  it('rejects everything when no key is configured', () => {
    configure('');
    expect(verify(first.sign(TIMESTAMP + BODY))).toBe(false);
  });

  it('rejects a missing signature', () => {
    configure(first.base64);
    expect(verify('')).toBe(false);
  });
});

describe('verifySendGridWebhookSignature — several keys', () => {
  it('accepts a signature from the SECOND of two comma-separated keys', () => {
    configure(`${first.base64},${second.base64}`);
    expect(verify(second.sign(TIMESTAMP + BODY))).toBe(true);
    expect(verify(first.sign(TIMESTAMP + BODY))).toBe(true);
    expect(verify(stranger.sign(TIMESTAMP + BODY))).toBe(false);
  });

  it('accepts newline-separated keys, with spacing around them', () => {
    configure(`\n  ${first.base64}  \n\n  ${second.base64}\n`);
    expect(verify(second.sign(TIMESTAMP + BODY))).toBe(true);
  });

  it('accepts PEM blocks mixed with base64 entries', () => {
    configure(`${first.pem}\n${second.base64}`);
    expect(verify(first.sign(TIMESTAMP + BODY))).toBe(true);
    expect(verify(second.sign(TIMESTAMP + BODY))).toBe(true);
  });

  it('accepts a literal "\\n" separator, as an unquoted env value carries it', () => {
    configure(`${first.base64}\\n${second.base64}`);
    expect(verify(second.sign(TIMESTAMP + BODY))).toBe(true);
  });

  it('keeps verifying with the good keys when one entry is garbage', () => {
    configure(`not-a-key,${second.base64}`);
    expect(verify(second.sign(TIMESTAMP + BODY))).toBe(true);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('1 of 2 entries in SENDGRID_WEBHOOK_VERIFICATION_KEY are not valid public keys'),
    );
  });
});
