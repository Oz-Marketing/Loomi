import { describe, it, expect } from 'vitest';
import {
  projectPoints,
  scaleBar,
  selectMapCore,
  pickLabels,
  fitHeight,
  type GeoPoint,
} from './map-projection';

// Geometry bugs are invisible until someone notices a dealer's ZIPs are
// mirrored or stretched. These pin the orientation, the aspect ratio and the
// area encoding.

const BOX = { width: 900, height: 460, pad: 48, rMin: 4, rMax: 34 };

const pt = (lat: number | null, lng: number | null, count = 1): GeoPoint & { id: string } => ({
  id: `${lat},${lng}`,
  lat,
  lng,
  count,
});

describe('projectPoints — orientation', () => {
  it('puts north above south', () => {
    const { placed } = projectPoints([pt(41, -111), pt(40, -111)], BOX);
    const north = placed.find((p) => p.point.lat === 41)!;
    const south = placed.find((p) => p.point.lat === 40)!;
    // Screen y grows downward, so the northern point must have the SMALLER y.
    expect(north.y).toBeLessThan(south.y);
  });

  it('puts east to the right of west', () => {
    const { placed } = projectPoints([pt(40, -111), pt(40, -112)], BOX);
    const east = placed.find((p) => p.point.lng === -111)!;
    const west = placed.find((p) => p.point.lng === -112)!;
    expect(east.x).toBeGreaterThan(west.x);
  });
});

describe('projectPoints — fitting', () => {
  it('keeps every point inside the box', () => {
    const { placed } = projectPoints(
      [pt(41.1, -111.9), pt(40.7, -111.8), pt(40.9, -112.2), pt(41.0, -111.5)],
      BOX,
    );
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(BOX.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(BOX.height);
    }
  });

  it('uses one scale for both axes so geography is not stretched', () => {
    // A square-ish spread must stay square-ish. If each axis were fitted
    // independently, these two spans would both fill the box and the
    // x:y distance ratio would come out as the box aspect ratio (~1.96).
    const { placed } = projectPoints([pt(40, -112), pt(41, -112), pt(40, -111)], BOX);
    const origin = placed.find((p) => p.point.lat === 40 && p.point.lng === -112)!;
    const north = placed.find((p) => p.point.lat === 41)!;
    const east = placed.find((p) => p.point.lng === -111)!;

    const dyNorth = Math.abs(north.y - origin.y);
    const dxEast = Math.abs(east.x - origin.x);
    // One degree of longitude at 40°N is cos(40) ≈ 0.766 of a degree of latitude.
    expect(dxEast / dyNorth).toBeCloseTo(Math.cos((40.5 * Math.PI) / 180), 1);
  });

  it('centres a single point instead of dividing by zero', () => {
    const { placed } = projectPoints([pt(41, -111, 5)], BOX);
    expect(placed).toHaveLength(1);
    expect(placed[0].x).toBeCloseTo(BOX.width / 2, 0);
    expect(placed[0].y).toBeCloseTo(BOX.height / 2, 0);
    expect(Number.isFinite(placed[0].r)).toBe(true);
  });

  it('survives several points sharing one centroid', () => {
    const { placed } = projectPoints([pt(41, -111), pt(41, -111)], BOX);
    for (const p of placed) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe('projectPoints — encoding', () => {
  it('scales bubble AREA with volume, not radius', () => {
    const { placed } = projectPoints([pt(41, -111, 100), pt(40, -112, 25)], BOX);
    const big = placed.find((p) => p.point.count === 100)!;
    const small = placed.find((p) => p.point.count === 25)!;

    // 4× the volume is 2× the radius above the floor, so areas stay in ratio.
    const bigT = (big.r - BOX.rMin) / (BOX.rMax - BOX.rMin);
    const smallT = (small.r - BOX.rMin) / (BOX.rMax - BOX.rMin);
    expect(bigT / smallT).toBeCloseTo(2, 5);
  });

  it('gives the largest ZIP the maximum radius', () => {
    const { placed } = projectPoints([pt(41, -111, 80), pt(40, -112, 10)], BOX);
    expect(Math.max(...placed.map((p) => p.r))).toBeCloseTo(BOX.rMax, 5);
  });

  it('paints biggest first so small bubbles stay on top and hoverable', () => {
    const { placed } = projectPoints([pt(40, -112, 5), pt(41, -111, 90), pt(40.5, -111.5, 40)], BOX);
    expect(placed.map((p) => p.point.count)).toEqual([90, 40, 5]);
  });

  it('drops points with no coordinates rather than plotting them at zero', () => {
    // A missing centroid rendered as 0,0 would put a Utah dealer's customer in
    // the Gulf of Guinea.
    const { placed } = projectPoints([pt(41, -111, 5), pt(null, null, 3)], BOX);
    expect(placed).toHaveLength(1);
  });

  it('returns nothing when no point has coordinates', () => {
    const { placed, pxPerKm } = projectPoints([pt(null, null, 3)], BOX);
    expect(placed).toEqual([]);
    expect(pxPerKm).toBe(0);
  });
});

describe('selectMapCore', () => {
  // Approximate Wasatch Front trade area, plus St. George ~400km south.
  const wasatch = [
    pt(41.07, -111.98, 320), // Layton
    pt(41.11, -112.03, 210),
    pt(41.11, -112.03, 165), // Clearfield
    pt(40.98, -111.89, 120), // Farmington
    pt(41.04, -111.94, 138), // Kaysville
    pt(40.87, -111.84, 96), // Bountiful
    pt(41.16, -112.04, 88), // Roy
    pt(41.22, -111.97, 74), // Ogden
  ];

  it('keeps a far outlier out of the view', () => {
    const stGeorge = pt(37.1, -113.58, 6);
    const { core, offMap } = selectMapCore([...wasatch, stGeorge]);
    expect(offMap).toHaveLength(1);
    expect(offMap[0].lat).toBe(37.1);
    expect(core).toHaveLength(wasatch.length);
  });

  it('keeps everything when the whole trade area is compact', () => {
    const { core, offMap } = selectMapCore(wasatch);
    expect(offMap).toEqual([]);
    expect(core).toHaveLength(wasatch.length);
  });

  it('keeps a genuine second cluster rather than trimming it', () => {
    // Salt Lake, ~50km south of the Layton core and carrying real volume, is
    // part of the business — not a straggler.
    const slc = [pt(40.76, -111.89, 140), pt(40.7, -111.85, 120)];
    const { core, offMap } = selectMapCore([...wasatch, ...slc]);
    expect(offMap).toEqual([]);
    expect(core).toHaveLength(wasatch.length + slc.length);
  });

  it('refuses to trim when that would drop most of the business', () => {
    // Two equal, distant clusters: neither is an outlier, so trimming either
    // would misrepresent the dealer. Better a wide map than a false one.
    const { core, offMap } = selectMapCore([
      pt(41.07, -111.98, 100),
      pt(41.08, -111.99, 100),
      pt(37.1, -113.58, 100),
      pt(37.11, -113.57, 100),
    ]);
    expect(offMap).toEqual([]);
    expect(core).toHaveLength(4);
  });

  it('passes through trivially small inputs', () => {
    expect(selectMapCore([]).core).toEqual([]);
    expect(selectMapCore([pt(41, -111, 5)]).core).toHaveLength(1);
    expect(selectMapCore([pt(41, -111, 5), pt(37, -113, 1)]).offMap).toEqual([]);
  });

  it('ignores points with no coordinates', () => {
    const { core } = selectMapCore([...wasatch, pt(null, null, 10)]);
    expect(core.every((p) => p.lat !== null)).toBe(true);
  });

  it('survives points with no volume at all', () => {
    const zeroed = wasatch.map((p) => ({ ...p, count: 0 }));
    const { core, offMap } = selectMapCore(zeroed);
    expect(core).toHaveLength(zeroed.length);
    expect(offMap).toEqual([]);
  });
});

describe('pickLabels', () => {
  it('drops a label that would collide with one already placed', () => {
    const items = [
      { x: 100, y: 100, r: 20, text: 'Clearfield' },
      { x: 104, y: 104, r: 20, text: 'Kaysville' }, // right on top
      { x: 400, y: 300, r: 12, text: 'Ogden' }, // well clear
    ];
    expect(pickLabels(items, 6)).toEqual([true, false, true]);
  });

  it('honours the maximum even when nothing collides', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      x: 40 + i * 100,
      y: 50 + (i % 2) * 200,
      r: 6,
      text: `City${i}`,
    }));
    expect(pickLabels(items, 3).filter(Boolean)).toHaveLength(3);
  });

  it('gives priority to whatever comes first — callers pass biggest first', () => {
    // Same radius, so both labels want the same strip of pixels; the earlier
    // (larger-volume) one wins.
    const items = [
      { x: 100, y: 100, r: 20, text: 'Layton' },
      { x: 103, y: 100, r: 20, text: 'Kaysville' },
    ];
    expect(pickLabels(items, 6)).toEqual([true, false]);
  });

  it('lets a concentric smaller bubble keep its label — the text does not overlap', () => {
    // Different radii put the labels at different heights, so this is not a
    // collision even though the bubbles share a centre.
    const items = [
      { x: 100, y: 100, r: 30, text: 'Big' },
      { x: 100, y: 100, r: 5, text: 'Small' },
    ];
    expect(pickLabels(items, 6)).toEqual([true, true]);
  });

  it('handles an empty list', () => {
    expect(pickLabels([], 6)).toEqual([]);
  });

  it('names a city once even when it spans several ZIPs', () => {
    // A dealer's home city routinely covers 2–4 ZIPs. Repeating the name adds
    // nothing and crowds out a neighbouring town that has none.
    const items = [
      { x: 100, y: 100, r: 20, text: 'Layton' },
      { x: 400, y: 100, r: 18, text: 'Layton' },
      { x: 700, y: 100, r: 14, text: 'Ogden' },
    ];
    expect(pickLabels(items, 6)).toEqual([true, false, true]);
  });
});

describe('fitHeight', () => {
  const FRAME = { width: 900, pad: 48, minHeight: 340, maxHeight: 620 };

  it('grows the frame for a north–south corridor', () => {
    // The Wasatch Front runs vertically; a squat frame would leave the width
    // empty because the projection refuses to stretch.
    const tall = [pt(40.7, -111.9), pt(41.3, -111.9), pt(41.0, -111.95)];
    expect(fitHeight(tall, FRAME)).toBe(FRAME.maxHeight);
  });

  it('keeps a wide east–west spread short', () => {
    const wide = [pt(41.0, -112.6), pt(41.02, -111.2), pt(41.01, -111.9)];
    expect(fitHeight(wide, FRAME)).toBe(FRAME.minHeight);
  });

  it('lands between the bounds for a moderately wide trade area', () => {
    // ~0.45 projected aspect — wider than tall, but not a thin band.
    const moderate = [pt(40.9, -112.2), pt(41.125, -111.54)];
    const h = fitHeight(moderate, FRAME);
    expect(h).toBeGreaterThan(FRAME.minHeight);
    expect(h).toBeLessThan(FRAME.maxHeight);
  });

  it('falls back to the minimum when there is nothing to fit', () => {
    expect(fitHeight([], FRAME)).toBe(FRAME.minHeight);
    expect(fitHeight([pt(41, -111)], FRAME)).toBe(FRAME.minHeight);
  });
});

describe('scaleBar', () => {
  it('picks the longest round distance that fits', () => {
    // 2px/km, 250px available → 100km (200px) fits, 200km (400px) does not.
    expect(scaleBar(2, 250)).toEqual({ km: 100, px: 200 });
  });

  it('falls back to the smallest step when even 1 km overflows', () => {
    // Extremely zoomed in: 1 km is wider than the space available.
    const bar = scaleBar(500, 100)!;
    expect(bar.km).toBe(1);
  });

  it('returns null when there is no scale to draw', () => {
    expect(scaleBar(0, 200)).toBeNull();
  });
});
