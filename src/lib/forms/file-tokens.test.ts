import { describe, it, expect, beforeAll } from 'vitest';
import { signFileKey, verifyFileToken, FILE_TOKEN_TTL_DAYS } from './file-tokens';
import {
  isFormUploadKey,
  accountKeyFromFormUploadKey,
  formFileUrl,
  absoluteFormFileUrl,
} from './file-links';

const KEY = 'form-uploads/acme/form_123/uuid-title.pdf';

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-for-file-tokens';
});

describe('signFileKey / verifyFileToken', () => {
  it('round-trips a freshly signed token', () => {
    const link = signFileKey(KEY);
    const verdict = verifyFileToken({
      key: link.key,
      exp: String(link.expiresAt),
      sig: link.signature,
    });
    expect(verdict).toEqual({ ok: true, key: KEY });
  });

  it('expires after the advertised TTL', () => {
    const now = 1_800_000_000_000;
    const link = signFileKey(KEY, now);
    const justInside = now + FILE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000 - 1000;
    const justOutside = link.expiresAt + 1000;

    const params = { key: link.key, exp: String(link.expiresAt), sig: link.signature };
    expect(verifyFileToken(params, justInside).ok).toBe(true);
    expect(verifyFileToken(params, justOutside)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token whose key was swapped for another', () => {
    const link = signFileKey(KEY);
    const verdict = verifyFileToken({
      key: 'form-uploads/other-account/form_9/uuid-secret.pdf',
      exp: String(link.expiresAt),
      sig: link.signature,
    });
    expect(verdict).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a token whose expiry was extended', () => {
    const link = signFileKey(KEY);
    const verdict = verifyFileToken({
      key: link.key,
      exp: String(link.expiresAt + 10_000_000),
      sig: link.signature,
    });
    expect(verdict).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a missing or malformed token', () => {
    expect(verifyFileToken({ key: KEY, exp: null, sig: null }).ok).toBe(false);
    expect(verifyFileToken({ key: KEY, exp: 'abc', sig: 'x' })).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(verifyFileToken({ key: '', exp: '1', sig: 'x' })).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('is not fooled by re-splitting the signed message', () => {
    // The signed message is length-prefixed, so a key/exp pair that would
    // otherwise concatenate to the same string must not validate.
    const link = signFileKey('form-uploads/a/b/c:123');
    const verdict = verifyFileToken({
      key: 'form-uploads/a/b/c',
      exp: '123',
      sig: link.signature,
    });
    expect(verdict.ok).toBe(false);
  });
});

describe('form upload key guards', () => {
  it('accepts only keys under the form-uploads prefix', () => {
    expect(isFormUploadKey(KEY)).toBe(true);
    expect(isFormUploadKey('media/acme/logo.png')).toBe(false);
    expect(isFormUploadKey('form-uploads/../media/acme/logo.png')).toBe(false);
  });

  it('recovers the owning accountKey', () => {
    expect(accountKeyFromFormUploadKey(KEY)).toBe('acme');
    expect(accountKeyFromFormUploadKey('media/acme/logo.png')).toBeNull();
  });
});

describe('formFileUrl', () => {
  it('omits token params for in-app (session-authenticated) links', () => {
    const url = formFileUrl({ key: KEY });
    expect(url).toContain(`key=${encodeURIComponent(KEY)}`);
    expect(url).not.toContain('sig=');
    expect(url).not.toContain('exp=');
  });

  it('includes token params for external links', () => {
    const url = formFileUrl(signFileKey(KEY));
    expect(url).toContain('sig=');
    expect(url).toContain('exp=');
  });

  it('builds an absolute URL for email / CRM recipients', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://studio.example.com/';
    const url = absoluteFormFileUrl(signFileKey(KEY));
    expect(url.startsWith('https://studio.example.com/api/forms/files?')).toBe(true);
  });
});
