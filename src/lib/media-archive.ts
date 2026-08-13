/**
 * Zip inspection and extraction for media import.
 *
 * OEM portals hand out one zip per campaign, so the manual pull ends with an
 * archive rather than a set of files. Storing that as an opaque blob means the
 * assets inside are invisible to search, facets and rights — the library holds
 * the parcel and none of its contents.
 *
 * ── The distinction this module exists to make ──
 *
 * Not every zip is a collection. An Audi DAG package is a Google Web Designer
 * bundle: `animation/`, `data/config.json`, embedded fonts and `pages/` that
 * reference each other by relative path. Exploding it produces two hundred
 * fragments and destroys the only thing that was actually usable — the package.
 * A folder of campaign photography is the opposite: every entry stands alone.
 *
 * So this classifies before it extracts, and the classification is a
 * RECOMMENDATION the person can override. Guessing wrong in either direction is
 * recoverable; guessing silently is not.
 *
 * Runs in the browser. Extracted files go through the normal upload endpoint,
 * so they inherit content-hash dedupe, thumbnails, size limits and batch
 * metadata without this module reimplementing any of it.
 */

import { checkUploadSize } from '@/lib/media-limits';

/** Zip bombs are the obvious hazard. These bound the damage. */
export const MAX_ARCHIVE_ENTRIES = 500;
export const MAX_ARCHIVE_TOTAL_BYTES = 500 * 1024 * 1024;

export interface ArchiveEntry {
  /** Full path inside the zip. */
  path: string;
  /** Basename — what the asset will be called. */
  name: string;
  bytes: number;
}

export type ArchiveKind = 'collection' | 'package';

export interface ArchiveInspection {
  kind: ArchiveKind;
  /** Why it was classified that way, in words a person can act on. */
  reason: string;
  /** Entries that would become assets. */
  entries: ArchiveEntry[];
  /** Entries skipped as junk or unusable, with the reason. */
  skipped: { path: string; reason: string }[];
  totalBytes: number;
  /** Set when the archive can't be unpacked at all. */
  error?: string;
}

/**
 * jszip is imported dynamically so it only loads for someone who actually
 * stages an archive — it isn't worth adding to the media page's bundle for
 * everyone else.
 */
async function loadZip(file: File) {
  const JSZip = (await import('jszip')).default;
  return JSZip.loadAsync(file);
}

export function isZip(file: { name: string; type: string }): boolean {
  const type = (file.type || '').toLowerCase();
  return (
    type === 'application/zip'
    || type === 'application/x-zip-compressed'
    || file.name.toLowerCase().endsWith('.zip')
  );
}

/**
 * Archive noise: macOS resource forks, Finder metadata, Windows thumbnails, and
 * anything hidden. None of it is an asset and all of it appears in real zips.
 */
function junkReason(path: string): string | null {
  const name = path.split('/').pop() || '';
  if (path.startsWith('__MACOSX/') || path.includes('/__MACOSX/')) return 'macOS resource fork';
  if (name === '.DS_Store' || name === 'Thumbs.db' || name === 'desktop.ini') return 'system file';
  if (name.startsWith('.')) return 'hidden file';
  if (name === '') return 'directory';
  return null;
}

/**
 * Extensions that mean the archive is a self-referencing bundle rather than a
 * folder of assets. Markup and code only run in the context of their package;
 * their presence is the signal.
 *
 * Fonts deliberately are NOT here — a brand-asset zip legitimately ships fonts
 * as standalone deliverables, and the Audi note asks for exactly that.
 */
const PACKAGE_MARKERS = ['.html', '.htm', '.js', '.css', '.json', '.xml'];

const MEDIA_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.tif', '.tiff', '.svg',
  '.mp4', '.mov', '.webm', '.m4v',
  '.pdf', '.psd', '.ai', '.eps', '.indd',
  '.woff', '.woff2', '.otf', '.ttf',
  '.mp3', '.wav', '.aif', '.aiff',
];

function extensionOf(path: string): string {
  const name = path.split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

function isMediaFile(path: string): boolean {
  return MEDIA_EXTENSIONS.includes(extensionOf(path));
}

/**
 * Drop the single wrapper folder that zipping a directory produces.
 *
 * Only when EVERY entry shares it — two top-level folders means the structure
 * is meaningful and removing either would misrepresent the archive.
 */
export function stripCommonRoot(paths: string[]): string[] {
  if (paths.length === 0) return paths;
  const first = paths[0].split('/')[0];
  if (!first || !paths.every((p) => p.startsWith(`${first}/`))) return paths;
  return paths.map((p) => p.slice(first.length + 1));
}

/**
 * Collection or package?
 *
 * A single stray `readme.html` shouldn't condemn a folder of eighty photos, so
 * this is proportional rather than absolute: markers have to be a meaningful
 * share of the archive. The GWD case trips it comfortably — those bundles are
 * mostly markup, script and config.
 */
export function classifyEntries(paths: string[]): { kind: ArchiveKind; reason: string } {
  const media = paths.filter(isMediaFile).length;
  const markers = paths.filter((p) => PACKAGE_MARKERS.includes(extensionOf(p))).length;

  if (paths.length === 0) return { kind: 'package', reason: 'Nothing recognisable inside.' };

  // An index.html at the archive's root is the strongest single signal of a
  // runnable bundle — that's the entry point, and it means the rest is its
  // supporting material rather than a set of deliverables.
  //
  // "Root" has to account for the wrapper folder almost every real zip has:
  // zipping a directory produces `MY27_DAG_Static/index.html`, not
  // `index.html`. Strip a shared top-level folder before looking, or the check
  // only ever fires on hand-made archives.
  const hasRootIndex = stripCommonRoot(paths).some((p) => /^index\.html?$/i.test(p));
  if (hasRootIndex) {
    return {
      kind: 'package',
      reason: 'Contains an index.html — this looks like a runnable template package.',
    };
  }

  if (markers > 0 && markers >= media) {
    return {
      kind: 'package',
      reason: 'Mostly markup and config — the files reference each other, so the package is the asset.',
    };
  }

  if (media === 0) {
    return { kind: 'package', reason: 'No recognisable media files inside.' };
  }

  return {
    kind: 'collection',
    reason: `${media} media file${media === 1 ? '' : 's'} that stand on their own.`,
  };
}

/** Read a zip's table of contents without extracting it. */
export async function inspectArchive(file: File): Promise<ArchiveInspection> {
  const empty: ArchiveInspection = {
    kind: 'package',
    reason: '',
    entries: [],
    skipped: [],
    totalBytes: 0,
  };

  const zip = await loadZip(file).catch(() => null);
  if (!zip) {
    return { ...empty, error: 'This file could not be read as a zip archive.' };
  }

  const entries: ArchiveEntry[] = [];
  const skipped: { path: string; reason: string }[] = [];
  let totalBytes = 0;

  const all = Object.values(zip.files);
  if (all.length > MAX_ARCHIVE_ENTRIES) {
    return {
      ...empty,
      error: `Archive contains ${all.length} entries — more than the ${MAX_ARCHIVE_ENTRIES} supported.`,
    };
  }

  for (const entry of all) {
    if (entry.dir) continue;

    const junk = junkReason(entry.name);
    if (junk) {
      skipped.push({ path: entry.name, reason: junk });
      continue;
    }

    // jszip exposes the uncompressed size on the internal metadata; missing is
    // treated as 0 rather than trusted, and the extract step re-checks anyway.
    const bytes =
      (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;

    if (bytes === 0) {
      skipped.push({ path: entry.name, reason: 'empty file' });
      continue;
    }

    totalBytes += bytes;
    entries.push({ path: entry.name, name: entry.name.split('/').pop() || entry.name, bytes });
  }

  if (totalBytes > MAX_ARCHIVE_TOTAL_BYTES) {
    return {
      ...empty,
      error: `Archive expands to ${Math.round(totalBytes / (1024 * 1024))} MB — more than the ${
        MAX_ARCHIVE_TOTAL_BYTES / (1024 * 1024)
      } MB supported.`,
    };
  }

  const { kind, reason } = classifyEntries(entries.map((e) => e.path));
  return { kind, reason, entries, skipped, totalBytes };
}

/**
 * Extract an archive's entries as `File`s ready for the normal upload path.
 *
 * Paths are FLATTENED — an entry at `Static/Banners/hero.jpg` becomes
 * `hero.jpg`. Folders inside an OEM zip encode the manufacturer's filing, not
 * Loomi's, and §3 of the design note is explicit that folders carry no business
 * meaning here: brand, asset type and campaign are metadata, applied to the
 * whole batch at import. A name collision after flattening is disambiguated
 * rather than silently overwritten.
 */
export async function extractArchive(
  file: File,
): Promise<{ files: File[]; skipped: { path: string; reason: string }[] }> {
  const zip = await loadZip(file);

  const files: File[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const usedNames = new Set<string>();

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const junk = junkReason(entry.name);
    if (junk) {
      skipped.push({ path: entry.name, reason: junk });
      continue;
    }

    const blob = await entry.async('blob');
    if (blob.size === 0) {
      skipped.push({ path: entry.name, reason: 'empty file' });
      continue;
    }

    const base = entry.name.split('/').pop() || entry.name;
    const name = uniqueName(usedNames, base);
    const extracted = new File([blob], name, { type: blob.type || guessMime(name) });

    // Per-file ceiling, same rule the API applies — better to drop one oversized
    // entry here than to have the upload of it rejected after the fact.
    const sizeError = checkUploadSize(extracted.size, extracted.type);
    if (sizeError) {
      skipped.push({ path: entry.name, reason: sizeError });
      continue;
    }

    files.push(extracted);
  }

  return { files, skipped };
}

/** Keep flattened names distinct — two folders' `hero.jpg` must both survive. */
function uniqueName(used: Set<string>, name: string): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  while (used.has(`${stem} (${n})${ext}`)) n += 1;
  const out = `${stem} (${n})${ext}`;
  used.add(out);
  return out;
}

/**
 * Blobs from a zip usually carry no MIME type, and the upload limits and
 * thumbnail generation both key off it. Extension-based, deliberately narrow —
 * a wrong guess is worse than `application/octet-stream`, which the API handles.
 */
const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.psd': 'image/vnd.adobe.photoshop',
  '.ai': 'application/illustrator',
  '.eps': 'application/postscript',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

export function guessMime(name: string): string {
  return MIME_BY_EXT[extensionOf(name)] ?? 'application/octet-stream';
}
