'use client';

/**
 * The KPI tile.
 *
 * Three things separate this from the old `Kpi`: a larger figure, a delta
 * rendered as a CHIP with a direction arrow rather than bare coloured text,
 * and an optional sparkline behind the number. Together they are most of what
 * makes the reference dashboards read as current.
 *
 * ── THE SPARKLINE IS INLINE SVG, NOT A CHART ───────────────────────────────
 * A KPI row is six tiles. Six ApexCharts instances to draw six 40px trend
 * lines costs more than the entire rest of the page, and none of them need
 * axes, tooltips, or a legend. This is a `<path>`.
 *
 * ── THE DELTA CHIP CARRIES A SHAPE, NOT JUST A COLOUR ──────────────────────
 * Up/down is an arrow as well as green/red, because "did this go up" must not
 * be a colour-only judgement. `lowerIsBetter` flips the TONE without flipping
 * the arrow: CPC falling is a down arrow in green, which is the honest render —
 * the number went down and that is good.
 */

import type { ComponentType, SVGProps } from 'react';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon } from '@heroicons/react/24/outline';
import { LABEL, FIGURE, SUBFIGURE, TILE } from './scale';

export interface Delta {
  text: string;
  good: boolean;
}

const TONE: Record<string, { bg: string; text: string }> = {
  primary: { bg: 'bg-[var(--primary)]/10', text: 'text-[var(--primary)]' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-500' },
  sky: { bg: 'bg-sky-500/10', text: 'text-sky-500' },
  violet: { bg: 'bg-violet-500/10', text: 'text-violet-500' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-500' },
  zinc: { bg: 'bg-zinc-500/10', text: 'text-zinc-500' },
};

/**
 * Normalised sparkline path. Returns null for fewer than two points (a
 * one-point "trend" is a dot pretending to be a direction) or a flat series
 * (which would render as a meaningless horizontal rule).
 */
function sparkPath(values: number[], w: number, h: number): string | null {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return null;
  const dx = w / (values.length - 1);
  return values
    .map((v, i) => {
      const y = h - ((v - min) / (max - min)) * h;
      return `${i === 0 ? 'M' : 'L'}${(i * dx).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function StatTile({
  icon: Icon,
  label,
  value,
  secondary,
  tone,
  delta,
  spark,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  value: string;
  secondary?: string;
  tone: keyof typeof TONE;
  delta?: Delta;
  /** Trend values, oldest → newest. Omit for metrics with no meaningful series. */
  spark?: number[];
}) {
  const t = TONE[tone] ?? TONE.zinc;
  const path = spark ? sparkPath(spark, 100, 28) : null;
  // The arrow reports DIRECTION; `good` colours it. A leading "-" is the only
  // reliable direction signal we have, since the caller formats the text.
  const down = !!delta && delta.text.trim().startsWith('-');
  const Arrow = down ? ArrowTrendingDownIcon : ArrowTrendingUpIcon;

  return (
    <div
      className={`glass-section-card relative overflow-hidden ${TILE} transition-colors hover:border-[var(--primary)]/30`}
    >
      {path && (
        <svg
          viewBox="0 0 100 28"
          preserveAspectRatio="none"
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 bottom-0 h-8 w-full opacity-25 ${t.text}`}
        >
          <path d={path} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
      )}

      <div className="relative">
        {/* min-w-0 + truncate keeps a two-word label ("Cost / conv.") on one
            line. Without it the label wraps in a narrow column, the header row
            grows, and that tile's figure sits a line lower than its neighbours
            — the KPI row stops reading as a row. */}
        <div className="mb-2 flex items-center gap-2">
          <div
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${t.bg} ${t.text}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </div>
          <p className={`min-w-0 truncate ${LABEL}`} title={label}>
            {label}
          </p>
        </div>

        <div className="flex items-baseline gap-2">
          <p className={FIGURE}>{value}</p>
          {delta && (
            <span
              className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                delta.good
                  ? 'bg-emerald-500/10 text-emerald-500'
                  : 'bg-red-500/10 text-red-500'
              }`}
            >
              <Arrow className="h-3 w-3" />
              {delta.text}
            </span>
          )}
        </div>

        {secondary && <p className={`mt-0.5 ${SUBFIGURE}`}>{secondary}</p>}
      </div>
    </div>
  );
}
