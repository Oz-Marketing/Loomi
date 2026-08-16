'use client';

/**
 * Shared building blocks for the Ads report tabs (Meta, StackAdapt, …).
 * Controls, KPI/section primitives, formatters, delta helpers, and the
 * platform-agnostic charts live here so each platform tab only owns its
 * fetch + which visuals it shows.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  ArrowsRightLeftIcon,
  ChevronDownIcon,
  CheckIcon,
  PuzzlePieceIcon,
} from '@heroicons/react/24/outline';
import type { ApexOptions } from 'apexcharts';
import {
  DashboardToolbar,
  type CustomDateRange,
} from '@/components/filters/dashboard-toolbar';
import { useAccount } from '@/contexts/account-context';
import { MANAGEMENT_ROLES } from '@/lib/roles';
import { type DateRangeKey, getDateRangeBounds } from '@/lib/date-ranges';
import { StatTile, type Delta } from '../../_components/ui/stat-tile';
import { ChartCard } from '../../_components/ui/chart-card';
import { ReportTable } from '../../_components/ui/report-table';
import { BODY, LABEL, HEADING } from '../../_components/ui/scale';
import {
  SERIES_COLORS,
  baseChartOptions,
  foldToPalette,
  surfaceGap,
} from '../../_components/ui/chart-theme';

export type { CustomDateRange };
export type { DateRangeKey };

const ReactApexChart = dynamic(() => import('react-apexcharts'), { ssr: false });

// ── Date range ──

/** API floor for the (hidden) "All time" preset — no Meta data predates this. */
export const ALL_TIME_FLOOR = '2015-01-01';

export function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Earliest date Meta Insights serves (~37 months); custom ranges clamp to it. */
export function metaLookbackFloor(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 37);
  return localIso(d);
}

/** Resolve a dashboard range key (+ optional custom window) to API date strings. */
export function resolveBounds(
  key: DateRangeKey,
  custom: CustomDateRange | null,
): { from: string; to: string } {
  const b =
    key === 'custom' && custom
      ? getDateRangeBounds('custom', custom.start, custom.end)
      : getDateRangeBounds(key);
  return { from: b.start ? localIso(b.start) : ALL_TIME_FLOOR, to: localIso(b.end) };
}

export const COMPARE_LABELS: Record<string, string> = {
  none: 'No comparison',
  previous_period: 'Previous period',
  previous_month: 'Previous month',
  previous_year: 'Previous year',
};

// ── Formatters ──

/**
 * A metric that is absent renders as an em dash, not a white screen.
 *
 * These formatters are typed `(v: number)`, which reads as a guarantee and is
 * not one. Every report hand-writes an interface for its route's JSON and hands
 * it to SWR as a generic; TypeScript then believes the payload matches and
 * checks nothing at runtime. So any drift between what a route returns and what
 * a component expects is invisible to `tsc` and fatal in the browser.
 *
 * That is not hypothetical. The team-lens campaign table rendered `usd(c.cpm)`
 * while the Graph query never requested `cpm`, and `undefined.toLocaleString()`
 * took down the ENTIRE Meta report — every section, for every agency user,
 * because team is their default lens. One missing field from one vendor call
 * blanked a client-facing page.
 *
 * Guarding here is deliberately a backstop, not a fix: the underlying gap still
 * gets repaired at the route. But the failure mode changes from "the report is
 * gone" to "one cell says —", which is the difference between an outage and a
 * visible imperfection. Reports are read-only summaries; there is no correctness
 * argument for preferring the crash.
 */
const finite = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export const usd = (v: number) => {
  const n = finite(v);
  return n === null
    ? '—'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
};
export const usd0 = (v: number) => {
  const n = finite(v);
  return n === null
    ? '—'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
};
export const num = (v: number) => {
  const n = finite(v);
  // Math.round(undefined) is NaN, which formats as the string "NaN" rather
  // than throwing — so this one was never a crash, just a cell reading "NaN".
  return n === null ? '—' : Math.round(n).toLocaleString('en-US');
};
/**
 * Short form for headline figures: 842 · 8.4k · 84k · 2.9M.
 *
 * The k branch used to be the only one, so a seven-figure impression count
 * rendered as "2860k" — technically correct, unreadable, and precisely the
 * magnitude a monthly ad report lands on.
 */
export const compact = (v: number) => {
  const safe = finite(v);
  if (safe === null) return '—';
  v = safe;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1000) return `${(v / 1000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(v));
};
export const pctText = (v: number) => {
  const n = finite(v);
  return n === null ? '—' : `${n.toFixed(2)}%`;
};
export const prettyDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

export const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error || `HTTP ${res.status}`) as Error & { code?: string };
    err.code = body?.code;
    throw err;
  }
  return body as T;
};

// ── Delta helpers ──

export type { Delta };
/** Percent change vs. comparison. `lowerIsBetter` flips the tone (e.g. CPC). */
export function pctDelta(curr: number, prev?: number, lowerIsBetter = false): Delta | undefined {
  if (prev === undefined || prev === null) return undefined;
  if (prev === 0) return curr === 0 ? { text: '0%', good: true } : undefined;
  const change = ((curr - prev) / prev) * 100;
  const up = change >= 0;
  return { text: `${up ? '+' : ''}${change.toFixed(1)}%`, good: lowerIsBetter ? !up : up };
}
/** Absolute point change for already-percentage metrics (e.g. CTR). */
export function pointDelta(curr: number, prev?: number): Delta | undefined {
  if (prev === undefined || prev === null) return undefined;
  const change = curr - prev;
  const up = change >= 0;
  return { text: `${up ? '+' : ''}${change.toFixed(2)} pts`, good: up };
}

// ── KPI + layout primitives ──
//
// These now live in ../../_components/ui and are re-exported under their
// original names so the ~35 report files importing `Kpi` / `Section` /
// `DataTable` from here keep working unchanged. New code should import
// StatTile / ChartCard / ReportTable directly and use the richer props
// (sparkline, per-card controls) the aliases cannot express.

export { StatTile, ChartCard, ReportTable };

/** @deprecated Use `StatTile` — same props, plus `spark`. */
export const Kpi = StatTile;
/** @deprecated Use `ChartCard` — same props, plus `controls`. */
export const Section = ChartCard;
/** @deprecated Use `ReportTable` — identical props. */
export const DataTable = ReportTable;

export function Muted({ children }: { children: React.ReactNode }) {
  return <p className={BODY}>{children}</p>;
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  tone = 'muted',
  action,
  connect,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  body: string;
  tone?: 'muted' | 'error';
  action?: { label: string; onClick: () => void };
  connect?: { href: string; label: string } | null;
}) {
  const { userRole } = useAccount();
  const showConnect = !!connect && !!userRole && MANAGEMENT_ROLES.includes(userRole);

  return (
    <div
      className={`glass-card mt-8 flex flex-col items-center gap-3 p-10 text-center ${
        tone === 'error' ? 'border border-red-500/20' : ''
      }`}
    >
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-full ${
          tone === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
        }`}
      >
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <p className={HEADING}>{title}</p>
        <p className={`mx-auto mt-1 max-w-md ${BODY}`}>{body}</p>
      </div>
      {(action || showConnect) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action && (
            <button
              onClick={action.onClick}
              className="rounded-lg bg-[var(--primary)] px-3.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
            >
              {action.label}
            </button>
          )}
          {showConnect && (
            <Link
              href={connect!.href}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3.5 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
            >
              <PuzzlePieceIcon className="h-3.5 w-3.5" />
              {connect!.label}
            </Link>
          )}
        </div>
      )}
      {showConnect && (
        <p className={`${LABEL} opacity-70`}>Visible to agency users only</p>
      )}
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="mt-8 space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-[88px] animate-pulse rounded-xl bg-[var(--muted)]" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-2xl bg-[var(--muted)]" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="h-80 animate-pulse rounded-2xl bg-[var(--muted)]" />
        <div className="h-80 animate-pulse rounded-2xl bg-[var(--muted)]" />
      </div>
    </div>
  );
}

// ── Controls (date range + comparison) ──

export function RangeControls({
  rangeKey,
  onRangeKey,
  customRange,
  onCustomRange,
  compareTo,
  onCompareTo,
  floor,
}: {
  rangeKey: DateRangeKey;
  onRangeKey: (k: DateRangeKey) => void;
  customRange: CustomDateRange | null;
  onCustomRange: (r: CustomDateRange) => void;
  compareTo: string;
  onCompareTo: (v: string) => void;
  floor: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <DashboardToolbar
        dateRange={rangeKey}
        onDateRangeChange={onRangeKey}
        customRange={customRange}
        onCustomRangeChange={onCustomRange}
        showReset={false}
        align="left"
        hidePresets={['all']}
        minDate={floor}
      />
      <CompareDropdown value={compareTo} onChange={onCompareTo} />
    </div>
  );
}

/** Comparison picker — trigger + panel mirror the date dropdown for a matched pair. */
function CompareDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = value !== 'none';

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
          open || active
            ? 'border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--primary)]'
            : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]'
        }`}
      >
        <ArrowsRightLeftIcon className="h-3.5 w-3.5" />
        <span className="max-w-[160px] truncate">{COMPARE_LABELS[value]}</span>
        <ChevronDownIcon className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="glass-dropdown animate-fade-in-up absolute top-full left-0 z-50 mt-2 shadow-lg"
          style={{ minWidth: '220px' }}
        >
          <div className="p-1.5">
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Compare to
            </p>
            {Object.entries(COMPARE_LABELS).map(([val, label]) => (
              <button
                key={val}
                onClick={() => {
                  onChange(val);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors ${
                  value === val
                    ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                    : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
                }`}
              >
                {label}
                {value === val && <CheckIcon className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Charts (platform-agnostic) ──
//
// Grid/foreground/tooltip/palette all come from ../../_components/ui/chart-theme
// now. Nothing in this section should declare a colour of its own.

/**
 * Daily spend and one secondary measure, as TWO STACKED PLOTS sharing an x-axis.
 *
 * This used to be a single dual-axis chart — spend on the left scale, clicks on
 * the right. That is the one form to never ship: with two independent y-scales
 * the author can slide one against the other until the lines "agree", so every
 * crossing and convergence the reader sees is an artifact of the axis choice
 * rather than anything in the data. `dealer-charts.tsx` already refused to do
 * this and said so in its header; the ads reports had simply not caught up.
 *
 * Same props, so no call site changed. Dollars and counts each get an honest
 * axis, and the shared x makes the comparison the dual axis was faking.
 */
export function DailyChart({
  rows,
  isDark,
  secondaryName = 'Clicks',
}: {
  rows: { date: string; spend: number; secondary: number }[];
  isDark: boolean;
  /** Label for the second plot, e.g. "Clicks" or "Impressions". */
  secondaryName?: string;
}) {
  const points = useMemo(
    () => rows.map((r) => new Date(`${r.date}T00:00:00Z`).getTime()),
    [rows],
  );

  const spendSeries = useMemo(
    () => [{ name: 'Spend', data: rows.map((r, i) => [points[i], Number(r.spend.toFixed(2))]) }],
    [rows, points],
  );
  const secondarySeries = useMemo(
    () => [{ name: secondaryName, data: rows.map((r, i) => [points[i], r.secondary]) }],
    [rows, points, secondaryName],
  );

  const spendOptions: ApexOptions = useMemo(
    () => ({
      ...baseChartOptions({ isDark, seriesCount: 1, type: 'area' }),
      colors: [SERIES_COLORS[1]],
      stroke: { curve: 'smooth', width: 2 },
      fill: { type: 'gradient', gradient: { opacityFrom: 0.3, opacityTo: 0.05 } },
      xaxis: { type: 'datetime', labels: { format: 'MMM d' } },
      yaxis: { labels: { formatter: (v: number) => `$${Math.round(v).toLocaleString()}` } },
      tooltip: {
        theme: isDark ? 'dark' : 'light',
        x: { format: 'MMM d, yyyy' },
        y: { formatter: (v: number) => usd(v) },
      },
    }),
    [isDark],
  );

  const secondaryOptions: ApexOptions = useMemo(
    () => ({
      ...baseChartOptions({ isDark, seriesCount: 1, type: 'line' }),
      colors: [SERIES_COLORS[0]],
      stroke: { curve: 'smooth', width: 2 },
      xaxis: { type: 'datetime', labels: { format: 'MMM d' } },
      yaxis: { labels: { formatter: (v: number) => Math.round(v).toLocaleString() } },
      tooltip: {
        theme: isDark ? 'dark' : 'light',
        x: { format: 'MMM d, yyyy' },
        y: { formatter: (v: number) => num(v) },
      },
    }),
    [isDark],
  );

  return (
    <div className="space-y-1">
      <p className={LABEL}>Spend</p>
      <ReactApexChart options={spendOptions} series={spendSeries} type="area" height={190} />
      <p className={LABEL}>{secondaryName}</p>
      <ReactApexChart options={secondaryOptions} series={secondarySeries} type="line" height={150} />
    </div>
  );
}

/** Horizontal spend bar for the top N items (caller pre-sorts/slices). */
export function SpendBar({
  items,
  isDark,
}: {
  items: { label: string; value: number }[];
  isDark: boolean;
}) {
  const labels = items.map((i) => (i.label.length > 30 ? `${i.label.slice(0, 29)}…` : i.label));
  const series = useMemo(
    () => [{ name: 'Spend', data: items.map((i) => Number(i.value.toFixed(2))) }],
    [items],
  );
  const options: ApexOptions = useMemo(
    () => ({
      ...baseChartOptions({ isDark, seriesCount: 1, type: 'bar' }),
      // One measure, one hue: length already encodes magnitude, and colouring
      // each bar differently would imply a category difference that isn't there.
      colors: [SERIES_COLORS[1]],
      plotOptions: {
        bar: { horizontal: true, borderRadius: 4, borderRadiusApplication: 'end', barHeight: '62%' },
      },
      dataLabels: {
        enabled: true,
        formatter: (v: number) => usd0(Number(v)),
        style: { fontSize: '11px' },
        offsetX: 28,
      },
      xaxis: {
        categories: labels,
        labels: { formatter: (v: string) => `$${Math.round(Number(v)).toLocaleString()}` },
      },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (v: number) => usd(v) } },
    }),
    [labels.join('|'), isDark],
  );
  return (
    <ReactApexChart options={options} series={series} type="bar" height={Math.max(180, items.length * 38)} />
  );
}

/**
 * Donut of spend by category, total in the centre.
 *
 * Folds past the fourth category into a gray "Other" — the palette is four
 * hues and every fifth one tested collided with a hue already in the set (see
 * chart-theme.ts). A donut shows every slice at once, so this is the form where
 * that ceiling actually bites.
 */
export function SpendDonut({
  items,
  isDark,
}: {
  items: { label: string; value: number }[];
  isDark: boolean;
}) {
  const folded = useMemo(() => foldToPalette(items), [items]);
  const labels = folded.map((i) => i.label);
  const colors = folded.map((i) => i.color);
  const series = folded.map((i) => Number(i.value.toFixed(2)));
  const total = series.reduce((a, b) => a + b, 0);

  const options: ApexOptions = useMemo(
    () => ({
      ...baseChartOptions({ isDark, seriesCount: labels.length, type: 'donut' }),
      labels,
      colors,
      legend: { show: true, position: 'bottom', markers: { size: 7 }, fontSize: '12px' },
      // Percent on the slice is the secondary encoding the palette's tightest
      // pair depends on — do not turn this off. Slices under 5% get no label:
      // at that size the text overflows its own arc and collides with its
      // neighbour's, which is worse than no label (the legend and tooltip still
      // carry the value).
      dataLabels: {
        enabled: true,
        formatter: (v: number) => (Number(v) < 5 ? '' : `${Number(v).toFixed(0)}%`),
      },
      // 2px surface ring so adjacent arcs separate without relying on hue.
      stroke: { width: 2, colors: [surfaceGap(isDark)] },
      plotOptions: {
        pie: {
          donut: {
            size: '58%',
            labels: {
              show: true,
              total: { show: true, label: 'Total', formatter: () => usd0(total) },
            },
          },
        },
      },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (v: number) => usd(v) } },
    }),
    [labels.join('|'), colors.join('|'), isDark, total],
  );
  return <ReactApexChart options={options} series={series} type="donut" height={300} />;
}

/**
 * Stacked spend-by-age bars split by gender (Meta demographics).
 *
 * Gender keeps a FIXED colour per value rather than taking the next palette
 * slot, so male/female don't swap hues between two accounts just because one
 * has no "unknown" bucket. Colour follows the entity, never its position.
 */
export function DemographicsChart({
  rows,
  isDark,
}: {
  rows: { age: string; gender: string; spend: number }[];
  isDark: boolean;
}) {
  const { categories, series } = useMemo(() => {
    const ages = [...new Set(rows.map((r) => r.age))].sort();
    const genders = [...new Set(rows.map((r) => r.gender))];
    const byKey = new Map(rows.map((r) => [`${r.age}|${r.gender}`, r.spend]));
    const byGender: Record<string, string> = {
      male: SERIES_COLORS[1],
      female: SERIES_COLORS[3],
      unknown: '#71717a',
    };
    return {
      categories: ages,
      series: genders.map((g) => ({
        name: g.charAt(0).toUpperCase() + g.slice(1),
        color: byGender[g] ?? SERIES_COLORS[0],
        data: ages.map((age) => Number((byKey.get(`${age}|${g}`) ?? 0).toFixed(2))),
      })),
    };
  }, [rows]);

  const options: ApexOptions = useMemo(
    () => ({
      ...baseChartOptions({ isDark, seriesCount: series.length, type: 'bar' }),
      chart: {
        ...baseChartOptions({ isDark, seriesCount: series.length, type: 'bar' }).chart,
        stacked: true,
      },
      plotOptions: { bar: { borderRadius: 3, borderRadiusApplication: 'end', columnWidth: '58%' } },
      // 2px surface gap so stacked segments read as separate bands.
      stroke: { show: true, width: 2, colors: [surfaceGap(isDark)] },
      xaxis: { categories, axisTicks: { show: false } },
      yaxis: { labels: { formatter: (v: number) => `$${Math.round(v).toLocaleString()}` } },
      tooltip: { theme: isDark ? 'dark' : 'light', shared: true, intersect: false, y: { formatter: (v: number) => usd(v) } },
    }),
    [categories, isDark, series.length],
  );
  return <ReactApexChart options={options} series={series} type="bar" height={300} />;
}
