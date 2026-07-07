/**
 * Auto-crop an EVOX vehicle image tight to the car.
 *
 * EVOX ships each vehicle on a large canvas with wide empty margins and a small
 * "©EVOX IMAGES" watermark baked into the bottom-right corner (opaque, even on
 * the transparent-PNG product). Designers were cropping every image by hand to
 * get the car flush to the frame and drop the watermark; this does it on import.
 *
 * How: find the vehicle's bounding box from the pixels, IGNORING a small
 * bottom-right corner (where the watermark lives, well clear of the car in
 * EVOX's standard framing), then crop to that box. Because the watermark sits
 * outside the car's box, cropping tight removes it in the same step. Works on
 * the transparent-PNG product (box from the alpha channel) and on any
 * white-background variant (box from non-white pixels).
 *
 * sharp-only (no S3/prisma) so it's cheap to unit-test and reuse. Never throws:
 * on any failure or an all-empty image it returns the input unchanged.
 */
import sharp from 'sharp';

export interface AutoCropOptions {
  /** Fraction of width, from the right edge, treated as the watermark zone. */
  wmRightFrac?: number;
  /** Fraction of height, from the bottom edge, treated as the watermark zone. */
  wmBottomFrac?: number;
  /** Alpha at/below this is background (0–255). */
  alphaThreshold?: number;
  /** In white-bg mode, RGB channels at/above this are background (0–255). */
  whiteThreshold?: number;
  /** Optional breathing room added back on every side, as a fraction of the
   *  cropped long edge (0 = flush to the vehicle). */
  padFrac?: number;
}

const DEFAULTS: Required<AutoCropOptions> = {
  // The watermark measures ~9%×3% of the frame in the far corner; these are
  // generous enough to cover it at any resolution yet stay well clear of the
  // car, which EVOX frames with a wide bottom/right margin.
  wmRightFrac: 0.15,
  wmBottomFrac: 0.08,
  alphaThreshold: 32,
  whiteThreshold: 244,
  padFrac: 0,
};

/**
 * Returns the vehicle-tight buffer (PNG) plus whether anything was cropped.
 * Falls back to the original bytes on any error.
 */
export async function autoCropVehicleImage(
  input: Buffer,
  options: AutoCropOptions = {},
): Promise<{ buffer: Buffer; cropped: boolean }> {
  const o = { ...DEFAULTS, ...options };
  try {
    const { data, info } = await sharp(input, { failOn: 'none' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const W = info.width;
    const H = info.height;
    const C = info.channels;
    if (!W || !H) return { buffer: input, cropped: false };

    // Transparent product vs a flattened white background — decided by the
    // top-left corner (always background in EVOX framing).
    const transparentMode = data[3] < 200;
    const wmX0 = Math.floor(W * (1 - o.wmRightFrac));
    const wmY0 = Math.floor(H * (1 - o.wmBottomFrac));

    let minX = W;
    let minY = H;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x >= wmX0 && y >= wmY0) continue; // skip the watermark corner
        const i = (y * W + x) * C;
        if (data[i + 3] <= o.alphaThreshold) continue;
        if (!transparentMode && data[i] >= o.whiteThreshold && data[i + 1] >= o.whiteThreshold && data[i + 2] >= o.whiteThreshold) {
          continue; // white-bg background pixel
        }
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < minX || maxY < minY) return { buffer: input, cropped: false };

    const left = minX;
    const top = minY;
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    // Nothing meaningful to trim (already tight) — keep the original bytes.
    if (left === 0 && top === 0 && width === W && height === H) return { buffer: input, cropped: false };

    let pipe = sharp(input, { failOn: 'none' }).extract({ left, top, width, height });
    if (o.padFrac > 0) {
      const px = Math.round(Math.max(width, height) * o.padFrac);
      const background = transparentMode
        ? { r: 0, g: 0, b: 0, alpha: 0 }
        : { r: 255, g: 255, b: 255, alpha: 1 };
      pipe = pipe.extend({ top: px, bottom: px, left: px, right: px, background });
    }
    const buffer = await pipe.png().toBuffer();
    return { buffer, cropped: true };
  } catch {
    return { buffer: input, cropped: false };
  }
}
