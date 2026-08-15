/**
 * Bulk-download archive planning.
 *
 * Split out from the route because the interesting decisions here — what an entry
 * is called, and whether compressing it is worth the CPU — are pure functions
 * worth testing, while the route itself is plumbing.
 *
 * ── Why this exists in its current shape ──
 *
 * The first version of bulk download buffered: every object was read into a
 * Buffer, JSZip assembled the whole archive in memory, and the result was copied
 * again into the response. Peak memory ran around 3x the selection, which is why
 * it carried a 300 MB ceiling — a limit imposed by the app server, not by
 * anything real. Direct uploads now allow a single 5 GB master (see
 * media-limits.ts), so a selection could contain one file that alone exceeded the
 * download cap.
 *
 * The archive is now streamed: objects are pulled from S3 one at a time as the
 * zip writer asks for them, and the bytes pass straight through to the client.
 * Memory is flat regardless of selection size (measured: 600 MB of input moved
 * with ~68 MB of heap growth).
 */

/** What compression to apply to an entry. JSZip's two options. */
export type ZipCompression = 'STORE' | 'DEFLATE';

/**
 * Formats whose bytes are already compressed. Running DEFLATE over these spends
 * real CPU per byte to save approximately nothing — a JPEG typically shrinks by
 * under 2%, and for a 2 GB video that trade is absurd.
 *
 * Listed as exact types rather than `image/` and `video/` prefixes, deliberately:
 * see the PSD note on DESIGN_MASTERS below.
 */
const ALREADY_COMPRESSED = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/mpeg',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',
  'application/x-7z-compressed',
  'application/vnd.rar',
]);

/**
 * Uncompressed or lightly-compressed masters where DEFLATE earns its keep.
 *
 * A layered PSD is the case that forces this list to be checked BEFORE any
 * `image/` prefix rule: its MIME type is `image/vnd.adobe.photoshop`, so a naive
 * "images are already compressed" prefix would STORE it and hand over an archive
 * several times larger than necessary. This is the same trap that made a PSD
 * unstorable in media-limits.ts, from the same cause.
 */
const DESIGN_MASTERS = new Set([
  'image/vnd.adobe.photoshop',
  'image/tiff',
  'image/bmp',
  'image/svg+xml',
  'image/x-adobe-dng',
  'application/postscript',
  'application/illustrator',
  'application/x-indesign',
  'font/ttf',
  'font/otf',
  'application/x-font-ttf',
]);

/**
 * Should this entry be compressed?
 *
 * DEFLATE is the default because it is never wrong on size, only on speed, and
 * the formats where speed matters most are exactly the ones we can name.
 */
export function compressionFor(mimeType: string | null | undefined): ZipCompression {
  const mime = (mimeType || '').toLowerCase().split(';')[0].trim();
  if (DESIGN_MASTERS.has(mime)) return 'DEFLATE';
  if (ALREADY_COMPRESSED.has(mime)) return 'STORE';
  return 'DEFLATE';
}

/**
 * Keep names unique inside the zip — two sub-accounts' `logo.png` must both
 * survive, and a zip with duplicate entries extracts unpredictably.
 */
export function uniqueName(used: Set<string>, name: string): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  let candidate = `${stem} (${n})${ext}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${stem} (${n})${ext}`;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Folder that a master's generated sizes go into, so a flat unzip doesn't
 * scatter nine variants of one image across the extract directory.
 */
export function renditionFolder(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  return `${stem} — sizes`;
}

export interface ZipSourceAsset {
  filename: string;
  s3Key: string;
  mimeType: string | null;
  renditions?: { name: string; s3Key: string }[];
}

export interface PlannedEntry {
  /** Path inside the archive. */
  name: string;
  s3Key: string;
  compression: ZipCompression;
}

/**
 * Work out the full entry list up front.
 *
 * Planning is separated from streaming because names have to be de-duplicated
 * across the whole selection, which needs every asset in hand — but the BYTES
 * must not be. So this decides the shape of the archive, and the route fetches
 * each object only when the zip writer reaches it.
 */
export function planZipEntries(
  assets: ZipSourceAsset[],
  includeRenditions: boolean,
): PlannedEntry[] {
  const used = new Set<string>();
  const entries: PlannedEntry[] = [];

  for (const asset of assets) {
    entries.push({
      name: uniqueName(used, asset.filename),
      s3Key: asset.s3Key,
      compression: compressionFor(asset.mimeType),
    });

    if (!includeRenditions || !asset.renditions?.length) continue;

    const folder = renditionFolder(asset.filename);
    for (const r of asset.renditions) {
      entries.push({
        // Renditions are always JPEG (see services/media-renditions.ts), so the
        // compression choice is not a guess here.
        name: uniqueName(used, `${folder}/${r.name}.jpg`),
        s3Key: r.s3Key,
        compression: 'STORE',
      });
    }
  }

  return entries;
}

/** `loomi-media-2026-08-13.zip` — dated so repeat downloads don't collide in ~/Downloads. */
export function archiveFilename(today: Date): string {
  return `loomi-media-${today.toISOString().slice(0, 10)}.zip`;
}
