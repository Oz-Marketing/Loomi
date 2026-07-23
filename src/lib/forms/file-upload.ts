/**
 * Shared constants + helpers for the `field_file` upload field.
 *
 * Single source of truth for the size cap and the docs/images allowlist so
 * the client `<input accept>`, the server-side validation, and the error
 * copy can never drift apart. The binary is uploaded to object storage by
 * the submit pipeline; only a {@link FileValue} pointer is persisted.
 */

/** Maximum size per uploaded file, in bytes (25 MB). */
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
export const MAX_FILE_SIZE_MB = 25;

/** Hard cap on files per field — guards against payload-bomb submissions. */
export const MAX_FILES_PER_FIELD = 10;

/**
 * Allowed upload types: common documents + images. Keyed by extension with
 * the MIME type(s) browsers report for each. A file passes if EITHER its
 * reported MIME type OR its extension is in the allowlist — some browsers
 * send an empty/generic MIME (e.g. application/octet-stream) for .heic/.csv.
 */
const ALLOWED: { ext: string; mimes: string[] }[] = [
  { ext: 'pdf', mimes: ['application/pdf'] },
  { ext: 'doc', mimes: ['application/msword'] },
  {
    ext: 'docx',
    mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  },
  { ext: 'xls', mimes: ['application/vnd.ms-excel'] },
  {
    ext: 'xlsx',
    mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  },
  { ext: 'csv', mimes: ['text/csv', 'application/csv'] },
  { ext: 'txt', mimes: ['text/plain'] },
  { ext: 'png', mimes: ['image/png'] },
  { ext: 'jpg', mimes: ['image/jpeg'] },
  { ext: 'jpeg', mimes: ['image/jpeg'] },
  { ext: 'gif', mimes: ['image/gif'] },
  { ext: 'webp', mimes: ['image/webp'] },
  { ext: 'heic', mimes: ['image/heic', 'image/heif'] },
];

const ALLOWED_EXTS = new Set(ALLOWED.map((a) => a.ext));
const ALLOWED_MIMES = new Set(ALLOWED.flatMap((a) => a.mimes));

/** Value for the `accept` attribute on the file `<input>`. */
export const FILE_ACCEPT_ATTR = [
  ...ALLOWED.map((a) => `.${a.ext}`),
  ...ALLOWED_MIMES,
].join(',');

/** Human-readable list of allowed types for help text / error copy. */
export const ALLOWED_FILE_TYPES_LABEL = 'PDF, Word, Excel, CSV, TXT, and images';

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

/** Whether a file's reported MIME type OR extension is on the allowlist. */
export function isAllowedFileType(mimeType: string, filename: string): boolean {
  if (mimeType && ALLOWED_MIMES.has(mimeType.toLowerCase())) return true;
  return ALLOWED_EXTS.has(extensionOf(filename));
}
