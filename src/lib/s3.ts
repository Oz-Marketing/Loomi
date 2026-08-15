import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'stream';

// Lazy-init: only created when first used (avoids errors when env vars aren't set)
let _client: S3Client | null = null;

function getClient(): S3Client {
  if (!_client) {
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    if (!accessKeyId || !secretAccessKey) {
      throw new Error('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required');
    }
    _client = new S3Client({
      region: process.env.S3_REGION || 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
      ...(process.env.S3_ENDPOINT
        ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
        : {}),
    });
  }
  return _client;
}

function getBucket(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET is required');
  return bucket;
}

/**
 * Whether object storage is configured. Lets callers (logo/avatar uploads)
 * fail with a clean 503 instead of a raw error when running without S3 creds
 * (e.g. local dev that hasn't set up Spaces).
 */
export function isS3Configured(): boolean {
  return Boolean(
    process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY && process.env.S3_BUCKET,
  );
}

/**
 * Reverse of {@link s3PublicUrl}: recover the object key from a public URL we
 * previously stored, so a replaced image can be deleted. Returns null when the
 * URL isn't one of ours (e.g. a legacy /api/logos path or an external URL).
 */
export function s3KeyFromPublicUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const prefix = process.env.S3_PUBLIC_URL_PREFIX;
  const candidates = [
    prefix ? `${prefix.replace(/\/$/, '')}/` : null,
    process.env.S3_BUCKET
      ? `https://${process.env.S3_BUCKET}.s3.${process.env.S3_REGION || 'us-east-1'}.amazonaws.com/`
      : null,
  ].filter((c): c is string => Boolean(c));

  for (const base of candidates) {
    if (url.startsWith(base)) {
      const key = url.slice(base.length).split('?')[0];
      return key || null;
    }
  }
  return null;
}

/** Resolve the public URL for an S3 object key. */
export function s3PublicUrl(key: string): string {
  const prefix = process.env.S3_PUBLIC_URL_PREFIX;
  if (prefix) return `${prefix.replace(/\/$/, '')}/${key}`;
  return `https://${getBucket()}.s3.${process.env.S3_REGION || 'us-east-1'}.amazonaws.com/${key}`;
}

/** Build the S3 key for an original asset. null accountKey = admin-level. */
export function buildS3Key(accountKey: string | null, assetId: string, filename: string): string {
  const prefix = accountKey ?? '_admin';
  return `media/${prefix}/${assetId}/${filename}`;
}

/** Build the S3 key for a thumbnail. null accountKey = admin-level. */
export function buildThumbnailKey(accountKey: string | null, assetId: string): string {
  const prefix = accountKey ?? '_admin';
  return `media/${prefix}/${assetId}/thumb.webp`;
}

/**
 * Upload a buffer to S3.
 *
 * Defaults to a public-read ACL because most callers store persistent
 * public media (logos, avatars, ad renders) served straight from the
 * bucket. Pass `{ visibility: 'private' }` for anything that shouldn't be
 * world-readable — e.g. form-submission uploads, which are lead PII and
 * are served through a gated route instead (see lib/forms/file-tokens.ts).
 */
export async function uploadToS3(
  key: string,
  body: Buffer,
  contentType: string,
  opts: { visibility?: 'public' | 'private' } = {},
): Promise<void> {
  const bucket = getBucket();
  const isPrivate = opts.visibility === 'private';
  const putBase = {
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    // Private objects are fetched through short-lived presigned URLs, so
    // they must not be cached by shared caches as if they were public.
    CacheControl: isPrivate ? 'private, no-store' : 'public, max-age=31536000, immutable',
  };

  // DO Spaces uploads are private by default; set public-read for persistent media URLs.
  const aclSetting = (process.env.S3_UPLOAD_ACL || 'public-read').trim().toLowerCase();
  const wantsPublicRead = !isPrivate && aclSetting === 'public-read';

  // State `private` explicitly rather than just omitting the ACL: omitting
  // it means "inherit the bucket default", and this bucket serves public
  // media, so a silent inherit could leave a private object world-readable.
  const acl = isPrivate ? 'private' : wantsPublicRead ? 'public-read' : undefined;

  try {
    await getClient().send(
      new PutObjectCommand({ ...putBase, ...(acl ? { ACL: acl } : {}) }),
    );
  } catch (err) {
    // Some S3-compatible backends disable ACLs; retry once without ACL in
    // that case. Object visibility is then governed by bucket policy — the
    // deployment must keep the bucket non-public for private keys to stay
    // private (see docs/form-upload-privacy.md).
    if (acl && err instanceof S3ServiceException) {
      const code = `${err.name || ''} ${err.message || ''}`.toLowerCase();
      const aclUnsupported = code.includes('accesscontrollistnotsupported') || code.includes('acl');
      if (aclUnsupported) {
        await getClient().send(new PutObjectCommand(putBase));
        return;
      }
    }
    throw err;
  }
}

/** Delete an object from S3. */
export async function deleteFromS3(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  );
}

/** Get a pre-signed URL for private asset access. */
export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: getBucket(), Key: key }),
    { expiresIn },
  );
}

/**
 * Pre-signed PUT URL, so a browser can upload straight to the bucket.
 *
 * This exists for files too large to pass through the app server: an upload via
 * `req.formData()` is buffered entirely in memory, which is what caps the normal
 * path (see lib/media-limits.ts). Going direct removes the app from the byte
 * path altogether.
 *
 * REQUIRES BUCKET CORS. The browser issues a cross-origin PUT, so the bucket
 * must allow PUT from the app's origin with the Content-Type header. Without
 * that the request fails in the browser before it reaches S3, and no amount of
 * server-side code can compensate — see docs/asset-management.md.
 *
 * `contentType` is signed into the URL, so the client must send exactly the same
 * value or S3 rejects the upload.
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 900,
): Promise<string> {
  return getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      ContentType: contentType,
      // Matches uploadToS3's default so a direct upload is readable the same way
      // everything else is.
      ACL: 'public-read',
    }),
    { expiresIn },
  );
}

/**
 * Size and type of an object already in the bucket, or null if it isn't there.
 *
 * The finalize step uses this to confirm a direct upload actually landed and to
 * learn its REAL size — the client's claim about what it uploaded can't be
 * trusted, and a row pointing at a missing object is worse than a failed upload.
 */
export async function headS3Object(
  key: string,
): Promise<{ size: number; contentType: string | null } | null> {
  try {
    const res = await getClient().send(
      new HeadObjectCommand({ Bucket: getBucket(), Key: key }),
    );
    return {
      size: res.ContentLength ?? 0,
      contentType: res.ContentType ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Open an object as a readable stream, without buffering it.
 *
 * The counterpart to downloadFromS3 for callers that pass the bytes straight
 * through to something else — bulk download zips a hundred objects, and holding
 * even one 2 GB master in memory to do it would take the process down. Returns a
 * Node Readable because that's what the zip writer consumes.
 *
 * Callers MUST consume or destroy the stream. An abandoned one holds a socket
 * from the SDK's connection pool until it times out.
 */
export async function getS3ObjectStream(key: string): Promise<Readable> {
  const res = await getClient().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: key }),
  );
  if (!res.Body) throw new Error(`Empty body for S3 key: ${key}`);
  // In Node the SDK always hands back a Readable; the union type only widens to
  // web streams in browser builds.
  return res.Body as Readable;
}

/** Download an object from S3 as a Buffer. Used for push-to-ESP. */
export async function downloadFromS3(key: string): Promise<Buffer> {
  const res = await getClient().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: key }),
  );
  const stream = res.Body;
  if (!stream) throw new Error(`Empty body for S3 key: ${key}`);
  // Convert readable stream to buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
