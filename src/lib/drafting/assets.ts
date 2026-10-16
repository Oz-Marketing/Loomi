import { createHash } from 'node:crypto';
import JSZip from 'jszip';
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
  /** The monday asset id — or `<zip asset id>#<path>` for an image that came in a zip. */
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

// ── The approved graphics ────────────────────────────────────────────────────

/** A zip of a request's final graphics — every channel, so bigger than one image. */
const MAX_ZIP_BYTES = 150 * 1024 * 1024;
/** Unpacked, across one zip. Past this it's not a folder of exported graphics. */
const MAX_UNZIPPED_BYTES = 300 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 500;

/** One file from Approved Design: an uploaded image, or an image inside an uploaded zip. */
export interface ApprovedCreative {
  /** The monday asset id, or `<zip asset id>#<path inside the zip>`. */
  id: string;
  /** What the matching reads: the file name, or its path inside the zip. */
  path: string;
  bytes: Buffer;
}

const isZip = (name: string) => /\.zip$/i.test(name);

/** The images in a zip, at their paths. Folders, macOS metadata and non-images are skipped. */
export async function imagesInZip(zipId: string, bytes: Buffer): Promise<ApprovedCreative[]> {
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files).filter(
    (e) => !e.dir && !e.name.startsWith('__MACOSX/') && !e.name.split('/').some((part) => part.startsWith('.')),
  );
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error(`The zip holds ${entries.length} files; Loomi reads at most ${MAX_ZIP_ENTRIES}.`);
  }
  const out: ApprovedCreative[] = [];
  let total = 0;
  for (const entry of entries) {
    if (!imageType({ name: entry.name, extension: '' })) continue;
    const data = await entry.async('nodebuffer');
    total += data.length;
    if (total > MAX_UNZIPPED_BYTES) throw new Error('The zip unpacks to more than Loomi will read.');
    out.push({ id: `${zipId}#${entry.name}`, path: entry.name, bytes: data });
  }
  return out;
}

/**
 * Every approved image, downloaded, with zips unpacked. PDFs, PSDs and the
 * like are skipped without downloading — only an image can be an email's hero.
 */
export async function collectApprovedCreative(files: DeliverableFile[]): Promise<ApprovedCreative[]> {
  const out: ApprovedCreative[] = [];
  for (const file of files) {
    if (isZip(file.name)) {
      const zip = await downloadMondayAsset(file.assetId, MAX_ZIP_BYTES);
      out.push(...(await imagesInZip(file.assetId, zip.bytes)));
    } else if (imageType(file)) {
      const download = await downloadMondayAsset(file.assetId);
      out.push({ id: file.assetId, path: file.name, bytes: download.bytes });
    }
  }
  return out;
}

/** One approved image again, by the id `collectApprovedCreative` gave it. */
export async function approvedCreativeBytes(id: string): Promise<Buffer> {
  const hash = id.indexOf('#');
  if (hash === -1) return (await downloadMondayAsset(id)).bytes;
  const zipId = id.slice(0, hash);
  const path = id.slice(hash + 1);
  const zip = await downloadMondayAsset(zipId, MAX_ZIP_BYTES);
  const entry = (await JSZip.loadAsync(zip.bytes)).file(path);
  if (!entry) throw new Error(`"${path}" is no longer in the approved zip.`);
  return entry.async('nodebuffer');
}

/** Keep the chosen images in Spaces, content-hashed. */
export async function storeCreative(requestId: string, files: ApprovedCreative[]): Promise<DraftAsset[]> {
  const out: DraftAsset[] = [];
  for (const file of files) {
    const name = file.path.split('/').pop() || file.path;
    const contentType = imageType({ name, extension: '' }) ?? 'application/octet-stream';
    const sha256 = createHash('sha256').update(file.bytes).digest('hex');
    let s3Key: string | null = null;
    let url: string | null = null;
    if (isS3Configured()) {
      // Hash in the key: a replaced creative is a new object, never an overwrite
      // of the one an earlier draft (or a sent email) points at.
      s3Key = `drafting/${requestId}/${sha256.slice(0, 16)}-${safeFilename(name)}`;
      await uploadToS3(s3Key, file.bytes, contentType);
      url = s3PublicUrl(s3Key);
    }
    out.push({ mondayAssetId: file.id, name: file.path, contentType, bytes: file.bytes.length, sha256, s3Key, url });
  }
  return out;
}
