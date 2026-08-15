'use client';

/**
 * Customer heatmap — ZIP volume as proportional bubbles, drawn as inline SVG.
 *
 * NO TILES, NO MAPS SDK, NO NETWORK. Coordinates arrive with the report payload
 * (the server joins ZIPs against a bundled Census centroid table), so this
 * renders synchronously from props. That is what lets the PDF exporter, which
 * drives headless Chromium on the droplet, capture it reliably — a tile-based
 * map would need outbound network from the server and would race the capture.
 *
 * ── PROJECTION ──────────────────────────────────────────────────────────────
 * Equirectangular with longitude compressed by cos(mean latitude). Over a
 * dealer trade area — tens of miles, a few degrees at most — the distortion
 * against a proper conic projection is well under a pixel, and it avoids
 * pulling in d3-geo for arithmetic that fits in four lines. It would be wrong
 * for a continental view; this map always fits to one account's own data.
 *
 * ── ENCODING ────────────────────────────────────────────────────────────────
 * Bubble AREA is proportional to volume (radius ∝ √count), because the eye
 * compares areas. Sizing radius directly would make a ZIP with twice the units
 * look four times as big. Fill opacity rides the same value so dense clusters
 * read as hot without introducing a second colour scale.
 *
 * There is no base geography behind the bubbles — see the page component. The
 * orienting cues are the city labels on the largest bubbles and the scale bar.
 */

import { useMemo, useState, useId } from 'react';
import {
  projectPoints,
  scaleBar,
  selectMapCore,
  pickLabels,
  fitHeight,
  type ProjectedPoint,
} from '@/lib/reporting/map-projection';

export interface MapPoint {
  postalCode: string;
  city: string | null;
  state: string | null;
  count: number;
  share: number;
  lat: number | null;
  lng: number | null;
}

/** Height is derived per-account from the data's shape — see `fitHeight`. */
const FRAME = { width: 900, pad: 48, rMin: 4, rMax: 34, minHeight: 340, maxHeight: 620 };
/** How many of the biggest bubbles get a permanent city label. */
const LABELLED = 6;

/**
 * Indigo — the same slot the rest of the dealer reports use for a single
 * series. Hard-coded rather than imported from dealer-charts so this component
 * doesn't drag ApexCharts into its module graph.
 */
const HUE = '#6366f1';

type Placed = ProjectedPoint<MapPoint>;

export function ZipBubbleMap({
  points,
  isDark,
  unit,
}: {
  points: MapPoint[];
  isDark: boolean;
  /** "units" / "repair orders" — used in the tooltip and legend. */
  unit: string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<Placed | null>(null);

  const { placed, scale, offMap, box } = useMemo(() => {
    // Trim far-flung stragglers BEFORE fitting, or one remote ZIP sets the
    // scale for the whole map and the real trade area collapses to a dot.
    const { core, offMap } = selectMapCore(points);
    const box = { ...FRAME, height: fitHeight(core, FRAME) };
    const { placed, pxPerKm } = projectPoints(core, box);
    return { placed, offMap, box, scale: scaleBar(pxPerKm, (box.width - box.pad * 2) / 4) };
  }, [points]);

  // `placed` is biggest-first, so the busiest ZIPs bid for label space first.
  const labelFlags = useMemo(
    () =>
      pickLabels(
        placed.map((p) => ({
          x: p.x,
          y: p.y,
          r: p.r,
          text: p.point.city ?? p.point.postalCode,
        })),
        LABELLED,
      ),
    [placed],
  );

  if (!placed.length) return null;
  const grid = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const ink = isDark ? '#e4e4e7' : '#27272a';
  const muted = isDark ? '#9ca3af' : '#52525b';
  const surface = isDark ? '#18181b' : '#ffffff';

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${box.width} ${box.height}`}
        className="w-full"
        role="img"
        aria-label={`Customer volume by ZIP code. ${placed.length} ZIP codes plotted; the full breakdown is in the table below.`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <radialGradient id={gradientId}>
            <stop offset="0%" stopColor={HUE} stopOpacity="0.95" />
            <stop offset="100%" stopColor={HUE} stopOpacity="0.55" />
          </radialGradient>
        </defs>

        {/* A faint frame, not a graticule — real lat/lng lines would imply a
            precision that ZIP-centroid data doesn't have. */}
        <rect
          x={box.pad / 2}
          y={box.pad / 2}
          width={box.width - box.pad}
          height={box.height - box.pad}
          fill="none"
          stroke={grid}
          strokeDasharray="4 4"
          rx="10"
        />

        {placed.map((p) => (
          <circle
            key={p.point.postalCode}
            cx={p.x}
            cy={p.y}
            r={p.r}
            fill={`url(#${gradientId})`}
            fillOpacity={p.opacity}
            stroke={HUE}
            strokeWidth={hover?.point.postalCode === p.point.postalCode ? 2.5 : 1}
            onMouseEnter={() => setHover(p)}
            className="cursor-pointer transition-[stroke-width] duration-150"
          />
        ))}

        {placed.map((p, i) =>
          labelFlags[i] ? (
            <text
              key={`l-${p.point.postalCode}`}
              x={p.x}
              y={p.y - p.r - 6}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill={ink}
              stroke={surface}
              strokeWidth="3"
              paintOrder="stroke"
              pointerEvents="none"
            >
              {p.point.city ?? p.point.postalCode}
            </text>
          ) : null,
        )}

        {scale && (
          <g transform={`translate(${box.pad / 2 + 12}, ${box.height - box.pad / 2 - 12})`}>
            <line x1="0" y1="0" x2={scale.px} y2="0" stroke={muted} strokeWidth="2" />
            <line x1="0" y1="-4" x2="0" y2="4" stroke={muted} strokeWidth="2" />
            <line x1={scale.px} y1="-4" x2={scale.px} y2="4" stroke={muted} strokeWidth="2" />
            <text x={scale.px / 2} y="-8" textAnchor="middle" fontSize="10" fill={muted}>
              {scale.km} km
            </text>
          </g>
        )}
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs shadow-lg backdrop-blur-sm"
          style={{
            left: `${(hover.x / box.width) * 100}%`,
            top: `${(hover.y / box.height) * 100}%`,
            transform: 'translate(-50%, calc(-100% - 12px))',
          }}
        >
          <p className="font-semibold text-[var(--foreground)]">
            {hover.point.city
              ? `${hover.point.city}${hover.point.state ? `, ${hover.point.state}` : ''}`
              : hover.point.postalCode}
          </p>
          <p className="tabular-nums text-[var(--muted-foreground)]">
            {hover.point.city && `${hover.point.postalCode} — `}
            {hover.point.count.toLocaleString('en-US')} {unit} (
            {(hover.point.share * 100).toFixed(1)}%)
          </p>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--muted-foreground)]">
        <span>Bubble area is proportional to volume. Hover for detail.</span>
        <span>
          {placed.length.toLocaleString('en-US')} ZIP codes plotted
          {offMap.length > 0 &&
            ` · ${offMap.length} outside the trade area (${offMap
              .reduce((n, p) => n + p.count, 0)
              .toLocaleString('en-US')} ${unit}) not shown`}
        </span>
      </div>
    </div>
  );
}
