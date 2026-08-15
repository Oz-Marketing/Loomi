/**
 * Projection and bubble sizing for the Customer Heatmap.
 *
 * Pure and framework-free so it can be unit-tested — the geometry is the part
 * most likely to be subtly wrong, and it is invisible in a screenshot until
 * someone notices a dealer's ZIPs are mirrored.
 *
 * EQUIRECTANGULAR, longitude compressed by cos(mean latitude). Over a dealer
 * trade area (tens of miles) the error against a proper conic projection is
 * sub-pixel, and it avoids a d3-geo dependency for four lines of arithmetic.
 * Do not reuse this for a continental view.
 */

export interface GeoPoint {
  lat: number | null;
  lng: number | null;
  count: number;
}

export interface ProjectedPoint<T> {
  point: T;
  x: number;
  y: number;
  r: number;
  /** 0–1, rides the same magnitude as radius so clusters read as hot. */
  opacity: number;
}

export interface ProjectionBox {
  width: number;
  height: number;
  pad: number;
  rMin: number;
  rMax: number;
}

/** Degrees of latitude per kilometre, near enough at any latitude. */
export const EARTH_KM_PER_DEG = 111.32;

/**
 * A single ZIP, or several sharing a centroid, has zero extent and would divide
 * by zero when fitting. Give it a small window so it lands centred instead.
 */
const MIN_SPAN_DEG = 0.05;

function padSpan(min: number, max: number): [number, number] {
  if (max - min >= MIN_SPAN_DEG) return [min, max];
  const mid = (min + max) / 2;
  return [mid - MIN_SPAN_DEG / 2, mid + MIN_SPAN_DEG / 2];
}

export function projectPoints<T extends GeoPoint>(
  points: T[],
  box: ProjectionBox,
): { placed: ProjectedPoint<T>[]; pxPerKm: number } {
  const usable = points.filter(
    (p): p is T & { lat: number; lng: number } => p.lat !== null && p.lng !== null,
  );
  if (!usable.length) return { placed: [], pxPerKm: 0 };

  const lats = usable.map((p) => p.lat);
  const latMid = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lngScale = Math.cos((latMid * Math.PI) / 180);

  // Flat plane first (y flipped — screen y grows downward, latitude grows up),
  // then fit that plane into the box.
  const proj = usable.map((p) => ({ p, px: p.lng * lngScale, py: -p.lat }));
  const [minX, maxX] = padSpan(
    Math.min(...proj.map((d) => d.px)),
    Math.max(...proj.map((d) => d.px)),
  );
  const [minY, maxY] = padSpan(
    Math.min(...proj.map((d) => d.py)),
    Math.max(...proj.map((d) => d.py)),
  );

  // ONE scale for both axes. Fitting each independently would stretch geography
  // to fill the box and quietly misrepresent distances.
  const k = Math.min(
    (box.width - box.pad * 2) / (maxX - minX),
    (box.height - box.pad * 2) / (maxY - minY),
  );
  const offsetX = (box.width - (maxX - minX) * k) / 2;
  const offsetY = (box.height - (maxY - minY) * k) / 2;

  const maxCount = Math.max(...usable.map((p) => p.count));

  const placed = proj.map(({ p, px, py }) => {
    // AREA is proportional to count, so radius takes the square root. Sizing
    // radius directly would make double the volume look quadruple.
    const t = maxCount > 0 ? Math.sqrt(Math.max(0, p.count) / maxCount) : 0;
    return {
      point: p as T,
      x: (px - minX) * k + offsetX,
      y: (py - minY) * k + offsetY,
      r: box.rMin + (box.rMax - box.rMin) * t,
      opacity: 0.28 + 0.5 * t,
    };
  });

  // Biggest first in paint order so small bubbles land on top and stay hoverable.
  placed.sort((a, b) => b.r - a.r);

  return { placed, pxPerKm: k / EARTH_KM_PER_DEG };
}

// ── Outlier trimming ──

/**
 * Distance in km between two lat/lng pairs, flat-earth with longitude
 * compressed by cos(latitude). Fine at trade-area scale; this is only used to
 * rank points by remoteness, not to report a distance to anyone.
 */
function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const latScale = Math.cos((((aLat + bLat) / 2) * Math.PI) / 180);
  const dLat = aLat - bLat;
  const dLng = (aLng - bLng) * latScale;
  return Math.hypot(dLat, dLng) * EARTH_KM_PER_DEG;
}

/** Points nearer than this are never trimmed, however tight the trade area. */
const CORE_FLOOR_KM = 25;
/** Multiple of the typical customer distance that still counts as "local". */
const CORE_DISTANCE_FACTOR = 4;

/**
 * Split points into the trade area and the far-flung stragglers.
 *
 * WHY THIS EXISTS. Fitting the view to every point lets a single remote ZIP —
 * a customer who moved away, an internet sale — set the scale for the whole
 * map, collapsing the actual trade area into an unreadable blob in one corner.
 * Observed with real proportions: one ZIP 400km out shrank a 19-ZIP Wasatch
 * Front cluster to about 60 pixels.
 *
 * The threshold is a multiple of the VOLUME-WEIGHTED MEDIAN distance from the
 * volume-weighted centre, so it scales with how spread out the dealer's
 * customers actually are — a compact metro store and one selling across three
 * counties both keep their real shape. Because it is a multiple of the typical
 * distance rather than a fixed radius, a genuine second cluster survives; only
 * true stragglers are cut.
 *
 * Off-map points are RETURNED, not discarded. They belong in the totals and the
 * table; the caller is expected to say how many were left undrawn.
 */
export function selectMapCore<T extends GeoPoint>(points: T[]): { core: T[]; offMap: T[] } {
  const usable = points.filter(
    (p): p is T & { lat: number; lng: number } => p.lat !== null && p.lng !== null,
  );
  if (usable.length < 3) return { core: usable, offMap: [] };

  const weight = usable.reduce((n, p) => n + Math.max(0, p.count), 0);
  if (weight <= 0) return { core: usable, offMap: [] };

  const cLat = usable.reduce((n, p) => n + p.lat * Math.max(0, p.count), 0) / weight;
  const cLng = usable.reduce((n, p) => n + p.lng * Math.max(0, p.count), 0) / weight;

  const ranked = usable
    .map((p) => ({ p, d: km(p.lat, p.lng, cLat, cLng) }))
    .sort((a, b) => a.d - b.d);

  // Volume-weighted median: the distance by which half the business is covered.
  let acc = 0;
  let median = ranked[ranked.length - 1].d;
  for (const r of ranked) {
    acc += Math.max(0, r.p.count);
    if (acc >= weight / 2) {
      median = r.d;
      break;
    }
  }

  const limit = Math.max(CORE_FLOOR_KM, median * CORE_DISTANCE_FACTOR);
  const core: T[] = [];
  const offMap: T[] = [];
  for (const { p, d } of ranked) (d <= limit ? core : offMap).push(p);

  // Never trim so hard the map stops representing the business.
  const coreWeight = core.reduce((n, p) => n + Math.max(0, p.count), 0);
  if (coreWeight < weight * 0.5) return { core: usable, offMap: [] };

  return { core, offMap };
}

// ── Label placement ──

/** Rough advance width per character at the label's font size and weight. */
const CHAR_PX = 6.2;
const LABEL_H = 14;

/**
 * Greedily choose which bubbles get a visible city label.
 *
 * Labelling the top N unconditionally produces a pile of overlapping text the
 * moment two busy ZIPs sit close together — which, in a dealer's home city, is
 * the normal case rather than the edge case. Biggest bubbles bid first; a label
 * is dropped if its box would collide with one already placed.
 */
export function pickLabels(
  items: { x: number; y: number; r: number; text: string }[],
  max: number,
): boolean[] {
  const taken: { x1: number; y1: number; x2: number; y2: number }[] = [];
  // A dealer's home city routinely spans several ZIPs. Printing "Layton" three
  // times says nothing the first one didn't; the busiest ZIP keeps the name.
  const seen = new Set<string>();
  const out = new Array(items.length).fill(false);
  let placed = 0;

  for (let i = 0; i < items.length && placed < max; i += 1) {
    const it = items[i];
    if (seen.has(it.text)) continue;

    const w = it.text.length * CHAR_PX;
    const cy = it.y - it.r - 6;
    const box = { x1: it.x - w / 2, y1: cy - LABEL_H, x2: it.x + w / 2, y2: cy + 2 };

    const collides = taken.some(
      (t) => box.x1 < t.x2 && box.x2 > t.x1 && box.y1 < t.y2 && box.y2 > t.y1,
    );
    if (collides) continue;

    taken.push(box);
    seen.add(it.text);
    out[i] = true;
    placed += 1;
  }
  return out;
}

/**
 * Height that lets the data fill the frame instead of floating in it.
 *
 * A fixed 900×460 frame suits an east–west trade area, but the Wasatch Front
 * (and any corridor city) runs north–south: preserving the aspect ratio then
 * leaves most of the width empty. Since the projection must not stretch
 * geography, the frame adapts to the data instead of the reverse.
 */
export function fitHeight(
  points: GeoPoint[],
  { width, pad, minHeight, maxHeight }: { width: number; pad: number; minHeight: number; maxHeight: number },
): number {
  const usable = points.filter(
    (p): p is GeoPoint & { lat: number; lng: number } => p.lat !== null && p.lng !== null,
  );
  if (usable.length < 2) return minHeight;

  const lats = usable.map((p) => p.lat);
  const latMid = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lngScale = Math.cos((latMid * Math.PI) / 180);

  const [minX, maxX] = padSpan(
    Math.min(...usable.map((p) => p.lng * lngScale)),
    Math.max(...usable.map((p) => p.lng * lngScale)),
  );
  const [minY, maxY] = padSpan(Math.min(...lats), Math.max(...lats));

  const aspect = (maxY - minY) / (maxX - minX);
  const ideal = (width - pad * 2) * aspect + pad * 2;
  return Math.round(Math.min(maxHeight, Math.max(minHeight, ideal)));
}

/** Nice round distances for a scale bar, in km. */
const SCALE_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];

/** Longest round distance that fits comfortably in `maxPx`. */
export function scaleBar(pxPerKm: number, maxPx: number): { km: number; px: number } | null {
  if (!(pxPerKm > 0) || !(maxPx > 0)) return null;
  const fitting = SCALE_STEPS.filter((s) => s * pxPerKm <= maxPx);
  const km = fitting.length ? fitting[fitting.length - 1] : SCALE_STEPS[0];
  return { km, px: km * pxPerKm };
}
