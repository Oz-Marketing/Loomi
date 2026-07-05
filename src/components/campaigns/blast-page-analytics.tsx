'use client';

import { useMemo, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from '@/contexts/theme-context';
import {
  PaperAirplaneIcon,
  CheckCircleIcon,
  ClockIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import { FlowIcon } from '@/components/icon-map';
import { iconColorHex } from '@/lib/icon-colors';
import {
  type DateRangeKey,
  getDateRangeBounds,
  getMonthBuckets,
} from '@/lib/date-ranges';
import type { CustomDateRange } from '@/components/filters/dashboard-toolbar';
import type { ApexOptions } from 'apexcharts';

const ReactApexChart = dynamic(() => import('react-apexcharts'), { ssr: false });

// ── Types ──

interface Campaign {
  id: string;
  name: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  scheduledAt?: string;
  sentAt?: string;
  locationId?: string;
  accountKey?: string;
  dealer?: string;
  sentCount?: number;
}

interface Workflow {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  locationId: string;
  accountKey?: string;
  dealer?: string;
}

interface CampaignPageAnalyticsProps {
  campaigns: Campaign[];
  loading?: boolean;
  showAccountBreakdown?: boolean;
  accountNames?: Record<string, string>;
  emptyTitle?: string;
  emptySubtitle?: string;
  dateRange?: DateRangeKey;
  customRange?: CustomDateRange | null;
  workflows?: Workflow[];
}

// ── Helpers ──

const STATUS_COLORS: Record<string, string> = {
  sent:      '#60a5fa',
  scheduled: '#3b82f6',
  draft:     '#bfdbfe',
  paused:    '#1d4ed8',
  cancelled: '#93c5fd',
};

function getStatusColor(status: string): string {
  return STATUS_COLORS[normalizeStatus(status)] || '#71717a';
}

function normalizeStatus(status: string): string {
  const s = status.toLowerCase().trim();
  if (s.includes('complete') || s.includes('deliver') || s.includes('finish') || s.includes('sent')) return 'sent';
  if (s.includes('active') || s.includes('sched') || s.includes('queue') || s.includes('start') || s.includes('running') || s.includes('progress')) return 'scheduled';
  if (s.includes('draft')) return 'draft';
  if (s.includes('pause')) return 'paused';
  if (s.includes('stop') || s.includes('cancel') || s.includes('inactive')) return 'cancelled';
  return s;
}

function statusLabel(status: string): string {
  const normalized = normalizeStatus(status);
  if (normalized === 'draft') return 'In Progress';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function campaignAccountKey(campaign: Campaign): string | null {
  return campaign.accountKey || null;
}

// ── Component ──

export function BlastPageAnalytics({
  campaigns,
  loading,
  showAccountBreakdown,
  accountNames,
  emptyTitle = 'No blast data yet',
  emptySubtitle = 'Sub-accounts may need to reconnect their integration with campaign scopes',
  dateRange,
  customRange,
  workflows = [],
}: CampaignPageAnalyticsProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [animated, setAnimated] = useState(false);
  const [showAllAccounts, setShowAllAccounts] = useState(false);

  useEffect(() => {
    if (campaigns.length > 0 && !loading) {
      const timer = setTimeout(() => setAnimated(true), 100);
      return () => clearTimeout(timer);
    }
  }, [campaigns.length, loading]);

  const analytics = useMemo(() => {
    if (campaigns.length === 0) return null;

    // Status counts
    const statusCounts = new Map<string, number>();
    campaigns.forEach(c => {
      const s = normalizeStatus(c.status);
      statusCounts.set(s, (statusCounts.get(s) || 0) + 1);
    });
    const statusEntries = [...statusCounts.entries()].sort((a, b) => b[1] - a[1]);

    const sentCount = campaigns.filter(c =>
      normalizeStatus(c.status) === 'sent'
    ).length;
    const scheduledCount = campaigns.filter(c =>
      normalizeStatus(c.status) === 'scheduled'
    ).length;
    const draftCount = campaigns.filter(c =>
      normalizeStatus(c.status) === 'draft'
    ).length;

    // Per-account breakdown
    let byAccountAll: [string, number][] = [];
    let byAccount: [string, number][] = [];
    let maxAccount = 0;
    let hasMoreAccounts = false;
    if (showAccountBreakdown) {
      const acctCounts = new Map<string, number>();
      campaigns.forEach(c => {
        const accountKey = campaignAccountKey(c);
        const name = (accountKey && accountNames?.[accountKey]) || c.dealer || accountKey || 'Unknown';
        acctCounts.set(name, (acctCounts.get(name) || 0) + 1);
      });
      byAccountAll = [...acctCounts.entries()].sort((a, b) => b[1] - a[1]);
      byAccount = byAccountAll.slice(0, 8);
      maxAccount = byAccountAll.length > 0 ? byAccountAll[0][1] : 0;
      hasMoreAccounts = byAccountAll.length > 8;
    }

    // Campaigns over time
    const bounds = dateRange === 'custom' && customRange
      ? getDateRangeBounds('custom', customRange.start, customRange.end)
      : getDateRangeBounds(dateRange ?? '6m');
    const buckets = getMonthBuckets(bounds.monthCount);
    const monthBuckets = buckets.map(b => ({
      label: b.label,
      count: campaigns.filter(c => {
        const raw = c.sentAt || c.scheduledAt || c.updatedAt || c.createdAt;
        if (!raw) return false;
        const cd = new Date(raw);
        return !Number.isNaN(cd.getTime()) && cd >= b.start && cd < b.end;
      }).length,
    }));

    return {
      statusEntries, sentCount, scheduledCount, draftCount,
      byAccountAll, byAccount, maxAccount, hasMoreAccounts,
      monthBuckets,
    };
  }, [campaigns, showAccountBreakdown, accountNames, dateRange, customRange]);

  // Timeline: campaigns vs workflows over time
  const timelineData = useMemo(() => {
    const bounds = dateRange === 'custom' && customRange
      ? getDateRangeBounds('custom', customRange.start, customRange.end)
      : getDateRangeBounds(dateRange ?? '6m');
    const buckets = getMonthBuckets(bounds.monthCount);

    function bucketDate(raw?: string): number {
      if (!raw) return -1;
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return -1;
      return buckets.findIndex(b => d >= b.start && d < b.end);
    }

    const campaignCounts = new Array(buckets.length).fill(0);
    const workflowCounts = new Array(buckets.length).fill(0);

    campaigns.forEach(c => {
      const idx = bucketDate(c.sentAt || c.scheduledAt || c.updatedAt || c.createdAt);
      if (idx >= 0) campaignCounts[idx]++;
    });

    workflows.forEach(w => {
      const idx = bucketDate(w.updatedAt || w.createdAt);
      if (idx >= 0) workflowCounts[idx]++;
    });

    const categories = buckets.map(b => b.label);
    const hasData = campaignCounts.some(v => v > 0) || workflowCounts.some(v => v > 0);

    return {
      categories,
      series: [
        { name: 'Blasts', data: campaignCounts },
        { name: 'Workflows', data: workflowCounts },
      ],
      hasData,
    };
  }, [campaigns, workflows, dateRange, customRange]);

  // ── Chart config ──

  const chartTextColor = isDark ? '#a1a1aa' : '#71717a';
  const chartGridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  // Timeline area chart (already ApexCharts)
  const timelineChartOptions: ApexOptions = useMemo(() => ({
    chart: {
      type: 'area',
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: 'inherit',
      background: 'transparent',
      animations: { enabled: true, speed: 600, easing: 'easeinout' },
    },
    colors: [iconColorHex('campaigns'), iconColorHex('flows')],
    stroke: { curve: 'smooth', width: 2.5 },
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.05, stops: [0, 90, 100] },
    },
    xaxis: {
      categories: timelineData.categories,
      labels: { style: { colors: chartTextColor, fontSize: '10px' } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: { style: { colors: chartTextColor, fontSize: '10px' } },
      min: 0,
      forceNiceScale: true,
    },
    grid: {
      borderColor: chartGridColor,
      strokeDashArray: 4,
      xaxis: { lines: { show: false } },
    },
    legend: {
      position: 'top',
      horizontalAlign: 'right',
      labels: { colors: chartTextColor },
      fontSize: '11px',
      markers: { size: 4, offsetX: -2 },
      itemMargin: { horizontal: 10 },
    },
    tooltip: {
      theme: isDark ? 'dark' : 'light',
      style: { fontSize: '11px' },
      y: { formatter: (val: number) => `${val}` },
    },
    dataLabels: { enabled: false },
  }), [timelineData.categories, chartTextColor, chartGridColor, isDark]);

  // Campaign status donut
  const statusDonutOptions: ApexOptions = useMemo(() => {
    if (!analytics || analytics.statusEntries.length === 0) return {} as ApexOptions;
    return {
      chart: { type: 'donut', background: 'transparent', animations: { enabled: true, speed: 600, easing: 'easeinout' } },
      colors: analytics.statusEntries.map(([status]) => getStatusColor(status)),
      labels: analytics.statusEntries.map(([status]) => statusLabel(status)),
      legend: {
        position: 'right',
        fontSize: '11px',
        labels: { colors: chartTextColor },
        markers: { size: 6, offsetX: -3 },
        formatter: (seriesName: string, opts: { seriesIndex: number; w: { globals: { series: number[] } } }) => {
          const val = opts.w.globals.series[opts.seriesIndex];
          const total = opts.w.globals.series.reduce((a: number, b: number) => a + b, 0);
          const pct = total > 0 ? Math.round((val / total) * 100) : 0;
          return `${seriesName}  ${val} (${pct}%)`;
        },
      },
      plotOptions: {
        pie: {
          donut: {
            size: '70%',
            labels: {
              show: true,
              name: { show: true, fontSize: '10px', color: chartTextColor },
              value: { show: true, fontSize: '18px', fontWeight: 700, color: isDark ? '#e4e4e7' : '#18181b' },
              total: { show: true, label: 'blasts', fontSize: '10px', color: chartTextColor, formatter: () => String(campaigns.length) },
            },
          },
        },
      },
      dataLabels: { enabled: false },
      stroke: { show: false },
      tooltip: { theme: isDark ? 'dark' : 'light' },
    };
  }, [analytics, chartTextColor, isDark, campaigns.length]);

  const statusDonutSeries = useMemo(
    () => analytics?.statusEntries.map(([, count]) => count) ?? [],
    [analytics],
  );

  // Campaigns by account horizontal bar
  const visibleAccounts = showAllAccounts ? (analytics?.byAccountAll ?? []) : (analytics?.byAccount ?? []);

  const accountBarOptions: ApexOptions = useMemo(() => {
    if (visibleAccounts.length === 0) return {} as ApexOptions;
    return {
      chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, animations: { enabled: true, speed: 600 } },
      plotOptions: { bar: { horizontal: true, distributed: true, borderRadius: 4, barHeight: '65%' } },
      colors: visibleAccounts.map(() => iconColorHex('campaigns')),
      xaxis: {
        categories: visibleAccounts.map(([name]) => name),
        labels: { style: { colors: chartTextColor, fontSize: '10px' } },
      },
      yaxis: { labels: { style: { colors: chartTextColor, fontSize: '11px' }, maxWidth: 120 } },
      grid: { borderColor: chartGridColor, strokeDashArray: 4, yaxis: { lines: { show: false } } },
      legend: { show: false },
      dataLabels: { enabled: false },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => `${val} blast${val === 1 ? '' : 's'}` } },
    };
  }, [visibleAccounts, chartTextColor, chartGridColor, isDark]);

  const accountBarSeries = useMemo(
    () => [{ name: 'Blasts', data: visibleAccounts.map(([, count]) => count) }],
    [visibleAccounts],
  );

  // Campaigns over time column chart
  const columnChartOptions: ApexOptions = useMemo(() => {
    if (!analytics || !analytics.monthBuckets.some(b => b.count > 0)) return {} as ApexOptions;
    return {
      chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, animations: { enabled: true, speed: 600 } },
      plotOptions: { bar: { borderRadius: 3, columnWidth: '70%', distributed: true } },
      colors: analytics.monthBuckets.map(() => iconColorHex('campaigns')),
      xaxis: {
        categories: analytics.monthBuckets.map(b => b.label),
        labels: { style: { colors: chartTextColor, fontSize: '9px' } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: { style: { colors: chartTextColor, fontSize: '10px' } },
        min: 0,
        forceNiceScale: true,
      },
      grid: { borderColor: chartGridColor, strokeDashArray: 4, xaxis: { lines: { show: false } } },
      legend: { show: false },
      dataLabels: { enabled: false },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => `${val} blast${val === 1 ? '' : 's'}` } },
    };
  }, [analytics, chartTextColor, chartGridColor, isDark]);

  const columnChartSeries = useMemo(
    () => [{ name: 'Blasts', data: analytics?.monthBuckets.map(b => b.count) ?? [] }],
    [analytics],
  );

  // ── Render ──

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="glass-card rounded-xl p-4 animate-pulse">
              <div className="w-5 h-5 bg-[var(--muted)] rounded mb-2" />
              <div className="w-12 h-6 bg-[var(--muted)] rounded mb-1" />
              <div className="w-20 h-3 bg-[var(--muted)] rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="text-center py-8 border border-dashed border-[var(--border)] rounded-xl">
        <PaperAirplaneIcon className="w-8 h-8 text-[var(--muted-foreground)] mx-auto mb-2" />
        <p className="text-sm text-[var(--muted-foreground)]">{emptyTitle}</p>
        <p className="text-xs text-[var(--muted-foreground)] mt-1">
          {emptySubtitle}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatCard
          icon={PaperAirplaneIcon}
          value={campaigns.length}
          label="Total Blasts"
          color="text-blue-400"
          bgColor="bg-blue-500/10"
          delay={0}
          animated={animated}
        />
        <StatCard
          icon={CheckCircleIcon}
          value={analytics.sentCount}
          label="Sent"
          color="text-green-400"
          bgColor="bg-green-500/10"
          delay={1}
          animated={animated}
        />
        <StatCard
          icon={ClockIcon}
          value={analytics.scheduledCount}
          label="Scheduled"
          color="text-blue-400"
          bgColor="bg-blue-500/10"
          delay={2}
          animated={animated}
        />
        <StatCard
          icon={DocumentTextIcon}
          value={analytics.draftCount}
          label="In Progress"
          color="text-zinc-400"
          bgColor="bg-zinc-500/10"
          delay={3}
          animated={animated}
        />
        <StatCard
          icon={FlowIcon}
          value={workflows.length}
          label="Workflows"
          color="text-orange-400"
          bgColor="bg-orange-500/10"
          delay={4}
          animated={animated}
        />
      </div>

      {/* Campaigns vs Workflows timeline */}
      {timelineData.hasData && (
        <div className="glass-card rounded-xl p-4 animate-fade-in-up animate-stagger-2">
          <h4 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            Blasts vs Workflows Over Time
          </h4>
          <div className="h-[280px]">
            <ReactApexChart
              type="area"
              height={280}
              options={timelineChartOptions}
              series={timelineData.series}
            />
          </div>
        </div>
      )}

      {/* Charts grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* Status Distribution */}
        {analytics.statusEntries.length > 0 && (
          <div className="glass-card rounded-xl p-4 animate-fade-in-up animate-stagger-1">
            <h4 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              Blast Status
            </h4>
            <ReactApexChart type="donut" height={180} options={statusDonutOptions} series={statusDonutSeries} />
          </div>
        )}

        {/* Blasts per Account */}
        {showAccountBreakdown && visibleAccounts.length > 0 && (
          <div className="glass-card rounded-xl p-4 animate-fade-in-up animate-stagger-2">
            <h4 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              Blasts by Account
            </h4>
            <ReactApexChart type="bar" height={Math.max(visibleAccounts.length * 36, 120)} options={accountBarOptions} series={accountBarSeries} />
            {analytics.hasMoreAccounts && (
              <button
                type="button"
                onClick={() => setShowAllAccounts((prev) => !prev)}
                className="mt-2.5 text-[10px] font-medium text-[var(--primary)] hover:underline"
              >
                {showAllAccounts ? 'Show less' : `Show all ${analytics.byAccountAll.length} accounts`}
              </button>
            )}
          </div>
        )}

        {/* Blasts Over Time */}
        {analytics.monthBuckets.some(b => b.count > 0) && (
          <div className="glass-card rounded-xl p-4 animate-fade-in-up animate-stagger-3">
            <h4 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              Blasts Over Time
            </h4>
            <ReactApexChart type="bar" height={160} options={columnChartOptions} series={columnChartSeries} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──

function StatCard({
  icon: Icon, value, label, sub, color, bgColor, delay, animated,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number | string; label: string; sub?: string;
  color: string; bgColor: string; delay: number; animated: boolean;
}) {
  return (
    <div className={`glass-card rounded-xl p-4 animate-fade-in-up animate-stagger-${delay + 1}`} style={{ opacity: animated ? 1 : 0 }}>
      <div className={`w-8 h-8 rounded-lg ${bgColor} flex items-center justify-center mb-2`}>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5">{sub}</p>}
    </div>
  );
}

