import sharp from 'sharp';

const THUMB_MAX = 400;

const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/tiff',
]);

export function isImageMime(mimeType: string): boolean {
  return IMAGE_MIMES.has(mimeType.toLowerCase());
}

export interface ThumbnailResult {
  buffer: Buffer;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

/**
 * Generate a WebP thumbnail for an image buffer.
 * Returns null for non-images or on failure (graceful degradation).
 */
export async function generateThumbnail(
  input: Buffer,
  mimeType: string,
): Promise<ThumbnailResult | null> {
  if (!isImageMime(mimeType)) return null;

  try {
    const image = sharp(input);
    const metadata = await image.metadata();
    const originalWidth = metadata.width || 0;
    const originalHeight = metadata.height || 0;

    const thumb = await image
      .resize(THUMB_MAX, THUMB_MAX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: thumb.data,
      width: thumb.info.width,
      height: thumb.info.height,
      originalWidth,
      originalHeight,
    };
  } catch {
    return null;
  }
}

/**
 * Largest object we will pull back out of storage purely to make a thumbnail.
 *
 * The direct-to-S3 upload path exists so the app never holds a whole file in
 * memory, and that constraint is real for a video or a layered PSD. It is not
 * real for a logo. Measured against production: 809 of the 940 images in the
 * library had no thumbnail, and the largest was 5MB — so the cap costs nothing
 * in practice while still refusing the case the constraint was written for.
 *
 * Deliberately well above the observed maximum. A cap that only just clears
 * today's data quietly starts skipping the moment someone uploads a bigger
 * photo, and nobody would notice.
 */
export const THUMBNAIL_SOURCE_MAX = 25 * 1024 * 1024;

/** Whether finalize should fetch this object back to thumbnail it. */
export function shouldThumbnailOnFinalize(mimeType: string, size: number): boolean {
  return isImageMime(mimeType) && size > 0 && size <= THUMBNAIL_SOURCE_MAX;
}
