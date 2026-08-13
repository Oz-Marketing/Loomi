/**
 * Upload size limits — Phase 4 of docs/asset-management.md.
 *
 * The library ran on one flat 25 MB ceiling. That is fine for a display banner
 * and useless for the masters a DAM is supposed to hold: a layered PSD, an
 * InDesign package or a video clears it immediately, so the "master" never got
 * stored and only its exports did — which is the opposite of how a DAM works.
 *
 * Limits are per MIME family, shared by the client and the API so the browser
 * refuses a file for the same reason the server would.
 *
 * ── The honest constraint ──
 *
 * The BUFFERED path goes through `req.formData()` and holds the whole file in
 * memory before it reaches S3, so the ceilings below are bounded by what the Node
 * process can survive — not by what the bucket accepts. Raising them past that
 * point would trade a clear error message for an out-of-memory crash.
 *
 * Anything larger takes the DIRECT path instead (see needsDirectUpload): the
 * browser PUTs straight to S3 with a pre-signed URL and the app never touches the
 * bytes. That lifts the ceiling to DIRECT_UPLOAD_MAX_BYTES, at the cost of the
 * content hash and the generated thumbnail, both of which need the bytes
 * server-side. So direct upload is the escape hatch for masters, not the default.
 */

export interface UploadLimit {
  /** Max bytes for this family. */
  bytes: number;
  /** What to call it in an error message. */
  label: string;
}

const MB = 1024 * 1024;

/**
 * Matched in order, first hit wins. Prefixes rather than exact MIME types
 * because the long tail (`image/x-adobe-dng`, `video/quicktime`) is endless and
 * the family is what determines the sensible ceiling.
 */
const LIMITS: { test: (mime: string) => boolean; limit: UploadLimit }[] = [
  {
    // FIRST, before the `image/` prefix below. A PSD's MIME type is
    // `image/vnd.adobe.photoshop`, so the generic image rule would otherwise
    // claim it and cap a layered master at the flat-JPEG limit — which is the
    // exact file this phase exists to let through.
    //
    // Design masters: PSD, AI, INDD, and the zipped packages OEMs ship their
    // templates in (the Audi case in §11).
    test: (m) =>
      m === 'application/zip'
      || m === 'application/x-zip-compressed'
      || m === 'image/vnd.adobe.photoshop'
      || m === 'application/postscript'
      || m === 'application/illustrator'
      || m === 'application/x-indesign'
      || m === 'application/octet-stream',
    limit: { bytes: 200 * MB, label: 'Design files and archives' },
  },
  { test: (m) => m.startsWith('image/'), limit: { bytes: 50 * MB, label: 'Images' } },
  { test: (m) => m.startsWith('video/'), limit: { bytes: 200 * MB, label: 'Video' } },
  { test: (m) => m.startsWith('audio/'), limit: { bytes: 100 * MB, label: 'Audio' } },
  {
    test: (m) => m === 'application/pdf' || m.startsWith('text/') || m.includes('officedocument') || m.includes('msword'),
    limit: { bytes: 50 * MB, label: 'Documents' },
  },
];

/** Anything unrecognised. Deliberately generous enough to be useful, low enough to be safe. */
const DEFAULT_LIMIT: UploadLimit = { bytes: 50 * MB, label: 'Files' };

export function uploadLimitFor(mimeType: string | null | undefined): UploadLimit {
  const mime = (mimeType || '').toLowerCase();
  return LIMITS.find((l) => l.test(mime))?.limit ?? DEFAULT_LIMIT;
}

/** The largest limit any family allows — for "max file size" copy in the UI. */
export const MAX_UPLOAD_BYTES = Math.max(
  DEFAULT_LIMIT.bytes,
  ...LIMITS.map((l) => l.limit.bytes),
);

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(bytes % (1024 * MB) === 0 ? 0 : 1)} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * Ceiling for a DIRECT (pre-signed) upload.
 *
 * 5 GB is S3's hard limit for a single PUT — past that you need multipart, which
 * is a materially bigger client. Anything this large is a video or an InDesign
 * package, and both are well served by one PUT.
 */
export const DIRECT_UPLOAD_MAX_BYTES = 5 * 1024 * MB;

/**
 * Should this file bypass the app server?
 *
 * Anything the buffered path can carry keeps using it, because that path also
 * gives us a content hash for dedupe and a generated thumbnail — both of which
 * need the bytes server-side. Direct upload trades those away for size, so it's
 * the escape hatch rather than the default.
 */
export function needsDirectUpload(size: number, mimeType: string | null | undefined): boolean {
  return size > uploadLimitFor(mimeType).bytes;
}

/**
 * null when the file is acceptable by SOME route; an error when it's too big for
 * even a direct upload.
 */
export function checkAnyUploadSize(size: number): string | null {
  if (size <= DIRECT_UPLOAD_MAX_BYTES) return null;
  return `${formatBytes(size)} exceeds the ${formatBytes(DIRECT_UPLOAD_MAX_BYTES)} maximum`;
}

/** null when the file is fine; an error message when it isn't. */
export function checkUploadSize(
  size: number,
  mimeType: string | null | undefined,
): string | null {
  const limit = uploadLimitFor(mimeType);
  if (size <= limit.bytes) return null;
  return `${formatBytes(size)} exceeds the ${formatBytes(limit.bytes)} limit for ${limit.label.toLowerCase()}`;
}
