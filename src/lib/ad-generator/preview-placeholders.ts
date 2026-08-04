import type { FieldSpec } from './types';
import type { AdData } from './types';

/**
 * Stand-in imagery for the BUILDER CANVAS ONLY.
 *
 * An unfilled vehicle slot rendered as a dashed "Image" box, which tells you
 * nothing about how the ad will look — the whole design hangs off the size and
 * silhouette of the car. So the canvas fills empty vehicle slots with a generic
 * three-quarter-view car at roughly jellybean proportions.
 *
 * Deliberately NOT an EVOX render: that imagery is licensed per vehicle and has no
 * business being baked into the app. It's a flat neutral silhouette, obviously a
 * placeholder rather than a real car, so nobody mistakes it for the finished ad.
 *
 * Never reaches an export or a saved ad: only the builder's preview data runs
 * through {@link withPreviewPlaceholders}, and the value is a local data URI, so
 * even if one leaked into a render it couldn't fetch anything.
 */

/** Which fields a placeholder is worth inventing for. */
const VEHICLE_IMAGE_KEY = /vehicleimageurl$/i;

/**
 * A three-quarter-view car silhouette, sized 1200×600 with a transparent
 * background — the same shape as the transparent PNGs the real slot takes, so the
 * `contain` fit behaves the same as it will in production.
 */
const VEHICLE_SILHOUETTE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600" width="1200" height="600">
  <g fill="none" stroke="#94a3b8" stroke-width="10" stroke-linejoin="round" stroke-linecap="round">
    <path fill="#cbd5e1" fill-opacity="0.55" d="M120 430 Q118 372 168 356 L322 318 Q404 236 520 224 L742 214 Q846 212 918 262 L1020 332 Q1082 344 1090 396 Q1094 428 1062 436 L980 440 L232 440 L150 436 Q122 434 120 430 Z"/>
    <path fill="#e2e8f0" fill-opacity="0.75" d="M372 316 Q436 254 520 246 L700 240 L722 316 Z"/>
    <path fill="#e2e8f0" fill-opacity="0.75" d="M752 240 L830 244 Q890 262 942 302 L960 318 L752 316 Z"/>
    <circle cx="352" cy="440" r="74" fill="#94a3b8" fill-opacity="0.35"/>
    <circle cx="352" cy="440" r="34" fill="#f8fafc"/>
    <circle cx="900" cy="440" r="74" fill="#94a3b8" fill-opacity="0.35"/>
    <circle cx="900" cy="440" r="34" fill="#f8fafc"/>
  </g>
  <text x="600" y="540" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="34" fill="#94a3b8" letter-spacing="2">SAMPLE VEHICLE</text>
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
export function withPreviewPlaceholders(data: AdData, fields: FieldSpec[]): AdData {
  const empty = fields.filter(
    (f) => f.type === 'image' && isVehicleImageField(f.key) && !String(data[f.key] ?? '').trim(),
  );
  if (!empty.length) return data;
  const next = { ...data };
  for (const f of empty) next[f.key] = VEHICLE_PLACEHOLDER_URL;
  return next;
}
