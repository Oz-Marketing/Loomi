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
 * Uploads go through `req.formData()` and are buffered in memory before they
 * reach S3, so these ceilings are bounded by what the Node process can hold, not
 * by what the bucket can take. The numbers below are set accordingly. Genuinely
 * large media — multi-gigabyte video masters, full InDesign packages — needs
 * presigned direct-to-S3 uploads so the bytes never touch the app server. That
 * is a separate piece of work, deliberately not smuggled in here: raising these
 * constants past what the buffered path can survive would trade a clear error
 * for an out-of-memory crash.
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

/** null when the file is fine; an error message when it isn't. */
export function checkUploadSize(
  size: number,
  mimeType: string | null | undefined,
): string | null {
  const limit = uploadLimitFor(mimeType);
  if (size <= limit.bytes) return null;
  return `${formatBytes(size)} exceeds the ${formatBytes(limit.bytes)} limit for ${limit.label.toLowerCase()}`;
}
