'use client';

/**
 * GA4-specific charts. The shared Ads charts (DailyChart/SpendDonut) format in
 * dollars; website analytics is counts, so these mirror their structure with
 * integer formatters.
 *
 * Palette, grid, and surfaces come from ui/chart-theme — this file used to
 * carry its own copy, including an eight-hue donut palette whose extra hues
 * were indistinguishable from the ones they sat next to.
 */

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { ApexOptions } from 'apexcharts';
import {
  SERIES_COLORS,
  baseChartOptions,
  foldToPalette,
  surfaceGap,
} from '../../_components/ui/chart-theme';
import { LABEL } from '../../_components/ui/scale';

const ReactApexChart = dynamic(() => import('react-apexcharts'), { ssr: false });

const intFmt = (v: number) => Math.round(v).toLocaleString('en-US');

/**
 * Daily sessions and users, as two stacked plots on a shared x-axis.
 *
 * Was a dual-axis chart. Sessions and users are close in magnitude, which made
 * it especially misleading: two independent scales let the two lines cross and
 * re-cross in ways that say nothing about the site. One axis each.
 */
export function Ga4TrendChart({
  rows,
  isDark,
}: {
  rows: { date: string; sessions: number; users: number }[];
  isDark: boolean;
}) {
  const points = useMemo(
    () => rows.map((r) => new Date(`${r.date}T00:00:00Z`).getTime()),
    [rows],
  );
  const sessions = useMemo(
    () => [{ name: 'Sessions', data: rows.map((r, i) => [points[i], r.sessions]) }],
    [rows, points],
  );
  const users = useMemo(
    () => [{ name: 'Users', data: rows.map((r, i) => [points[i], r.users]) }],
    [rows, points],
  );

  const common = (color: string, type: 'area' | 'line'): ApexOptions => ({
    ...baseChartOptions({ isDark, seriesCount: 1, type }),
    colors: [color],
    stroke: { curve: 'smooth', width: 2 },
    xaxis: { type: 'datetime', labels: { format: 'MMM d' } },
    yaxis: { labels: { formatter: intFmt } },
    tooltip: {
      theme: isDark ? 'dark' : 'light',
      x: { format: 'MMM d, yyyy' },
      y: { formatter: intFmt },
    },
  });

  const sessionsOptions: ApexOptions = useMemo(
    () => ({
      ...common(SERIES_COLORS[1], 'area'),
      fill: { type: 'gradient', gradient: { opacityFrom: 0.3, opacityTo: 0.05 } },
    }),
    [isDark],
  );
  const usersOptions: ApexOptions = useMemo(() => common(SERIES_COLORS[0], 'line'), [isDark]);

  return (
    <div className="space-y-1">
      <p className={LABEL}>Sessions</p>
      <ReactApexChart options={sessionsOptions} series={sessions} type="area" height={190} />
      <p className={LABEL}>Users</p>
      <ReactApexChart options={usersOptions} series={users} type="line" height={150} />
    </div>
  );
}

/**
 * Donut of sessions by channel, total in the centre.
 *
 * Channels past the fourth fold into a gray "Other" — the palette is four hues
 * (see chart-theme.ts). GA4's default channel grouping routinely returns eight,
 * and the long tail of those is usually a handful of sessions each, so folding
 * loses nothing a reader was going to act on.
 */
export function Ga4ChannelDonut({
  items,
  isDark,
}: {
  items: { label: string; value: number }[];
  isDark: boolean;
}) {
  const folded = useMemo(() => foldToPalette(items), [items]);
  const labels = folded.map((i) => i.label);
  const colors = folded.map((i) => i.color);
  const series = folded.map((i) => i.value);
  const total = series.reduce((a, b) => a + b, 0);

  const options: ApexOptions = useMemo(
    () => ({
      ...baseChartOptions({ isDark, seriesCount: labels.length, type: 'donut' }),
      labels,
      colors,
      legend: { show: true, position: 'bottom', markers: { size: 7 }, fontSize: '12px' },
      // Sub-5% slices go unlabelled — see the SpendDonut note in shared.tsx.
      dataLabels: {
        enabled: true,
        formatter: (v: number) => (Number(v) < 5 ? '' : `${Number(v).toFixed(0)}%`),
      },
      stroke: { width: 2, colors: [surfaceGap(isDark)] },
      plotOptions: {
        pie: {
          donut: {
            labels: {
              show: true,
              total: { show: true, label: 'Sessions', formatter: () => intFmt(total) },
            },
          },
        },
      },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: intFmt } },
    }),
    [labels.join('|'), colors.join('|'), isDark, total],
  );
  return <ReactApexChart options={options} series={series} type="donut" height={300} />;
}
