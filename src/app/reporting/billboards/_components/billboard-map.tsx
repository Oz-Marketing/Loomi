'use client';

/**
 * Board locations, drawn as inline SVG pins.
 *
 * Reuses `map-projection` from the Customer Heatmap — same equirectangular fit,
 * same scale bar, same no-API-key, no-tile-request approach. What differs is
 * the mark: a heatmap bubble is sized by volume, a board is a discrete place
 * that is either up or not, so these are fixed pins coloured by contract state.
 */

import { useId, useMemo, useState } from 'react';
import {
  projectPoints,
  selectMapCore,
  fitHeight,
  scaleBar,
  type ProjectedPoint,
} from '@/lib/reporting/map-projection';

export interface BoardPoint {
  id: string;
  lat: number | null;
  lng: number | null;
  label: string;
  provider: string;
  state: 'active' | 'expiring' | 'expired' | 'archived';
  traffic: number | null;
}

const WIDTH = 720;
const PAD = 36;

/** Same validated palette as the charts — emerald / amber / pink, plus muted. */
const STATE_COLOR: Record<BoardPoint['state'], string> = {
  active: '#059669',
  expiring: '#d97706',
  expired: '#ec4899',
  archived: '#a1a1aa',
};
const STATE_LABEL: Record<BoardPoint['state'], string> = {
  active: 'Active',
  expiring: 'Expiring soon',
  expired: 'Expired',
  archived: 'Archived',
};

/**
 * The projection module was written for the heatmap, where every point carries
 * a `count` that drives bubble radius. A board has no volume — it is one place —
 * so it plots at weight 1 and the radius the projector hands back is ignored in
 * favour of a fixed pin. Cheaper than forking the projection to make `count`
 * optional and leaving the heatmap to drift from it.
 */
type Plotted = BoardPoint & { count: number };

export function BillboardMap({ points, isDark }: { points: BoardPoint[]; isDark: boolean }) {
  const titleId = useId();
  const [hover, setHover] = useState<ProjectedPoint<Plotted> | null>(null);

  const { placed, pxPerKm, height, offMap } = useMemo(() => {
    const weighted: Plotted[] = points.map((p) => ({ ...p, count: 1 }));
    // Trim outliers before fitting, or one board three states away sets the
    // scale and the real cluster collapses to a dot.
    const { core, offMap } = selectMapCore(weighted);
    const h = fitHeight(core, { width: WIDTH, pad: PAD, minHeight: 260, maxHeight: 520 });
    const { placed, pxPerKm } = projectPoints(core, {
      width: WIDTH,
      height: h,
      pad: PAD,
      rMin: 1,
      rMax: 1,
    });
    return { placed, pxPerKm, height: h, offMap };
  }, [points]);

  const bar = scaleBar(pxPerKm, WIDTH / 3);
  const grid = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const ink = isDark ? '#e4e4e7' : '#18181b';
  const surface = isDark ? '#18181b' : '#ffffff';

  if (!placed.length) {
    return <p className="text-xs text-[var(--muted-foreground)]">No boards have coordinates yet.</p>;
  }

  const states = [...new Set(placed.map((p) => p.point.state))];

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full"
        role="img"
        aria-labelledby={titleId}
        onMouseLeave={() => setHover(null)}
      >
        <title id={titleId}>{placed.length} out-of-home boards by location</title>

        <rect x="0" y="0" width={WIDTH} height={height} fill="none" stroke={grid} rx="12" />

        {placed.map((p) => (
          <g
            key={p.point.id}
            transform={`translate(${p.x} ${p.y})`}
            onMouseEnter={() => setHover(p)}
            style={{ cursor: 'pointer' }}
          >
            {/* Teardrop pin: the tip is the location, so the shape points at
                the coordinate rather than being centred on it. */}
            <path
              d="M0 0 L-6 -11 A6.5 6.5 0 1 1 6 -11 Z"
              fill={STATE_COLOR[p.point.state]}
              stroke={surface}
              strokeWidth="1.5"
            />
            <circle cy="-13" r="2.4" fill={surface} />
          </g>
        ))}

        {bar && (
          <g transform={`translate(${PAD} ${height - 16})`}>
            <line x1="0" y1="0" x2={bar.px} y2="0" stroke={ink} strokeWidth="1.5" />
            <line x1="0" y1="-4" x2="0" y2="4" stroke={ink} strokeWidth="1.5" />
            <line x1={bar.px} y1="-4" x2={bar.px} y2="4" stroke={ink} strokeWidth="1.5" />
            <text x={bar.px / 2} y="-6" textAnchor="middle" fontSize="10" fill={ink}>
              {bar.km} km
            </text>
          </g>
        )}

        {hover && (
          <g transform={`translate(${Math.min(hover.x + 12, WIDTH - 190)} ${Math.max(hover.y - 46, 8)})`}>
            <rect width="180" height="42" rx="6" fill={surface} stroke={grid} />
            <text x="9" y="17" fontSize="11" fontWeight="600" fill={ink}>
              {hover.point.label}
            </text>
            <text x="9" y="32" fontSize="10" fill={isDark ? '#a1a1aa' : '#71717a'}>
              {hover.point.provider}
              {hover.point.traffic ? ` · ${hover.point.traffic.toLocaleString()}/day` : ''}
            </text>
          </g>
        )}
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        {states.map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: STATE_COLOR[s] }}
            />
            {STATE_LABEL[s]}
          </span>
        ))}
      </div>

      {offMap.length > 0 && (
        <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
          {offMap.length} board{offMap.length === 1 ? '' : 's'} sit too far from the rest to plot at
          this scale and {offMap.length === 1 ? 'is' : 'are'} listed below but not shown.
        </p>
      )}
    </div>
  );
}
