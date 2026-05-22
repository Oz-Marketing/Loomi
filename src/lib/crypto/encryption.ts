// ── Shared AES-256-GCM Encryption ──
// Used by all ESP adapters for encrypting tokens and API keys at rest.

import crypto from 'crypto';
import { requireEspTokenSecrets } from '@/lib/crypto/secrets';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function assertConfiguredSecrets(): string[] {
  return requireEspTokenSecrets();
}

function deriveEncryptionKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}

function decryptWithKey(
  encrypted: string,
  key: Buffer,
): string {
  const [ivB64, authTagB64, ciphertextB64] = encrypted.split(':');
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Invalid encrypted token format');
  }
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns: iv:authTag:ciphertext (all base64)
 */
export function encryptToken(plaintext: string): string {
  const [primarySecret] = assertConfiguredSecrets();
  const key = deriveEncryptionKey(primarySecret);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt a token encrypted by encryptToken().
 */
export function decryptToken(encrypted: string): string {
  const secrets = assertConfiguredSecrets();
  let lastError: unknown = null;

  for (const secret of secrets) {
    try {
      return decryptWithKey(encrypted, deriveEncryptionKey(secret));
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error('Failed to decrypt token with configured ESP secrets', {
    cause: lastError,
  });
}
