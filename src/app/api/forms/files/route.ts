/**
 * Gated access to form-submission file uploads.
 *
 * Uploads are stored private (see lib/forms/submit.ts), so this route is
 * the only way to read one. It authorizes a request two ways:
 *
 *   1. A signed, expiring token — the link we put in lead notification
 *      emails and ADF/CRM comments, for dealers who have no Loomi login.
 *   2. A Loomi session scoped to the owning account — the submissions
 *      drawer links here without a token, so staff access never expires.
 *
 * On success we 302 to a short-lived presigned URL rather than streaming
 * the bytes, so the download comes straight from object storage.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, getAccountScope } from '@/lib/api-auth';
import { getPresignedUrl, isS3Configured } from '@/lib/s3';
import { verifyFileToken } from '@/lib/forms/file-tokens';
import { isFormUploadKey, accountKeyFromFormUploadKey } from '@/lib/forms/file-links';

/** Lifetime of the presigned URL we hand out — long enough to start the
 *  download, short enough that a leaked redirect target is near-useless. */
const PRESIGN_TTL_SECONDS = 300;

function deny(status: number, error: string) {
  return NextResponse.json(
    { error },
    { status, headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const key = params.get('key');

  // Confine this route to the form-uploads prefix before doing anything
  // else, so neither a session nor a token can point it at other objects.
  if (!key || !isFormUploadKey(key)) {
    return deny(400, 'Invalid file reference');
  }

  const sig = params.get('sig');
  let authorized = false;

  if (sig) {
    const verdict = verifyFileToken({ key, exp: params.get('exp'), sig });
    if (!verdict.ok) {
      return verdict.reason === 'expired'
        ? deny(410, 'This file link has expired. Open the submission in Loomi to download it.')
        : deny(403, 'Invalid file link');
    }
    authorized = true;
  } else {
    // No token — fall back to session auth, scoped to the owning account.
    const session = await getAuthSession();
    if (!session?.user) return deny(401, 'Unauthorized');

    const accountKey = accountKeyFromFormUploadKey(key);
    if (!accountKey) return deny(400, 'Invalid file reference');

    const scope = getAccountScope(session);
    // Deliberately stricter than canAccessAccount(): an empty scope means
    // "no accounts assigned", which must not read another account's lead
    // PII. Only an unscoped role (developer / super_admin) sees everything.
    authorized = scope === null || scope.includes(accountKey);
    if (!authorized) return deny(403, 'Forbidden');
  }

  if (!isS3Configured()) {
    return deny(503, 'File storage is not configured');
  }

  const url = await getPresignedUrl(key, PRESIGN_TTL_SECONDS);
  return NextResponse.redirect(url, {
    status: 302,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
