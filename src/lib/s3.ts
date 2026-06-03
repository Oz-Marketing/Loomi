import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

/** Upload a buffer to S3. */
export async function uploadToS3(key: string, body: Buffer, contentType: string): Promise<void> {
  const bucket = getBucket();
  const putBase = {
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  };

  // DO Spaces uploads are private by default; set public-read for persistent media URLs.
  const aclSetting = (process.env.S3_UPLOAD_ACL || 'public-read').trim().toLowerCase();
  const wantsPublicRead = aclSetting === 'public-read';

  try {
    await getClient().send(
      new PutObjectCommand({
        ...putBase,
        ...(wantsPublicRead ? { ACL: 'public-read' } : {}),
      }),
    );
  } catch (err) {
    // Some S3-compatible backends disable ACLs; retry once without ACL in that case.
    if (wantsPublicRead && err instanceof S3ServiceException) {
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
