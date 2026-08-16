'use client';

/**
 * Charts for the dealer-data reports (Sales Trend, Service Trend).
 *
 * WHY NOT `DailyChart` FROM ads/shared. That one plots two measures on two
 * y-axes. A dual-axis chart lets the author slide one scale against the other
 * until the lines "agree", so the crossings it shows are an artifact of the
 * axis choice rather than of the data. Units and dollars are different scales,
 * so they get two charts stacked in one column instead — same x, honest y.
 *
 * PALETTE. Now lives in ui/chart-theme.ts, which is the single source for every
 * Reporting chart — this file's palette WAS that source (it was the validated
 * one; the ads module had a second, unreadable set), so it moved rather than
 * changed. Re-run the validator before touching a hue; see that file's header.
 */

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { ApexOptions } from 'apexcharts';
import { usd, usd0, num } from '../ads/_components/shared';
import { SERIES_COLORS, gridColor, chartFg, surfaceGap } from './ui/chart-theme';

const ReactApexChart = dynamic(() => import('react-apexcharts'), { ssr: false });

// Re-exported because report pages import it from here today.
export { SERIES_COLORS };

export interface StackSeries {
  name: string;
  data: number[];
}

/**
 * Stacked monthly columns. Used for both unit mix and revenue mix; `money`
 * switches the axis/tooltip formatting.
 *
 * Series with no data anywhere in the range are dropped by the caller, not
 * here — a legend entry for an always-zero series is noise, but which series
 * those are is a report-level judgment (a powersports dealer legitimately has
 * no lease row; an automotive one with zero leases this quarter still might).
 */
export function MonthlyStackChart({
  categories,
  series,
  isDark,
  money = false,
  height = 320,
  showLegend = true,
  stacked = true,
}: {
  categories: string[];
  series: StackSeries[];
  isDark: boolean;
  money?: boolean;
  height?: number;
  /** Off for a lone series — the section title already names it. */
  showLegend?: boolean;
  /**
   * Stack only when the series are PARTS OF ONE TOTAL (new + used + lease).
   * Turn it off when they are competing measures of the same thing — budget
   * vs actual — where stacking would add them into a total nobody means.
   */
  stacked?: boolean;
}) {
  const options: ApexOptions = useMemo(
    () => ({
      chart: {
        type: 'bar',
        stacked,
        toolbar: { show: false },
        zoom: { enabled: false },
        foreColor: chartFg(isDark),
        animations: { enabled: true, speed: 250 },
      },
      // 2px surface-coloured gap between stacked segments so adjacent fills
      // read as separate bands without relying on hue alone.
      stroke: { show: true, width: 2, colors: [surfaceGap(isDark)] },
      plotOptions: { bar: { borderRadius: 4, borderRadiusApplication: 'end', columnWidth: '58%' } },
      colors: [...SERIES_COLORS],
      dataLabels: { enabled: false },
      legend: { show: showLegend, position: 'top', horizontalAlign: 'left', markers: { size: 7 } },
      xaxis: { categories, axisTicks: { show: false } },
      yaxis: {
        labels: {
          formatter: (v: number) =>
            money ? `$${Math.round(v).toLocaleString()}` : Math.round(v).toLocaleString(),
        },
      },
      grid: { borderColor: gridColor(isDark), strokeDashArray: 4 },
      tooltip: {
        theme: isDark ? 'dark' : 'light',
        shared: true,
        intersect: false,
        y: { formatter: (v: number) => (money ? usd(v) : num(v)) },
      },
    }),
    [categories, isDark, money, showLegend, stacked],
  );

  return <ReactApexChart options={options} series={series} type="bar" height={height} />;
}

/**
 * Horizontal ranked bars — top ZIPs, top cities. Caller pre-sorts and slices.
 *
 * Single series, so no legend and one hue: the bars encode magnitude by length,
 * and colouring each bar differently would imply a category difference that
 * isn't there.
 */
export function RankedBarChart({
  items,
  isDark,
  money = false,
  valueLabel = 'Volume',
}: {
  items: { label: string; value: number }[];
  isDark: boolean;
  money?: boolean;
  valueLabel?: string;
}) {
  const labels = items.map((i) => (i.label.length > 28 ? `${i.label.slice(0, 27)}…` : i.label));
  const series = useMemo(
    () => [{ name: valueLabel, data: items.map((i) => Number(i.value.toFixed(2))) }],
    [items, valueLabel],
  );
  const options: ApexOptions = useMemo(
    () => ({
      chart: {
        type: 'bar',
        toolbar: { show: false },
        foreColor: chartFg(isDark),
        animations: { enabled: true, speed: 250 },
      },
      plotOptions: { bar: { horizontal: true, borderRadius: 4, borderRadiusApplication: 'end', barHeight: '62%' } },
      colors: [SERIES_COLORS[1]],
      dataLabels: {
        enabled: true,
        formatter: (v: number) => (money ? usd0(Number(v)) : num(Number(v))),
        style: { fontSize: '10px' },
        offsetX: 26,
      },
      legend: { show: false },
      xaxis: {
        categories: labels,
        labels: {
          formatter: (v: string) =>
            money ? `$${Math.round(Number(v)).toLocaleString()}` : Math.round(Number(v)).toLocaleString(),
        },
      },
      grid: { borderColor: gridColor(isDark), strokeDashArray: 4 },
      tooltip: {
        theme: isDark ? 'dark' : 'light',
        y: { formatter: (v: number) => (money ? usd(v) : num(v)) },
      },
    }),
    [labels.join('|'), isDark, money],
  );

  return (
    <ReactApexChart
      options={options}
      series={series}
      type="bar"
      height={Math.max(180, items.length * 34)}
    />
  );
}

/**
 * Grouped percentage columns by cohort — retention rates.
 *
 * GROUPED, NOT STACKED. The retention windows are nested subsets (everyone
 * retained at 12 months is also retained at 24 and ever), so stacking them
 * would add a customer to the same bar two or three times. Side-by-side bars
 * are the only honest arrangement.
 *
 * A null datum is an immature cohort — its window hasn't closed. Apex leaves a
 * gap, which is the intent: no bar rather than a short one.
 */
export function CohortRateChart({
  categories,
  series,
  isDark,
  height = 300,
}: {
  categories: string[];
  series: { name: string; data: (number | null)[] }[];
  isDark: boolean;
  height?: number;
}) {
  const options: ApexOptions = useMemo(
    () => ({
      chart: {
        type: 'bar',
        stacked: false,
        toolbar: { show: false },
        zoom: { enabled: false },
        foreColor: chartFg(isDark),
        animations: { enabled: true, speed: 250 },
      },
      plotOptions: {
        bar: { borderRadius: 4, borderRadiusApplication: 'end', columnWidth: '62%' },
      },
      colors: [...SERIES_COLORS],
      dataLabels: { enabled: false },
      legend: { show: series.length > 1, position: 'top', horizontalAlign: 'left', markers: { size: 7 } },
      xaxis: { categories, axisTicks: { show: false } },
      yaxis: {
        min: 0,
        max: 100,
        tickAmount: 5,
        labels: { formatter: (v: number) => `${Math.round(v)}%` },
      },
      grid: { borderColor: gridColor(isDark), strokeDashArray: 4 },
      tooltip: {
        theme: isDark ? 'dark' : 'light',
        shared: true,
        intersect: false,
        y: { formatter: (v: number | null) => (v === null ? 'Not yet measurable' : `${v.toFixed(1)}%`) },
      },
    }),
    [categories, isDark, series.length],
  );

  return <ReactApexChart options={options} series={series} type="bar" height={height} />;
}

/**
 * Single-measure monthly line — average price, average RO value, and the like.
 * One series, so no legend: the section title names it.
 */
export function MonthlyLineChart({
  categories,
  name,
  data,
  isDark,
  money = true,
  height = 260,
}: {
  categories: string[];
  name: string;
  data: number[];
  isDark: boolean;
  money?: boolean;
  height?: number;
}) {
  const options: ApexOptions = useMemo(
    () => ({
      chart: {
        type: 'line',
        toolbar: { show: false },
        zoom: { enabled: false },
        foreColor: chartFg(isDark),
        animations: { enabled: true, speed: 250 },
      },
      stroke: { curve: 'smooth', width: 2 },
      colors: [SERIES_COLORS[1]],
      dataLabels: { enabled: false },
      legend: { show: false },
      markers: { size: 4, strokeWidth: 2, strokeColors: surfaceGap(isDark) },
      xaxis: { categories, axisTicks: { show: false } },
      yaxis: {
        labels: {
          formatter: (v: number) =>
            money ? `$${Math.round(v).toLocaleString()}` : Math.round(v).toLocaleString(),
        },
      },
      grid: { borderColor: gridColor(isDark), strokeDashArray: 4 },
      tooltip: {
        theme: isDark ? 'dark' : 'light',
        y: { formatter: (v: number) => (money ? usd0(v) : num(v)) },
      },
    }),
    [categories, isDark, money],
  );

  return <ReactApexChart options={options} series={[{ name, data }]} type="line" height={height} />;
}

/**
 * Stacked daily areas over a real datetime axis — Business Profile impressions
 * split by surface (Maps vs Search).
 *
 * Datetime rather than categorical because a daily range can be 7 days or 90,
 * and a categorical axis would print every single label. Stacking is correct
 * here: the parts genuinely sum to total impressions.
 */
export function DailyStackChart({
  rows,
  series,
  isDark,
  height = 300,
}: {
  rows: { date: string }[];
  series: { name: string; key: string }[];
  isDark: boolean;
  height?: number;
}) {
  const apexSeries = useMemo(
    () =>
      series.map((s) => ({
        name: s.name,
        data: rows.map((r) => [
          new Date(`${r.date}T00:00:00Z`).getTime(),
          Number((r as Record<string, unknown>)[s.key] ?? 0),
        ]),
      })),
    [rows, series],
  );

  const options: ApexOptions = useMemo(
    () => ({
      chart: {
        type: 'area',
        stacked: true,
        toolbar: { show: false },
        zoom: { enabled: false },
        foreColor: chartFg(isDark),
        animations: { enabled: true, speed: 250 },
      },
      stroke: { curve: 'smooth', width: 2 },
      fill: { type: 'gradient', gradient: { opacityFrom: 0.35, opacityTo: 0.05 } },
      colors: [...SERIES_COLORS],
      dataLabels: { enabled: false },
      legend: { show: series.length > 1, position: 'top', horizontalAlign: 'left', markers: { size: 7 } },
      xaxis: { type: 'datetime', labels: { format: 'MMM d' } },
      yaxis: { labels: { formatter: (v: number) => Math.round(v).toLocaleString() } },
      grid: { borderColor: gridColor(isDark), strokeDashArray: 4 },
      tooltip: {
        theme: isDark ? 'dark' : 'light',
        shared: true,
        intersect: false,
        x: { format: 'MMM d, yyyy' },
        y: { formatter: (v: number) => num(v) },
      },
    }),
    [isDark, series],
  );

  return <ReactApexChart options={options} series={apexSeries} type="area" height={height} />;
}

/**
 * Share-of-total donut for counts (devices, surfaces). The ads module's
 * `SpendDonut` formats in dollars; this one is the integer equivalent.
 */
export function ShareDonut({
  items,
  isDark,
  height = 260,
}: {
  items: { label: string; value: number }[];
  isDark: boolean;
  height?: number;
}) {
  const labels = items.map((i) => i.label);
  const values = items.map((i) => i.value);
  const total = values.reduce((a, b) => a + b, 0);

  const options: ApexOptions = useMemo(
    () => ({
      chart: { type: 'donut', foreColor: chartFg(isDark), animations: { enabled: true, speed: 250 } },
      labels,
      legend: { position: 'bottom' },
      colors: [...SERIES_COLORS],
      // 2px surface ring so adjacent arcs read apart without relying on hue.
      stroke: { width: 2, colors: [surfaceGap(isDark)] },
      dataLabels: { enabled: true, formatter: (v: number) => `${Number(v).toFixed(0)}%` },
      plotOptions: {
        pie: {
          donut: {
            labels: {
              show: true,
              total: { show: true, label: 'Total', formatter: () => num(total) },
            },
          },
        },
      },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (v: number) => num(v) } },
    }),
    [labels.join('|'), isDark, total],
  );

  return <ReactApexChart options={options} series={values} type="donut" height={height} />;
}
