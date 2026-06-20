'use client';

/**
 * GA4-specific charts. The shared Ads charts (DailyChart/SpendDonut) format in
 * dollars; website analytics is counts, so these mirror their structure with
 * integer formatters.
 */

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { ApexOptions } from 'apexcharts';

const ReactApexChart = dynamic(() => import('react-apexcharts'), { ssr: false });

const gridColor = (isDark: boolean) => (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)');
const chartFg = (isDark: boolean) => (isDark ? '#9ca3af' : '#525252');
const intFmt = (v: number) => Math.round(v).toLocaleString('en-US');

/** Daily sessions (area) + users (line). */
export function Ga4TrendChart({
  rows,
  isDark,
}: {
  rows: { date: string; sessions: number; users: number }[];
  isDark: boolean;
}) {
  const series = useMemo(
    () => [
      {
        name: 'Sessions',
        type: 'area',
        data: rows.map((r) => [new Date(`${r.date}T00:00:00Z`).getTime(), r.sessions]),
      },
      {
        name: 'Users',
        type: 'line',
        data: rows.map((r) => [new Date(`${r.date}T00:00:00Z`).getTime(), r.users]),
      },
    ],
    [rows],
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
      yaxis: { labels: { formatter: intFmt } },
      tooltip: { theme: isDark ? 'dark' : 'light', x: { format: 'MMM d, yyyy' }, y: { formatter: intFmt } },
      grid: { borderColor: gridColor(isDark), strokeDashArray: 4 },
    }),
    [isDark],
  );
  return <ReactApexChart options={options} series={series} type="line" height={300} />;
}

/** Donut of sessions by channel, with the total in the center. */
export function Ga4ChannelDonut({
  items,
  isDark,
}: {
  items: { label: string; value: number }[];
  isDark: boolean;
}) {
  const labels = items.map((i) => i.label);
  const series = items.map((i) => i.value);
  const total = series.reduce((a, b) => a + b, 0);
  const options: ApexOptions = useMemo(
    () => ({
      chart: { type: 'donut', foreColor: chartFg(isDark) },
      labels,
      legend: { position: 'bottom' },
      colors: ['#6366f1', '#38bdf8', '#a78bfa', '#fbbf24', '#34d399', '#f472b6', '#fb923c', '#22d3ee'],
      dataLabels: { enabled: true, formatter: (v: number) => `${Number(v).toFixed(0)}%` },
      plotOptions: {
        pie: {
          donut: {
            labels: { show: true, total: { show: true, label: 'Sessions', formatter: () => intFmt(total) } },
          },
        },
      },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: intFmt } },
      stroke: { width: 0 },
    }),
    [labels.join('|'), isDark, total],
  );
  return <ReactApexChart options={options} series={series} type="donut" height={300} />;
}
