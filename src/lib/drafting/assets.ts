import { createHash } from 'node:crypto';
import { downloadMondayAsset } from '@/lib/monday/client';
import { isS3Configured, s3PublicUrl, uploadToS3 } from '@/lib/s3';
import type { DeliverableFile } from './monday-board';

/**
 * The approved creative, copied out of monday.
 *
 * Copied rather than linked, for two reasons. monday's file links are signed
 * and expire within the hour, and the creative becomes the email's hero image,
 * which needs a URL that still works when the email is opened next month. And
 * design can replace a file after it was approved: the content hash is what
 * tells a re-read creative from a different one.
 */

/** A design asset as a DraftRequest records it. */
export interface DraftAsset {
  mondayAssetId: string;
  name: string;
  contentType: string;
  bytes: number;
  sha256: string;
  /**
   * Its key in Spaces. Null where S3 isn't configured (local development);
   * later stages then read the bytes from monday again.
   */
  s3Key: string | null;
  /** Public URL — the email's hero image. Null without S3. */
  url: string | null;
}

/**
 * Formats drafting can use. Images only: the creative is the email's hero, and
 * a PDF or a layered PSD can't be one — design exports the approved frame.
 */
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export function imageType(file: Pick<DeliverableFile, 'extension' | 'name'>): string | null {
  const ext = (file.extension || file.name.slice(file.name.lastIndexOf('.'))).toLowerCase();
  return IMAGE_TYPES[ext.startsWith('.') ? ext : `.${ext}`] ?? null;
}

/** "Oct Offer (final) 600x900.PNG" → "oct-offer-final-600x900.png". */
export function safeFilename(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const ext = dot > 0 ? name.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, '') : '';
  return `${base || 'creative'}${ext}`;
}

/** Same files, same bytes — order ignored. */
export function sameCreative(before: DraftAsset[] | null, after: DraftAsset[]): boolean {
  if (!before) return false;
  const a = before.map((x) => x.sha256).sort();
  const b = after.map((x) => x.sha256).sort();
  return a.length === b.length && a.every((h, i) => h === b[i]);
}

/** Download each approved image from monday and keep it in Spaces. */
export async function copyDesignAssets(requestId: string, files: DeliverableFile[]): Promise<DraftAsset[]> {
  const out: DraftAsset[] = [];
  for (const file of files) {
    const contentType = imageType(file);
    if (!contentType) continue;
    const download = await downloadMondayAsset(file.assetId);
    const sha256 = createHash('sha256').update(download.bytes).digest('hex');
    let s3Key: string | null = null;
    let url: string | null = null;
    if (isS3Configured()) {
      // Hash in the key: a replaced creative is a new object, never an overwrite
      // of the one an earlier draft (or a sent email) points at.
      s3Key = `drafting/${requestId}/${sha256.slice(0, 16)}-${safeFilename(file.name)}`;
      await uploadToS3(s3Key, download.bytes, contentType);
      url = s3PublicUrl(s3Key);
    }
    out.push({
      mondayAssetId: file.assetId,
      name: file.name,
      contentType,
      bytes: download.bytes.length,
      sha256,
      s3Key,
      url,
    });
  }
  return out;
}
