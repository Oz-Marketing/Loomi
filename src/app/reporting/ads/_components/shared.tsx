'use client';

/**
 * Shared building blocks for the Ads report tabs (Meta, StackAdapt, …).
 * Controls, KPI/section primitives, formatters, delta helpers, and the
 * platform-agnostic charts live here so each platform tab only owns its
 * fetch + which visuals it shows.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowsRightLeftIcon,
  ChevronDownIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import type { ApexOptions } from 'apexcharts';
import {
  DashboardToolbar,
  type CustomDateRange,
} from '@/components/filters/dashboard-toolbar';
import { type DateRangeKey, getDateRangeBounds } from '@/lib/date-ranges';

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

export const usd = (v: number) =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
export const usd0 = (v: number) =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const num = (v: number) => Math.round(v).toLocaleString('en-US');
export const compact = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(Math.round(v));
export const pctText = (v: number) => `${v.toFixed(2)}%`;
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

export interface Delta {
  text: string;
  good: boolean;
}
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

const TONE: Record<string, { bg: string; text: string }> = {
  primary: { bg: 'bg-[var(--primary)]/10', text: 'text-[var(--primary)]' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  sky: { bg: 'bg-sky-500/10', text: 'text-sky-400' },
  violet: { bg: 'bg-violet-500/10', text: 'text-violet-400' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
  zinc: { bg: 'bg-zinc-500/10', text: 'text-zinc-400' },
};

export function Kpi({
  icon: Icon,
  label,
  value,
  secondary,
  tone,
  delta,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  value: string;
  secondary?: string;
  tone: keyof typeof TONE;
  delta?: Delta;
}) {
  const t = TONE[tone];
  return (
    <div className="glass-section-card rounded-xl border border-[var(--border)] p-4 transition-colors hover:border-[var(--primary)]/30">
      <div className="mb-2 flex items-center gap-2">
        <div className={`flex h-7 w-7 items-center justify-center rounded-md ${t.bg} ${t.text}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p>
      </div>
      <div className="flex items-baseline gap-2">
        <p className="text-xl font-bold tabular-nums">{value}</p>
        {delta && (
          <span className={`text-[11px] font-medium tabular-nums ${delta.good ? 'text-emerald-400' : 'text-red-400'}`}>
            {delta.text}
          </span>
        )}
      </div>
      {secondary && <p className="mt-0.5 text-[11px] tabular-nums text-[var(--muted-foreground)]">{secondary}</p>}
    </div>
  );
}

export function Section({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-section-card rounded-2xl border border-[var(--border)] p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-[var(--muted-foreground)]" />}
          <h3 className="text-sm font-semibold text-[var(--foreground)]">{title}</h3>
        </div>
        {subtitle && <p className="text-[11px] text-[var(--muted-foreground)]">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-[var(--muted-foreground)]">{children}</p>;
}

/**
 * Compact data table for report breakdowns. Long lists collapse to `maxRows`
 * with a "Show all" toggle; when expanded they scroll inside a bounded box with
 * a sticky header, so a 50-keyword list never dominates the page. First column
 * is left-aligned + truncated, the rest right-aligned tabular numbers.
 */
export function DataTable({
  head,
  rows,
  maxRows = 8,
}: {
  head: string[];
  rows: (string | number)[][];
  maxRows?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const overflowing = rows.length > maxRows;
  const visible = expanded ? rows : rows.slice(0, maxRows);

  return (
    <div>
      <div className={`overflow-x-auto ${expanded && overflowing ? 'max-h-[24rem] overflow-y-auto' : ''}`}>
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-[var(--card)]">
            <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              {head.map((h, i) => (
                <th key={h} className={`py-2 ${i === 0 ? 'pr-3' : 'px-3 text-right'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, ri) => (
              <tr key={ri} className="border-t border-[var(--border)] transition-colors hover:bg-[var(--muted)]/40">
                {r.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`py-2.5 tabular-nums ${ci === 0 ? 'max-w-[280px] truncate pr-3' : 'px-3 text-right'}`}
                    title={ci === 0 ? String(cell) : undefined}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {overflowing && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 text-[11px] font-medium text-[var(--primary)] hover:underline"
        >
          {expanded ? 'Show less' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  tone = 'muted',
  action,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  body: string;
  tone?: 'muted' | 'error';
  action?: { label: string; onClick: () => void };
}) {
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
        <p className="text-sm font-semibold text-[var(--foreground)]">{title}</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-[var(--muted-foreground)]">{body}</p>
      </div>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-1 rounded-lg bg-[var(--primary)] px-3.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
        >
          {action.label}
        </button>
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
            <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
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

const gridColor = (isDark: boolean) =>
  isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
const chartFg = (isDark: boolean) => (isDark ? '#9ca3af' : '#525252');

/** Daily spend (area) + a second metric (line), dual axis. */
export function DailyChart({
  rows,
  isDark,
  secondaryName = 'Clicks',
}: {
  rows: { date: string; spend: number; secondary: number }[];
  isDark: boolean;
  /** Label for the line series (the second metric), e.g. "Clicks" or "Impressions". */
  secondaryName?: string;
}) {
  const series = useMemo(
    () => [
      { name: 'Spend', type: 'area', data: rows.map((r) => [new Date(`${r.date}T00:00:00Z`).getTime(), Number(r.spend.toFixed(2))]) },
      { name: secondaryName, type: 'line', data: rows.map((r) => [new Date(`${r.date}T00:00:00Z`).getTime(), r.secondary]) },
    ],
    [rows, secondaryName],
  );
  const options: ApexOptions = useMemo(
    () => ({
      chart: { type: 'line', toolbar: { show: false }, zoom: { enabled: false }, foreColor: chartFg(isDark) },
      stroke: { curve: 'smooth', width: [2, 2] },
      fill: { type: ['gradient', 'solid'], gradient: { opacityFrom: 0.3, opacityTo: 0.05 } },
      dataLabels: { enabled: false },
      legend: { position: 'top', horizontalAlign: 'left' },
      colors: ['#6366f1', '#38bdf8'],
      xaxis: { type: 'datetime', labels: { format: 'MMM d' } },
      yaxis: [
        { labels: { formatter: (v: number) => `$${Math.round(v).toLocaleString()}` } },
        { opposite: true, labels: { formatter: (v: number) => Math.round(v).toLocaleString() } },
      ],
      tooltip: { theme: isDark ? 'dark' : 'light', x: { format: 'MMM d, yyyy' }, y: { formatter: (v: number, { seriesIndex }) => (seriesIndex === 0 ? usd(v) : num(v)) } },
      grid: { borderColor: gridColor(isDark), strokeDashArray: 4 },
    }),
    [isDark],
  );
  return <ReactApexChart options={options} series={series} type="line" height={300} />;
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
  const series = useMemo(() => [{ name: 'Spend', data: items.map((i) => Number(i.value.toFixed(2))) }], [items]);
  const options: ApexOptions = useMemo(
    () => ({
      chart: { type: 'bar', toolbar: { show: false }, foreColor: chartFg(isDark) },
      plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '62%' } },
      colors: ['#6366f1'],
      dataLabels: { enabled: true, formatter: (v: number) => usd0(Number(v)), style: { fontSize: '10px' }, offsetX: 28 },
      xaxis: { categories: labels, labels: { formatter: (v: string) => `$${Math.round(Number(v)).toLocaleString()}` } },
      grid: { borderColor: gridColor(isDark), strokeDashArray: 4 },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (v: number) => usd(v) } },
    }),
    [labels.join('|'), isDark],
  );
  return <ReactApexChart options={options} series={series} type="bar" height={Math.max(180, items.length * 38)} />;
}

/** Donut of spend by category, with the total in the center. */
export function SpendDonut({
  items,
  isDark,
}: {
  items: { label: string; value: number }[];
  isDark: boolean;
}) {
  const labels = items.map((i) => i.label);
  const series = items.map((i) => Number(i.value.toFixed(2)));
  const options: ApexOptions = useMemo(
    () => ({
      chart: { type: 'donut', foreColor: chartFg(isDark) },
      labels,
      legend: { position: 'bottom' },
      colors: ['#6366f1', '#38bdf8', '#a78bfa', '#fbbf24', '#34d399', '#f472b6'],
      dataLabels: { enabled: true, formatter: (v: number) => `${Number(v).toFixed(0)}%` },
      plotOptions: { pie: { donut: { labels: { show: true, total: { show: true, label: 'Total', formatter: () => usd0(series.reduce((a, b) => a + b, 0)) } } } } },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (v: number) => usd(v) } },
      stroke: { width: 0 },
    }),
    [labels.join('|'), isDark],
  );
  return <ReactApexChart options={options} series={series} type="donut" height={300} />;
}

/** Stacked spend-by-age bars split by gender (Meta demographics). */
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
    const palette: Record<string, string> = { male: '#38bdf8', female: '#f472b6', unknown: '#a1a1aa' };
    return {
      categories: ages,
      series: genders.map((g) => ({
        name: g.charAt(0).toUpperCase() + g.slice(1),
        color: palette[g] ?? '#6366f1',
        data: ages.map((age) => Number((byKey.get(`${age}|${g}`) ?? 0).toFixed(2))),
      })),
    };
  }, [rows]);

  const options: ApexOptions = useMemo(
    () => ({
      chart: { type: 'bar', stacked: true, toolbar: { show: false }, foreColor: chartFg(isDark) },
      plotOptions: { bar: { borderRadius: 3, columnWidth: '58%' } },
      dataLabels: { enabled: false },
      legend: { position: 'top', horizontalAlign: 'left' },
      xaxis: { categories },
      yaxis: { labels: { formatter: (v: number) => `$${Math.round(v).toLocaleString()}` } },
      grid: { borderColor: gridColor(isDark), strokeDashArray: 4 },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (v: number) => usd(v) } },
    }),
    [categories, isDark],
  );
  return <ReactApexChart options={options} series={series} type="bar" height={300} />;
}
