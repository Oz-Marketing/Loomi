/**
 * ZIP → coordinate lookup for the Customer Heatmap.
 *
 * SERVER ONLY. `zip-centroids.json` is ~890KB for 33,791 ZIPs; it must never
 * reach the browser. The map API joins against it and returns coordinates only
 * for the ZIPs an account actually has data in — typically a few dozen — so the
 * client downloads kilobytes, not megabytes. Import this from route handlers
 * and server libs only, never from a `'use client'` component.
 *
 * Regenerate with `npx tsx scripts/build-zip-centroids.ts`. Source is the US
 * Census ZCTA Gazetteer, public domain. See that script's header for why a
 * bundled table beat a Maps API.
 */
import data from './zip-centroids.json';

type CentroidTable = Record<string, [number, number]>;

// TS infers each JSON entry as `number[]`, not a 2-tuple, and does it for all
// 33,791 keys. The double assertion sidesteps both the mismatch and any attempt
// to reason about the literal type.
const CENTROIDS = (data as unknown as { centroids: CentroidTable }).centroids;

/** `[lat, lng]`, or null for a postal code the Gazetteer doesn't cover. */
export function lookupCentroid(postalCode: string): [number, number] | null {
  return CENTROIDS[postalCode] ?? null;
}

export function centroidCount(): number {
  return Object.keys(CENTROIDS).length;
}
