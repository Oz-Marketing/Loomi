/**
 * URL + key helpers for form-submission file uploads.
 *
 * Deliberately free of `node:crypto` so client components (the submissions
 * drawer) can build a file link without pulling the signing code into the
 * browser bundle. The HMAC signing and verification live next door in
 * ./file-tokens, which is server-only.
 */

/** A key plus the signed, expiring token that authorizes reading it. */
export interface SignedFileLink {
  key: string;
  expiresAt: number;
  signature: string;
}

/**
 * Object keys we're willing to serve through the form-file route. Scoped
 * to the `form-uploads/` prefix so neither a session nor a token can be
 * pointed at unrelated bucket contents.
 */
export const FORM_UPLOAD_PREFIX = 'form-uploads/';

export function isFormUploadKey(key: string): boolean {
  return key.startsWith(FORM_UPLOAD_PREFIX) && !key.includes('..');
}

/**
 * Recover the owning accountKey from a form-upload object key. Keys are
 * built as `form-uploads/{accountKey}/{formId}/{uuid}-{filename}`, which is
 * what lets the session-authenticated branch of the route enforce
 * per-account scope without a database round-trip.
 */
export function accountKeyFromFormUploadKey(key: string): string | null {
  if (!isFormUploadKey(key)) return null;
  const rest = key.slice(FORM_UPLOAD_PREFIX.length);
  const accountKey = rest.split('/')[0];
  return accountKey || null;
}

/**
 * Relative URL for a file. Pass a {@link SignedFileLink} for recipients
 * outside the app; pass just the key for in-app use, where the route
 * authorizes via the staff session instead (and so never expires).
 */
export function formFileUrl(link: SignedFileLink | { key: string }): string {
  const params = new URLSearchParams({ key: link.key });
  if ('signature' in link) {
    params.set('exp', String(link.expiresAt));
    params.set('sig', link.signature);
  }
  return `/api/forms/files?${params.toString()}`;
}

/**
 * Absolute variant — required for links that leave the app (lead
 * notification emails, ADF comments forwarded into a dealer CRM).
 */
export function absoluteFormFileUrl(link: SignedFileLink | { key: string }): string {
  const host = (process.env.NEXT_PUBLIC_APP_URL || 'https://studio.loomilm.com').replace(
    /\/+$/,
    '',
  );
  return `${host}${formFileUrl(link)}`;
}
