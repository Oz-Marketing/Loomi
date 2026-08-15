import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { downloadFromS3, s3KeyFromPublicUrl } from '@/lib/s3';
import { generateThumbnail } from '@/lib/media-thumbnails';

/**
 * Brand logos and custom fonts, catalogued into the media library.
 *
 * These are the most-reused assets an agency owns and the DAM couldn't see any
 * of them: both upload straight to S3 and record their URL on the Account
 * (`logos`, `customFonts`), which the ad builder, emails and landing pages read
 * from directly. Nothing ever created a library row.
 *
 * ── Catalogue, don't own ──
 *
 * Account settings stays the authority. These rows point at the SAME S3 object
 * the Account record references — nothing is re-uploaded, nothing is copied. The
 * library shows them, searches them, faceted-filters them and includes them in
 * bulk downloads; it does not get to delete or move them, because doing so would
 * break a live logo. That's what `managedBy` marks and why the UI renders them
 * read-only.
 *
 * Sync is idempotent and reconciles both ways: a replaced logo updates its row,
 * a removed font deletes it. Safe to re-run for a whole account at any time,
 * which is what makes the backfill script trivial.
 *
 * Server-only.
 */

export type ManagedKind = 'account-logo' | 'account-font';

interface BrandAssetSpec {
  managedBy: ManagedKind;
  /** Stable identity within the account — the logo variant, or family|weight|style. */
  managedRef: string;
  url: string;
  filename: string;
  /** Human label used for alt text. */
  label: string;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** Everything the Account record currently claims as a brand asset. */
export function brandAssetSpecs(account: {
  logos: string | null;
  customFonts: string | null;
  customValues: string | null;
  dealer: string;
}): BrandAssetSpec[] {
  const specs: BrandAssetSpec[] = [];

  const logos = parseJson<Record<string, string>>(account.logos, {});
  for (const [variant, url] of Object.entries(logos)) {
    if (typeof url !== 'string' || !url) continue;
    const ext = url.split('.').pop()?.split('?')[0] || 'png';
    specs.push({
      managedBy: 'account-logo',
      managedRef: variant,
      url,
      filename: `${account.dealer} logo — ${variant}.${ext}`,
      label: `${account.dealer} logo, ${variant} variant`,
    });
  }

  // The storefront image lives in customValues rather than `logos` — a quirk of
  // how it was added, but it's a brand asset like the rest.
  const customValues = parseJson<Record<string, { value?: string }>>(account.customValues, {});
  const storefront = customValues.storefront_image?.value;
  if (typeof storefront === 'string' && storefront) {
    const ext = storefront.split('.').pop()?.split('?')[0] || 'jpg';
    specs.push({
      managedBy: 'account-logo',
      managedRef: 'storefront',
      url: storefront,
      filename: `${account.dealer} storefront.${ext}`,
      label: `${account.dealer} storefront photo`,
    });
  }

  const fonts = parseJson<{ family?: string; weight?: string; style?: string; url?: string }[]>(
    account.customFonts,
    [],
  );
  for (const font of fonts) {
    if (!font?.url || !font.family) continue;
    const ext = font.url.split('.').pop()?.split('?')[0] || 'woff2';
    const weight = font.weight || '400';
    const style = font.style || 'normal';
    specs.push({
      managedBy: 'account-font',
      managedRef: `${font.family}|${weight}|${style}`,
      url: font.url,
      filename: `${font.family} ${weight}${style === 'italic' ? ' italic' : ''}.${ext}`,
      label: `${font.family} ${weight} ${style}`,
    });
  }

  return specs;
}

/**
 * Reconcile one account's brand assets into the library.
 *
 * Returns what changed, so the backfill script can report rather than guess.
 */
export async function syncAccountBrandAssets(accountKey: string): Promise<{
  created: number;
  updated: number;
  removed: number;
}> {
  const result = { created: 0, updated: 0, removed: 0 };

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true, dealer: true, logos: true, customFonts: true, customValues: true, oem: true, oems: true },
  });
  if (!account) return result;

  const specs = brandAssetSpecs(account);
  const existing = await prisma.mediaAsset.findMany({
    where: { accountKey, managedBy: { not: null } },
  });

  const seen = new Set<string>();

  for (const spec of specs) {
    const identity = `${spec.managedBy}:${spec.managedRef}`;
    seen.add(identity);

    const s3Key = s3KeyFromPublicUrl(spec.url);
    // A URL we can't map back to a bucket key isn't ours to catalogue — most
    // likely an externally-hosted logo someone pasted in.
    if (!s3Key) continue;

    const current = existing.find(
      (e) => e.managedBy === spec.managedBy && e.managedRef === spec.managedRef,
    );

    // Unchanged: same object, nothing to do. This is the common case on re-run
    // and is what keeps the sync cheap enough to call on every settings save.
    if (current && current.s3Key === s3Key) continue;

    const details = await describeObject(s3Key);
    if (!details) continue;

    if (current) {
      await prisma.mediaAsset.update({
        where: { id: current.id },
        data: { s3Key, filename: spec.filename, ...details },
      });
      result.updated += 1;
    } else {
      await prisma.mediaAsset.create({
        data: {
          accountKey,
          s3Key,
          filename: spec.filename,
          managedBy: spec.managedBy,
          managedRef: spec.managedRef,
          altText: spec.label,
          // Classification is derivable here, so none of it needs a person:
          // we know it's a logo or a font, we know Oz didn't license it from a
          // third party, and we know whose brand it is.
          category: 'brand',
          assetCategory: spec.managedBy === 'account-logo' ? 'logo' : 'document',
          assetSource: 'dealer-supplied',
          oem: null,
          ...details,
        },
      });
      result.created += 1;
    }
  }

  // Anything the Account no longer claims. Only the ROW goes — the S3 object
  // belongs to the logos/fonts routes, which already delete it themselves, and
  // removing it here would race them.
  for (const row of existing) {
    if (seen.has(`${row.managedBy}:${row.managedRef}`)) continue;
    await prisma.mediaAsset.delete({ where: { id: row.id } });
    result.removed += 1;
  }

  return result;
}

/**
 * Size, dimensions and hash for an object already in the bucket.
 *
 * Downloads it — these are logos and fonts, all under 5 MB by their upload
 * routes' own limits, so this is cheap. Returns null when the object can't be
 * read, which leaves the asset uncatalogued rather than creating a row that
 * points at nothing.
 */
async function describeObject(s3Key: string): Promise<{
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  contentHash: string;
  thumbnailKey?: string | null;
} | null> {
  let buffer: Buffer;
  try {
    buffer = await downloadFromS3(s3Key);
  } catch {
    return null;
  }

  const mimeType = mimeFromKey(s3Key);
  const thumb = await generateThumbnail(buffer, mimeType);

  return {
    mimeType,
    size: buffer.length,
    width: thumb?.originalWidth ?? null,
    height: thumb?.originalHeight ?? null,
    contentHash: createHash('sha256').update(buffer).digest('hex'),
    // Deliberately no thumbnail upload: it would put a second object in the
    // bucket for an asset the library doesn't own, and the grid falls back to
    // the full image for something this small.
    thumbnailKey: null,
  };
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

function mimeFromKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}
