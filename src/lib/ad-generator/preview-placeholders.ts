import type { FieldSpec } from './types';
import type { AdData } from './types';

/**
 * Stand-in imagery for the BUILDER CANVAS ONLY.
 *
 * An unfilled vehicle slot rendered as a dashed "Image" box, which tells you
 * nothing about how the ad will look — the whole design hangs off the size and
 * proportions of the car.
 *
 * The good answer is a REAL jellybean for a model the dealer actually has, which
 * `/api/ad-generator/sample-vehicle` resolves from their own inventory (EVOX first,
 * their feed photo second); the builder passes it in as `sampleUrl`. The drawn
 * silhouette below is only the floor — what shows when there's no inventory yet, or
 * EVOX isn't configured in this environment. It stays deliberately un-car-like
 * enough that nobody mistakes it for the finished ad.
 *
 * Never reaches an export or a saved ad: only the builder's canvas data runs through
 * {@link withPreviewPlaceholders}.
 */

/** Which fields a placeholder is worth inventing for. */
const VEHICLE_IMAGE_KEY = /vehicleimageurl$/i;

/**
 * A flat crossover silhouette, 1200×600 on a transparent ground — the shape and
 * aspect of the transparent PNGs the real slot takes, so `contain` behaves as it
 * will in production.
 *
 * One flat tone, no outline, no wheel detail, no text inside the art. A
 * low-detail shape reads as "a car goes here" and stays out of the way; the
 * half-drawn one it replaces just looked like a bad drawing of a car. Crossover
 * proportions because that's the body style most dealer ads carry.
 */
const VEHICLE_SILHOUETTE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600" width="1200" height="600">
  <g fill="#0f172a" fill-opacity="0.14">
    <path d="M138 430 Q140 366 196 352 L358 314 Q436 232 548 226 L744 218 Q852 220 926 274 L1036 356 Q1090 368 1094 408 Q1096 438 1062 442 L138 442 Q132 438 138 430 Z"/>
    <circle cx="352" cy="446" r="66"/>
    <circle cx="906" cy="446" r="66"/>
  </g>
  <g fill="#f8fafc">
    <circle cx="352" cy="446" r="27"/>
    <circle cx="906" cy="446" r="27"/>
    <path d="M404 306 Q464 250 552 246 L700 240 L714 306 Z" fill-opacity="0.55"/>
    <path d="M746 242 L836 248 Q896 268 946 306 L746 306 Z" fill-opacity="0.55"/>
  </g>
</svg>`;

/** The silhouette as a data URI — no network, no licensing, works in an iframe. */
export const VEHICLE_PLACEHOLDER_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  VEHICLE_SILHOUETTE_SVG.replace(/\n\s*/g, ' '),
)}`;

export function isVehicleImageField(key: string): boolean {
  return VEHICLE_IMAGE_KEY.test(key);
}

/**
 * Fill empty vehicle-image fields with the sample silhouette.
 *
 * Only touches keys the template actually declares as image fields, and only the
 * vehicle ones — an empty logo or badge slot is better read as the dashed box that
 * says "nothing here yet". Returns the same object when there's nothing to fill,
 * so it's cheap to call from a memo.
 */
export function withPreviewPlaceholders(
  data: AdData,
  fields: FieldSpec[],
  /** A real vehicle image for this account, when one could be resolved. */
  sampleUrl?: string | null,
): AdData {
  const empty = fields.filter(
    (f) => f.type === 'image' && isVehicleImageField(f.key) && !String(data[f.key] ?? '').trim(),
  );
  if (!empty.length) return data;
  const fill = sampleUrl?.trim() || VEHICLE_PLACEHOLDER_URL;
  const next = { ...data };
  for (const f of empty) next[f.key] = fill;
  return next;
}
