'use client';

import { useMemo, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from '@/contexts/theme-context';
import {
  MegaphoneIcon,
  PaperAirplaneIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { FlowIcon } from '@/components/icon-map';
import { iconColorHex } from '@/lib/icon-colors';
import type { ApexOptions } from 'apexcharts';

const ReactApexChart = dynamic(() => import('react-apexcharts'), { ssr: false });

// ── Types ──

interface Campaign {
  id: string;
  name: string;
  status: string;
  accountKey?: string;
  dealer?: string;
}

interface Workflow {
  id: string;
  name: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  accountKey?: string;
  dealer?: string;
}

interface CampaignAnalyticsProps {
  campaigns: Campaign[];
  workflows: Workflow[];
  loading?: boolean;
  showAccountBreakdown?: boolean;
  accountNames?: Record<string, string>;
}

// ── Helpers ──

const CAMPAIGN_STATUS_COLORS: Record<string, string> = {
  sent:        '#60a5fa',
  completed:   '#60a5fa',
  delivered:   '#60a5fa',
  scheduled:   '#3b82f6',
  in_progress: '#93c5fd',
  draft:       '#bfdbfe',
  paused:      '#1d4ed8',
  archived:    '#94a3b8',
};

const WORKFLOW_STATUS_COLORS: Record<string, string> = {
  active:   '#fb923c',
  inactive: '#fdba74',
  draft:    '#fed7aa',
};

function getCampaignStatusColor(status: string): string {
  return CAMPAIGN_STATUS_COLORS[status.toLowerCase()] || '#71717a';
}

function getWorkflowStatusColor(status: string): string {
  return WORKFLOW_STATUS_COLORS[status.toLowerCase()] || '#71717a';
}

function campaignStatusLabel(status: string): string {
  const normalized = status.toLowerCase().trim();
  if (normalized === 'draft') return 'In Progress';
  return normalized
    .replace(/[_\s]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function accountKeyForRecord(record: { accountKey?: string }): string | null {
  return record.accountKey || null;
}

// ── Component ──

export function BlastAnalytics({
  campaigns,
  workflows,
  loading,
  showAccountBreakdown,
  accountNames,
}: CampaignAnalyticsProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    if ((campaigns.length > 0 || workflows.length > 0) && !loading) {
      const timer = setTimeout(() => setAnimated(true), 100);
      return () => clearTimeout(timer);
    }
  }, [campaigns.length, workflows.length, loading]);

  const analytics = useMemo(() => {
    if (campaigns.length === 0 && workflows.length === 0) return null;

    // Campaign status counts
    const campaignStatuses = new Map<string, number>();
    campaigns.forEach(c => {
      const s = c.status.toLowerCase();
      campaignStatuses.set(s, (campaignStatuses.get(s) || 0) + 1);
    });
    const campaignStatusEntries = [...campaignStatuses.entries()].sort((a, b) => b[1] - a[1]);

    // Workflow status counts
    const workflowStatuses = new Map<string, number>();
    workflows.forEach(w => {
      const s = w.status.toLowerCase();
      workflowStatuses.set(s, (workflowStatuses.get(s) || 0) + 1);
    });
    const workflowStatusEntries = [...workflowStatuses.entries()].sort((a, b) => b[1] - a[1]);

    // Per-account campaign breakdown
    let campaignsByAccount: [string, number][] = [];
    let maxCampaignAccount = 0;
    if (showAccountBreakdown) {
      const acctCounts = new Map<string, number>();
      campaigns.forEach(c => {
        const accountKey = accountKeyForRecord(c);
        const name = (accountKey && accountNames?.[accountKey]) || c.dealer || accountKey || 'Unknown';
        acctCounts.set(name, (acctCounts.get(name) || 0) + 1);
      });
      campaignsByAccount = [...acctCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      maxCampaignAccount = campaignsByAccount.length > 0 ? campaignsByAccount[0][1] : 0;
    }

    // Per-account workflow breakdown
    let workflowsByAccount: [string, number][] = [];
    let maxWorkflowAccount = 0;
    if (showAccountBreakdown) {
      const acctCounts = new Map<string, number>();
      workflows.forEach(w => {
        const accountKey = accountKeyForRecord(w);
        const name = (accountKey && accountNames?.[accountKey]) || w.dealer || accountKey || 'Unknown';
        acctCounts.set(name, (acctCounts.get(name) || 0) + 1);
      });
      workflowsByAccount = [...acctCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      maxWorkflowAccount = workflowsByAccount.length > 0 ? workflowsByAccount[0][1] : 0;
    }

    // Campaign headline stats
    const sentCount = campaigns.filter(c =>
      ['sent', 'completed', 'delivered'].includes(c.status.toLowerCase())
    ).length;
    const scheduledCount = campaigns.filter(c =>
      ['scheduled', 'in_progress'].includes(c.status.toLowerCase())
    ).length;

    // Workflow headline stats
    const activeWorkflows = workflows.filter(w => w.status.toLowerCase() === 'active').length;

    return {
      campaignStatusEntries,
      workflowStatusEntries,
      campaignsByAccount,
      maxCampaignAccount,
      workflowsByAccount,
      maxWorkflowAccount,
      sentCount,
      scheduledCount,
      activeWorkflows,
    };
  }, [campaigns, workflows, showAccountBreakdown, accountNames]);

  // ── Chart config ──

  const chartTextColor = isDark ? '#a1a1aa' : '#71717a';
  const chartGridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  // Campaign status donut
  const campaignDonutOptions: ApexOptions = useMemo(() => {
    if (!analytics || analytics.campaignStatusEntries.length === 0) return {} as ApexOptions;
    return {
      chart: { type: 'donut', background: 'transparent', animations: { enabled: true, speed: 600, easing: 'easeinout' } },
      colors: analytics.campaignStatusEntries.map(([status]) => getCampaignStatusColor(status)),
      labels: analytics.campaignStatusEntries.map(([status]) => campaignStatusLabel(status)),
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
              total: { show: true, label: 'campaigns', fontSize: '10px', color: chartTextColor, formatter: () => String(campaigns.length) },
            },
          },
        },
      },
      dataLabels: { enabled: false },
      stroke: { show: false },
      tooltip: { theme: isDark ? 'dark' : 'light' },
    };
  }, [analytics, chartTextColor, isDark, campaigns.length]);

  const campaignDonutSeries = useMemo(
    () => analytics?.campaignStatusEntries.map(([, count]) => count) ?? [],
    [analytics],
  );

  // Workflow status donut
  const workflowDonutOptions: ApexOptions = useMemo(() => {
    if (!analytics || analytics.workflowStatusEntries.length === 0) return {} as ApexOptions;
    return {
      chart: { type: 'donut', background: 'transparent', animations: { enabled: true, speed: 600, easing: 'easeinout' } },
      colors: analytics.workflowStatusEntries.map(([status]) => getWorkflowStatusColor(status)),
      labels: analytics.workflowStatusEntries.map(([status]) => status.charAt(0).toUpperCase() + status.slice(1)),
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
              total: { show: true, label: 'workflows', fontSize: '10px', color: chartTextColor, formatter: () => String(workflows.length) },
            },
          },
        },
      },
      dataLabels: { enabled: false },
      stroke: { show: false },
      tooltip: { theme: isDark ? 'dark' : 'light' },
    };
  }, [analytics, chartTextColor, isDark, workflows.length]);

  const workflowDonutSeries = useMemo(
    () => analytics?.workflowStatusEntries.map(([, count]) => count) ?? [],
    [analytics],
  );

  // Campaigns by account horizontal bar
  const campaignBarOptions: ApexOptions = useMemo(() => {
    if (!analytics || analytics.campaignsByAccount.length === 0) return {} as ApexOptions;
    return {
      chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, animations: { enabled: true, speed: 600 } },
      plotOptions: { bar: { horizontal: true, distributed: true, borderRadius: 4, barHeight: '65%' } },
      colors: analytics.campaignsByAccount.map(() => iconColorHex('campaigns')),
      xaxis: {
        categories: analytics.campaignsByAccount.map(([name]) => name),
        labels: { style: { colors: chartTextColor, fontSize: '10px' } },
      },
      yaxis: { labels: { style: { colors: chartTextColor, fontSize: '11px' }, maxWidth: 120 } },
      grid: { borderColor: chartGridColor, strokeDashArray: 4, yaxis: { lines: { show: false } } },
      legend: { show: false },
      dataLabels: { enabled: false },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => `${val} campaign${val === 1 ? '' : 's'}` } },
    };
  }, [analytics, chartTextColor, chartGridColor, isDark]);

  const campaignBarSeries = useMemo(
    () => [{ name: 'Blasts', data: analytics?.campaignsByAccount.map(([, count]) => count) ?? [] }],
    [analytics],
  );

  // Workflows by account horizontal bar
  const workflowBarOptions: ApexOptions = useMemo(() => {
    if (!analytics || analytics.workflowsByAccount.length === 0) return {} as ApexOptions;
    return {
      chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, animations: { enabled: true, speed: 600 } },
      plotOptions: { bar: { horizontal: true, distributed: true, borderRadius: 4, barHeight: '65%' } },
      colors: analytics.workflowsByAccount.map(() => iconColorHex('flows')),
      xaxis: {
        categories: analytics.workflowsByAccount.map(([name]) => name),
        labels: { style: { colors: chartTextColor, fontSize: '10px' } },
      },
      yaxis: { labels: { style: { colors: chartTextColor, fontSize: '11px' }, maxWidth: 120 } },
      grid: { borderColor: chartGridColor, strokeDashArray: 4, yaxis: { lines: { show: false } } },
      legend: { show: false },
      dataLabels: { enabled: false },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => `${val} workflow${val === 1 ? '' : 's'}` } },
    };
  }, [analytics, chartTextColor, chartGridColor, isDark]);

  const workflowBarSeries = useMemo(
    () => [{ name: 'Workflows', data: analytics?.workflowsByAccount.map(([, count]) => count) ?? [] }],
    [analytics],
  );

  // ── Render ──

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
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
        <MegaphoneIcon className="w-8 h-8 text-[var(--muted-foreground)] mx-auto mb-2" />
        <p className="text-sm text-[var(--muted-foreground)]">No blast or workflow data yet</p>
        <p className="text-xs text-[var(--muted-foreground)] mt-1">
          Accounts may need to reconnect their ESP integration with campaign/workflow scopes
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={MegaphoneIcon}
          value={campaigns.length}
          label="Total Blasts"
          color="text-blue-400"
          bgColor="bg-blue-500/10"
          delay={0}
          animated={animated}
        />
        <StatCard
          icon={PaperAirplaneIcon}
          value={analytics.sentCount}
          label="Sent / Completed"
          color="text-blue-400"
          bgColor="bg-blue-500/10"
          delay={1}
          animated={animated}
        />
        <StatCard
          icon={ClockIcon}
          value={analytics.scheduledCount}
          label="Scheduled / Active"
          color="text-cyan-400"
          bgColor="bg-cyan-500/10"
          delay={2}
          animated={animated}
        />
        <StatCard
          icon={FlowIcon}
          value={workflows.length}
          label="Total Workflows"
          sub={`${analytics.activeWorkflows} active`}
          color="text-orange-400"
          bgColor="bg-orange-500/10"
          delay={3}
          animated={animated}
        />
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Blast Status Distribution */}
        {analytics.campaignStatusEntries.length > 0 && (
          <div className="glass-card rounded-xl p-4 animate-fade-in-up animate-stagger-1">
            <h4 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              Blast Status
            </h4>
            <ReactApexChart type="donut" height={180} options={campaignDonutOptions} series={campaignDonutSeries} />
          </div>
        )}

        {/* Workflow Status Distribution */}
        {analytics.workflowStatusEntries.length > 0 && (
          <div className="glass-card rounded-xl p-4 animate-fade-in-up animate-stagger-2">
            <h4 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-orange-400" />
              Workflow Status
            </h4>
            <ReactApexChart type="donut" height={180} options={workflowDonutOptions} series={workflowDonutSeries} />
          </div>
        )}

        {/* Blasts per Account */}
        {showAccountBreakdown && analytics.campaignsByAccount.length > 0 && (
          <div className="glass-card rounded-xl p-4 animate-fade-in-up animate-stagger-3">
            <h4 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              Blasts by Account
            </h4>
            <ReactApexChart type="bar" height={Math.max(analytics.campaignsByAccount.length * 36, 120)} options={campaignBarOptions} series={campaignBarSeries} />
          </div>
        )}

        {/* Workflows per Account */}
        {showAccountBreakdown && analytics.workflowsByAccount.length > 0 && (
          <div className="glass-card rounded-xl p-4 animate-fade-in-up animate-stagger-4">
            <h4 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-orange-400" />
              Workflows by Account
            </h4>
            <ReactApexChart type="bar" height={Math.max(analytics.workflowsByAccount.length * 36, 120)} options={workflowBarOptions} series={workflowBarSeries} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──

function StatCard({
  icon: Icon,
  value,
  label,
  sub,
  color,
  bgColor,
  delay,
  animated,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number | string;
  label: string;
  sub?: string;
  color: string;
  bgColor: string;
  delay: number;
  animated: boolean;
}) {
  return (
    <div
      className={`glass-card rounded-xl p-4 animate-fade-in-up animate-stagger-${delay + 1}`}
      style={{ opacity: animated ? 1 : 0 }}
    >
      <div className={`w-8 h-8 rounded-lg ${bgColor} flex items-center justify-center mb-2`}>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5">{sub}</p>}
    </div>
  );
}
