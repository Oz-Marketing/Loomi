'use client';

// Widget components for the admin / developer portfolio dashboard.
//
// Each widget reads a slice of PortfolioDashboardData (see
// /src/hooks/use-portfolio-dashboard.ts) and renders a self-contained
// card. Widgets are designed to be dropped into DashboardWidgetFrame —
// they do not own their own framing or drag handles.

import { type ReactNode, useMemo } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { ApexOptions } from 'apexcharts';
import {
  ArrowTopRightOnSquareIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  BellAlertIcon,
  BoltIcon,
  BuildingStorefrontIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  CheckCircleIcon,
  ClockIcon,
  CurrencyDollarIcon,
  CursorArrowRaysIcon,
  DevicePhoneMobileIcon,
  EnvelopeIcon,
  EnvelopeOpenIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  FireIcon,
  HandRaisedIcon,
  NoSymbolIcon,
  PaperAirplaneIcon,
  ShieldExclamationIcon,
  TrophyIcon,
  TruckIcon,
  UserGroupIcon,
  UsersIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { AccountAvatar } from '@/components/account-avatar';
import type { AccountData } from '@/contexts/account-context';
import type {
  AccountHealthRow,
  ActivityEntry,
  AnomalyAlert,
  EngagedContactsBreakdown,
  EngagementTimelinePoint,
  LifecycleAlertsResult,
  MetaPacerSummaryRow,
  PipelineCampaign,
  PortfolioKpis,
  RepPerformanceRow,
  SendPipelineResult,
  SuppressionHealthResult,
  TopCampaignRow,
} from '@/hooks/use-portfolio-dashboard';

const ApexChart = dynamic(() => import('react-apexcharts'), { ssr: false });

// ── Shared helpers ─────────────────────────────────────────────

function formatPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

function formatNum(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString();
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'Never';
  const diff = Date.now() - t;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

function classifyHealth(score: number): { tone: 'green' | 'yellow' | 'orange' | 'red' | 'gray'; label: string } {
  if (score >= 80) return { tone: 'green', label: 'Strong' };
  if (score >= 60) return { tone: 'yellow', label: 'Healthy' };
  if (score >= 40) return { tone: 'orange', label: 'Watch' };
  if (score > 0) return { tone: 'red', label: 'Action' };
  return { tone: 'gray', label: 'Idle' };
}

const TONE_RING: Record<'green' | 'yellow' | 'orange' | 'red' | 'gray', string> = {
  green: 'ring-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  yellow: 'ring-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
  orange: 'ring-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  red: 'ring-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  gray: 'ring-slate-500/20 bg-slate-500/10 text-slate-500',
};

function WidgetCard({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="glass-card rounded-2xl p-5 animate-fade-in-up">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

const EMPTY_KPIS: PortfolioKpis = {
  accountsTotal: 0,
  accountsActive: 0,
  contactsTotal: 0,
  contactsAdded: 0,
  emailsSent: 0,
  smsSent: 0,
  emailDelivered: 0,
  emailOpens: 0,
  emailClicks: 0,
  emailBounces: 0,
  emailSpamReports: 0,
  emailUnsubscribes: 0,
  smsDelivered: 0,
  smsFailed: 0,
  smsStops: 0,
  emailDeliveryRate: 0,
  emailOpenRate: 0,
  emailClickRate: 0,
  emailBounceRate: 0,
  emailSpamRate: 0,
  smsDeliveryRate: 0,
  suppressionsAdded: 0,
};

const EMPTY_LIFECYCLE: LifecycleAlertsResult = {
  service: { dueIn30: 0, dueIn60: 0, dueIn90: 0, byAccount: [] },
  lease: { endingIn30: 0, endingIn60: 0, endingIn90: 0, byAccount: [] },
  warranty: { expiringIn30: 0, expiringIn60: 0, expiringIn90: 0, byAccount: [] },
};

const EMPTY_SUPPRESSION: SuppressionHealthResult = {
  emailTotal: 0,
  smsTotal: 0,
  emailAddedInPeriod: 0,
  smsAddedInPeriod: 0,
  emailReasons: [],
  smsReasons: [],
};

// ── Portfolio KPI strip ────────────────────────────────────────

export function PortfolioKpiStrip({
  kpis,
  loading,
}: {
  kpis: PortfolioKpis | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="glass-card animate-pulse rounded-2xl p-5 h-[112px]" />
        ))}
      </div>
    );
  }
  const k = kpis ?? EMPTY_KPIS;
  const bounceTone = k.emailBounceRate >= 0.02 ? 'red' : 'slate';
  const tiles = [
    {
      label: 'Accounts',
      value: `${k.accountsActive.toLocaleString()} / ${k.accountsTotal.toLocaleString()}`,
      sub: `${k.accountsActive.toLocaleString()} active in period`,
      Icon: BuildingStorefrontIcon,
      iconColor: 'text-[var(--primary)]',
      iconBg: 'bg-[var(--primary)]/10',
    },
    {
      label: 'Contacts',
      value: k.contactsTotal.toLocaleString(),
      sub: k.contactsAdded > 0 ? `+${k.contactsAdded.toLocaleString()} added` : 'No new adds in period',
      Icon: UsersIcon,
      iconColor: 'text-blue-500',
      iconBg: 'bg-blue-500/10',
    },
    {
      label: 'Emails Sent',
      value: k.emailsSent.toLocaleString(),
      sub: `Delivery ${formatPct(k.emailDeliveryRate)}`,
      Icon: EnvelopeIcon,
      iconColor: 'text-amber-500',
      iconBg: 'bg-amber-500/10',
    },
    {
      label: 'Open Rate',
      value: formatPct(k.emailOpenRate),
      sub: `${k.emailOpens.toLocaleString()} opens · ${k.emailClicks.toLocaleString()} clicks`,
      Icon: EnvelopeOpenIcon,
      iconColor: 'text-emerald-500',
      iconBg: 'bg-emerald-500/10',
    },
    {
      label: 'Click Rate',
      value: formatPct(k.emailClickRate),
      sub: `Click-to-open ${formatPct(k.emailOpens > 0 ? k.emailClicks / k.emailOpens : 0)}`,
      Icon: CursorArrowRaysIcon,
      iconColor: 'text-fuchsia-500',
      iconBg: 'bg-fuchsia-500/10',
    },
    {
      label: 'Bounce Rate',
      value: formatPct(k.emailBounceRate),
      sub: `${k.emailBounces.toLocaleString()} bounces · ${k.emailSpamReports.toLocaleString()} spam`,
      Icon: ExclamationTriangleIcon,
      iconColor: bounceTone === 'red' ? 'text-red-500' : 'text-slate-500',
      iconBg: bounceTone === 'red' ? 'bg-red-500/10' : 'bg-slate-500/10',
    },
    {
      label: 'SMS Sent',
      value: k.smsSent.toLocaleString(),
      sub: `Delivery ${formatPct(k.smsDeliveryRate)} · ${k.smsStops.toLocaleString()} stops`,
      Icon: DevicePhoneMobileIcon,
      iconColor: 'text-violet-500',
      iconBg: 'bg-violet-500/10',
    },
    {
      label: 'Suppressions',
      value: `+${k.suppressionsAdded.toLocaleString()}`,
      sub: `Bounces + complaints + STOPs`,
      Icon: NoSymbolIcon,
      iconColor: 'text-slate-500',
      iconBg: 'bg-slate-500/10',
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="glass-card rounded-2xl p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{tile.label}</p>
            <span className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${tile.iconBg}`}>
              <tile.Icon className={`h-6 w-6 ${tile.iconColor}`} />
            </span>
          </div>
          <p className="text-2xl font-bold tabular-nums tracking-tight">{tile.value}</p>
          <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{tile.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ── Engagement timeline ────────────────────────────────────────

export function EngagementTimelineWidget({
  timeline,
  loading,
  isDark,
}: {
  timeline: EngagementTimelinePoint[];
  loading: boolean;
  isDark: boolean;
}) {
  const series = useMemo(() => {
    return [
      { name: 'Delivered (email)', data: timeline.map((p) => [new Date(p.date).getTime(), p.emailDelivered]) },
      { name: 'Opens', data: timeline.map((p) => [new Date(p.date).getTime(), p.emailOpens]) },
      { name: 'Clicks', data: timeline.map((p) => [new Date(p.date).getTime(), p.emailClicks]) },
      { name: 'Bounces', data: timeline.map((p) => [new Date(p.date).getTime(), p.emailBounces]) },
      { name: 'SMS Delivered', data: timeline.map((p) => [new Date(p.date).getTime(), p.smsDelivered]) },
    ];
  }, [timeline]);

  const options: ApexOptions = useMemo(() => ({
    chart: {
      type: 'area',
      stacked: false,
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { speed: 350 },
      foreColor: isDark ? '#cbd5e1' : '#334155',
    },
    colors: ['#3b82f6', '#10b981', '#a855f7', '#ef4444', '#f59e0b'],
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2 },
    fill: { type: 'gradient', gradient: { shadeIntensity: 0.6, opacityFrom: 0.18, opacityTo: 0.02 } },
    xaxis: { type: 'datetime', labels: { style: { fontSize: '11px' } } },
    yaxis: { labels: { style: { fontSize: '11px' } } },
    legend: { fontSize: '12px', markers: { size: 6 } },
    grid: { borderColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(100,116,139,0.18)', strokeDashArray: 4 },
    tooltip: { theme: isDark ? 'dark' : 'light', x: { format: 'MMM d' } },
  }), [isDark]);

  return (
    <WidgetCard title="Engagement timeline" icon={<ChartBarIcon className="h-4 w-4 text-[var(--primary)]" />}>
      {loading ? (
        <div className="h-[300px] animate-pulse rounded-xl bg-[var(--muted)]/30" />
      ) : (
        <ApexChart options={options} series={series} type="area" height={300} />
      )}
    </WidgetCard>
  );
}

// ── Account health ──────────────────────────────────────────────

export function AccountHealthScoredGrid({
  rows,
  accounts,
  loading,
}: {
  rows: AccountHealthRow[];
  accounts: Record<string, AccountData>;
  loading: boolean;
}) {
  if (loading) {
    return (
      <WidgetCard title="Account health" icon={<TrophyIcon className="h-4 w-4 text-[var(--primary)]" />}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="glass-card animate-pulse rounded-xl p-4 h-[140px]" />
          ))}
        </div>
      </WidgetCard>
    );
  }
  return (
    <WidgetCard title="Account health" icon={<TrophyIcon className="h-4 w-4 text-[var(--primary)]" />}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => {
          const tone = classifyHealth(row.healthScore);
          const accountMeta = accounts[row.accountKey];
          const slug = accountMeta?.slug;
          const href = slug ? `/subaccount/${slug}/dashboard` : '#';
          return (
            <Link
              key={row.accountKey}
              href={href}
              className="group glass-card relative rounded-xl p-4 transition-all hover:ring-1 hover:ring-[var(--primary)]/30"
            >
              <div className="mb-3 flex items-center gap-3">
                <AccountAvatar
                  name={row.dealer}
                  accountKey={row.accountKey}
                  storefrontImage={accountMeta?.storefrontImage}
                  logos={accountMeta?.logos}
                  size={36}
                  className="h-9 w-9 flex-shrink-0 rounded-lg border border-[var(--border)] object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{row.dealer}</p>
                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    Last sent {formatRelativeTime(row.lastSentAt)}
                  </p>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1 ${TONE_RING[tone.tone]}`}>
                  {tone.label}
                </span>
              </div>

              <div className="mb-2 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-[var(--muted)]/30 px-1 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Contacts</p>
                  <p className="text-sm font-bold tabular-nums">{formatNum(row.contactCount)}</p>
                </div>
                <div className="rounded-md bg-[var(--muted)]/30 px-1 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Sent</p>
                  <p className="text-sm font-bold tabular-nums">{formatNum(row.sentInPeriod)}</p>
                </div>
                <div className="rounded-md bg-[var(--muted)]/30 px-1 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Open %</p>
                  <p className="text-sm font-bold tabular-nums">{row.deliveredInPeriod > 0 ? formatPct(row.openRate, 0) : '—'}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--muted)]/40">
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full ${
                      tone.tone === 'green'
                        ? 'bg-emerald-500'
                        : tone.tone === 'yellow'
                        ? 'bg-yellow-500'
                        : tone.tone === 'orange'
                        ? 'bg-orange-500'
                        : tone.tone === 'red'
                        ? 'bg-red-500'
                        : 'bg-slate-400'
                    }`}
                    style={{ width: `${row.healthScore}%` }}
                  />
                </div>
                <span className="w-8 text-right text-[11px] font-semibold tabular-nums">{row.healthScore}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </WidgetCard>
  );
}

// ── Lifecycle action center ─────────────────────────────────────

export function LifecycleActionCenter({
  lifecycle,
  loading,
  singleAccount = false,
}: {
  lifecycle: LifecycleAlertsResult | null;
  loading: boolean;
  /** When true, suppress the per-account breakdown beneath each card. */
  singleAccount?: boolean;
}) {
  if (loading) {
    return (
      <WidgetCard title="Lifecycle Action Center" icon={<CalendarDaysIcon className="h-4 w-4 text-[var(--primary)]" />}>
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass-card animate-pulse rounded-xl p-4 h-[140px]" />
          ))}
        </div>
      </WidgetCard>
    );
  }
  const lc = lifecycle ?? EMPTY_LIFECYCLE;
  const cards = [
    {
      label: 'Service due',
      Icon: WrenchScrewdriverIcon,
      tone: 'text-amber-600',
      bg: 'bg-amber-500/10',
      ring: 'ring-amber-500/30',
      d30: lc.service.dueIn30,
      d60: lc.service.dueIn60,
      d90: lc.service.dueIn90,
      byAccount: lc.service.byAccount.slice(0, 4).map((r) => ({
        accountKey: r.accountKey,
        dealer: r.dealer,
        next: r.dueIn30,
      })),
      cta: 'Build service blast',
      href: '/messaging/blasts',
    },
    {
      label: 'Lease ending',
      Icon: TruckIcon,
      tone: 'text-blue-600',
      bg: 'bg-blue-500/10',
      ring: 'ring-blue-500/30',
      d30: lc.lease.endingIn30,
      d60: lc.lease.endingIn60,
      d90: lc.lease.endingIn90,
      byAccount: lc.lease.byAccount.slice(0, 4).map((r) => ({
        accountKey: r.accountKey,
        dealer: r.dealer,
        next: r.endingIn30,
      })),
      cta: 'Build lease renewal',
      href: '/messaging/blasts',
    },
    {
      label: 'Warranty expiring',
      Icon: ShieldExclamationIcon,
      tone: 'text-emerald-600',
      bg: 'bg-emerald-500/10',
      ring: 'ring-emerald-500/30',
      d30: lc.warranty.expiringIn30,
      d60: lc.warranty.expiringIn60,
      d90: lc.warranty.expiringIn90,
      byAccount: lc.warranty.byAccount.slice(0, 4).map((r) => ({
        accountKey: r.accountKey,
        dealer: r.dealer,
        next: r.expiringIn30,
      })),
      cta: 'Build extended warranty pitch',
      href: '/messaging/blasts',
    },
  ];

  return (
    <WidgetCard title="Lifecycle Action Center" icon={<CalendarDaysIcon className="h-4 w-4 text-[var(--primary)]" />}>
      <div className="grid gap-3 lg:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className={`relative overflow-hidden rounded-xl ${card.bg} p-4 ring-1 ${card.ring}`}>
            <div className="mb-3 flex items-center gap-2">
              <card.Icon className={`h-5 w-5 ${card.tone}`} />
              <p className="text-xs font-semibold uppercase tracking-wider">{card.label}</p>
            </div>
            <p className={`text-3xl font-bold tabular-nums ${card.tone}`}>{card.d30.toLocaleString()}</p>
            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
              in next 30d · {card.d60.toLocaleString()} by 60d · {card.d90.toLocaleString()} by 90d
            </p>

            {!singleAccount && card.byAccount.length > 0 && (
              <div className="mt-3 space-y-1 border-t border-[var(--border)]/40 pt-2">
                {card.byAccount.map((row) => (
                  <div key={row.accountKey} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate text-[var(--muted-foreground)]">{row.dealer}</span>
                    <span className="font-semibold tabular-nums">{row.next.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}

            <Link
              href={card.href}
              className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline"
            >
              {card.cta}
              <ArrowTopRightOnSquareIcon className="h-3 w-3" />
            </Link>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}

// ── Send pipeline ───────────────────────────────────────────────

export function SendPipelineWidget({
  pipeline,
  loading,
}: {
  pipeline: SendPipelineResult;
  loading: boolean;
}) {
  if (loading) {
    return (
      <WidgetCard title="Send pipeline" icon={<PaperAirplaneIcon className="h-4 w-4 text-[var(--primary)]" />}>
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass-card animate-pulse rounded-xl p-4 h-[160px]" />
          ))}
        </div>
      </WidgetCard>
    );
  }

  return (
    <WidgetCard title="Send pipeline" icon={<PaperAirplaneIcon className="h-4 w-4 text-[var(--primary)]" />}>
      <div className="grid gap-3 sm:grid-cols-3">
        <PipelineColumn
          title="Scheduled"
          tone="blue"
          icon={<ClockIcon className="h-4 w-4" />}
          items={pipeline.scheduled}
          emptyText="None scheduled."
          formatter={(c) => c.scheduledFor ? new Date(c.scheduledFor).toLocaleString() : '—'}
        />
        <PipelineColumn
          title="In flight"
          tone="amber"
          icon={<BoltIcon className="h-4 w-4" />}
          items={pipeline.inFlight}
          emptyText="Nothing sending right now."
          formatter={(c) => `${c.sentCount.toLocaleString()} / ${c.totalRecipients.toLocaleString()} sent`}
        />
        <PipelineColumn
          title="Recently failed"
          tone="red"
          icon={<ExclamationCircleIcon className="h-4 w-4" />}
          items={pipeline.recentlyFailed}
          emptyText="No failed sends in last 7 days."
          formatter={(c) => c.error ? c.error.slice(0, 60) : 'Failed'}
        />
      </div>
    </WidgetCard>
  );
}

function PipelineColumn({
  title,
  tone,
  icon,
  items,
  emptyText,
  formatter,
}: {
  title: string;
  tone: 'blue' | 'amber' | 'red';
  icon: ReactNode;
  items: PipelineCampaign[];
  emptyText: string;
  formatter: (c: PipelineCampaign) => string;
}) {
  const toneClasses = {
    blue: 'text-blue-600 bg-blue-500/10 ring-blue-500/30',
    amber: 'text-amber-600 bg-amber-500/10 ring-amber-500/30',
    red: 'text-red-600 bg-red-500/10 ring-red-500/30',
  };
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/40 p-3">
      <div className={`mb-3 flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wider ring-1 ${toneClasses[tone]}`}>
        <span className="flex items-center gap-1.5">{icon} {title}</span>
        <span className="tabular-nums">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="px-2 py-3 text-center text-[11px] text-[var(--muted-foreground)]">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 6).map((c) => (
            <li key={c.id} className="rounded-md border border-[var(--border)] bg-[var(--background)]/50 p-2.5">
              <div className="mb-1 flex items-start gap-1.5">
                {c.channel === 'sms' ? (
                  <DevicePhoneMobileIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-violet-500" />
                ) : (
                  <EnvelopeIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
                )}
                <p className="line-clamp-2 text-xs font-medium leading-tight">{c.name}</p>
              </div>
              <p className="text-[10px] text-[var(--muted-foreground)] tabular-nums">{formatter(c)}</p>
            </li>
          ))}
          {items.length > 6 && (
            <li className="text-center text-[10px] text-[var(--muted-foreground)]">+ {items.length - 6} more</li>
          )}
        </ul>
      )}
    </div>
  );
}

// ── Anomaly feed ────────────────────────────────────────────────

export function AnomalyFeedWidget({
  anomalies,
  loading,
}: {
  anomalies: AnomalyAlert[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <WidgetCard title="Alerts & anomalies" icon={<BellAlertIcon className="h-4 w-4 text-[var(--primary)]" />}>
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse rounded-xl bg-[var(--muted)]/30 h-[60px]" />
          ))}
        </div>
      </WidgetCard>
    );
  }
  if (anomalies.length === 0) {
    return (
      <WidgetCard title="Alerts & anomalies" icon={<BellAlertIcon className="h-4 w-4 text-[var(--primary)]" />}>
        <div className="flex flex-col items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-8">
          <CheckCircleIcon className="mb-2 h-8 w-8 text-emerald-500" />
          <p className="text-sm font-semibold">All quiet</p>
          <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">No deliverability or activity anomalies detected.</p>
        </div>
      </WidgetCard>
    );
  }

  const severityIcon = (sev: AnomalyAlert['severity']) => {
    if (sev === 'critical') return <FireIcon className="h-4 w-4 text-red-500" />;
    if (sev === 'warning') return <ExclamationTriangleIcon className="h-4 w-4 text-amber-500" />;
    return <BellAlertIcon className="h-4 w-4 text-blue-500" />;
  };
  const severityRing = (sev: AnomalyAlert['severity']) =>
    sev === 'critical' ? 'ring-red-500/30 bg-red-500/5' : sev === 'warning' ? 'ring-amber-500/30 bg-amber-500/5' : 'ring-blue-500/20 bg-blue-500/5';

  return (
    <WidgetCard
      title="Alerts & anomalies"
      icon={<BellAlertIcon className="h-4 w-4 text-[var(--primary)]" />}
      action={<span className="text-[10px] text-[var(--muted-foreground)] tabular-nums">{anomalies.length} active</span>}
    >
      <ul className="space-y-2">
        {anomalies.slice(0, 8).map((alert) => {
          const Body = (
            <div className={`flex items-start gap-2.5 rounded-xl px-3 py-2.5 ring-1 ${severityRing(alert.severity)}`}>
              <div className="mt-0.5 flex-shrink-0">{severityIcon(alert.severity)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-semibold">{alert.title}</p>
                  <p className="flex-shrink-0 text-[10px] text-[var(--muted-foreground)]">{alert.dealer}</p>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--muted-foreground)]">{alert.detail}</p>
              </div>
            </div>
          );
          return (
            <li key={alert.id}>
              {alert.href ? (
                <Link href={alert.href} className="block transition-opacity hover:opacity-90">{Body}</Link>
              ) : Body}
            </li>
          );
        })}
      </ul>
      {anomalies.length > 8 && (
        <p className="mt-2 text-center text-[10px] text-[var(--muted-foreground)]">+ {anomalies.length - 8} more</p>
      )}
    </WidgetCard>
  );
}

// ── Top campaigns ───────────────────────────────────────────────

export function TopCampaignsWidget({
  campaigns,
  loading,
}: {
  campaigns: TopCampaignRow[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <WidgetCard title="Top performing campaigns" icon={<TrophyIcon className="h-4 w-4 text-[var(--primary)]" />}>
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse rounded-xl bg-[var(--muted)]/30 h-[56px]" />
          ))}
        </div>
      </WidgetCard>
    );
  }
  return (
    <WidgetCard title="Top performing campaigns" icon={<TrophyIcon className="h-4 w-4 text-[var(--primary)]" />}>
      <ul className="space-y-2">
        {campaigns.map((c, i) => (
          <li key={c.campaignId} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)]/40 p-3">
            <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${i === 0 ? 'bg-yellow-500/20 text-yellow-600' : i === 1 ? 'bg-slate-400/20 text-slate-500' : i === 2 ? 'bg-orange-500/20 text-orange-600' : 'bg-[var(--muted)]/40 text-[var(--muted-foreground)]'}`}>
              {i + 1}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{c.campaignName}</p>
              <p className="text-[10px] text-[var(--muted-foreground)] tabular-nums">
                {c.sent.toLocaleString()} sent · {c.delivered.toLocaleString()} delivered
              </p>
            </div>
            <div className="grid flex-shrink-0 grid-cols-2 gap-3 text-right">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Open</p>
                <p className="text-xs font-bold tabular-nums">{formatPct(c.openRate, 0)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Click</p>
                <p className="text-xs font-bold tabular-nums">{formatPct(c.clickRate, 1)}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

// ── Engaged contacts ───────────────────────────────────────────

export function EngagedContactsWidget({
  data,
  totalContacts,
  loading,
  singleAccount = false,
}: {
  data: EngagedContactsBreakdown;
  totalContacts: number;
  /** When true, suppress the per-account breakdown beneath the donut. */
  singleAccount?: boolean;
  loading: boolean;
}) {
  if (loading) {
    return (
      <WidgetCard title="Engaged contacts" icon={<HandRaisedIcon className="h-4 w-4 text-[var(--primary)]" />}>
        <div className="h-[200px] animate-pulse rounded-xl bg-[var(--muted)]/30" />
      </WidgetCard>
    );
  }

  const engagementRate = totalContacts > 0 ? data.engagedTotal / totalContacts : 0;
  const dashOffset = 251.2 * (1 - engagementRate);

  return (
    <WidgetCard
      title="Engaged contacts"
      icon={<HandRaisedIcon className="h-4 w-4 text-[var(--primary)]" />}
      action={<span className="text-[10px] text-[var(--muted-foreground)]">last {data.windowDays}d</span>}
    >
      <div className="mb-4 flex items-center gap-4">
        <div className="relative h-24 w-24 flex-shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
            <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="8" className="text-[var(--muted)]/30" />
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              strokeDasharray="251.2"
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              className="text-emerald-500 transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-lg font-bold tabular-nums">{formatPct(engagementRate, 0)}</p>
            <p className="text-[9px] uppercase tracking-wider text-[var(--muted-foreground)]">engaged</p>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-3xl font-bold tabular-nums">{data.engagedTotal.toLocaleString()}</p>
          <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
            opened or clicked email, or replied to SMS in the last {data.windowDays} days
          </p>
        </div>
      </div>

      {!singleAccount && data.engagedByAccount.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">By account</p>
          {data.engagedByAccount.slice(0, 5).map((row) => (
            <div key={row.accountKey} className="flex items-center gap-2 text-[11px]">
              <span className="min-w-0 flex-1 truncate">{row.dealer}</span>
              <span className="tabular-nums text-[var(--muted-foreground)]">{row.engagedCount.toLocaleString()} / {row.totalCount.toLocaleString()}</span>
              <span className="w-10 text-right font-semibold tabular-nums">{formatPct(row.rate, 0)}</span>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

// ── Suppression health ──────────────────────────────────────────

export function SuppressionHealthWidget({
  data,
  loading,
}: {
  data: SuppressionHealthResult | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <WidgetCard title="Suppression health" icon={<NoSymbolIcon className="h-4 w-4 text-[var(--primary)]" />}>
        <div className="h-[140px] animate-pulse rounded-xl bg-[var(--muted)]/30" />
      </WidgetCard>
    );
  }
  const d = data ?? EMPTY_SUPPRESSION;
  const totalAdded = d.emailAddedInPeriod + d.smsAddedInPeriod;

  return (
    <WidgetCard title="Suppression health" icon={<NoSymbolIcon className="h-4 w-4 text-[var(--primary)]" />}>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-[var(--muted)]/30 p-3">
          <div className="mb-1 flex items-center gap-1.5">
            <EnvelopeIcon className="h-3.5 w-3.5 text-amber-500" />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Email</p>
          </div>
          <p className="text-2xl font-bold tabular-nums">{d.emailTotal.toLocaleString()}</p>
          <p className="text-[11px] text-[var(--muted-foreground)]">+{d.emailAddedInPeriod.toLocaleString()} in period</p>
        </div>
        <div className="rounded-xl bg-[var(--muted)]/30 p-3">
          <div className="mb-1 flex items-center gap-1.5">
            <DevicePhoneMobileIcon className="h-3.5 w-3.5 text-violet-500" />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">SMS</p>
          </div>
          <p className="text-2xl font-bold tabular-nums">{d.smsTotal.toLocaleString()}</p>
          <p className="text-[11px] text-[var(--muted-foreground)]">+{d.smsAddedInPeriod.toLocaleString()} in period</p>
        </div>
      </div>

      {totalAdded > 0 && (d.emailReasons.length > 0 || d.smsReasons.length > 0) ? (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Reasons added in period</p>
          <div className="space-y-1.5">
            {[...d.emailReasons.map((r) => ({ ...r, channel: 'email' })), ...d.smsReasons.map((r) => ({ ...r, channel: 'sms' }))]
              .sort((a, b) => b.count - a.count)
              .slice(0, 6)
              .map((row) => {
                const pct = totalAdded > 0 ? row.count / totalAdded : 0;
                return (
                  <div key={`${row.channel}-${row.reason}`} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1.5">
                        {row.channel === 'email' ? (
                          <EnvelopeIcon className="h-3 w-3 text-amber-500" />
                        ) : (
                          <DevicePhoneMobileIcon className="h-3 w-3 text-violet-500" />
                        )}
                        <span className="capitalize">{row.reason.replace('_', ' ')}</span>
                      </span>
                      <span className="tabular-nums">{row.count.toLocaleString()}</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-[var(--muted)]/40">
                      <div className="h-full bg-slate-500 transition-all" style={{ width: `${pct * 100}%` }} />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      ) : null}
    </WidgetCard>
  );
}

// ── Recent activity ─────────────────────────────────────────────

export function RecentActivityWidget({
  activity,
  loading,
}: {
  activity: ActivityEntry[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <WidgetCard title="Recent activity" icon={<ClockIcon className="h-4 w-4 text-[var(--primary)]" />}>
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse rounded-lg bg-[var(--muted)]/30 h-[48px]" />
          ))}
        </div>
      </WidgetCard>
    );
  }
  const iconByKind = {
    'campaign-launched': <PaperAirplaneIcon className="h-4 w-4 text-emerald-500" />,
    'campaign-scheduled': <ClockIcon className="h-4 w-4 text-blue-500" />,
    'campaign-failed': <ExclamationTriangleIcon className="h-4 w-4 text-red-500" />,
    'list-created': <UsersIcon className="h-4 w-4 text-violet-500" />,
    'contact-imported': <UsersIcon className="h-4 w-4 text-blue-500" />,
  } as const;

  return (
    <WidgetCard title="Recent activity" icon={<ClockIcon className="h-4 w-4 text-[var(--primary)]" />}>
      <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1 themed-scrollbar">
        {activity.map((entry) => (
          <li key={entry.id} className="flex items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--card)]/40 p-2.5">
            <div className="mt-0.5 flex-shrink-0">{iconByKind[entry.kind]}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-semibold">{entry.title}</p>
                <p className="flex-shrink-0 text-[10px] text-[var(--muted-foreground)]">{formatRelativeTime(entry.timestamp)}</p>
              </div>
              <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--muted-foreground)]">
                {entry.dealer} · {entry.detail}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

// ── Rep performance (super_admin / developer only) ─────────────

export function RepPerformanceWidget({
  rows,
  loading,
}: {
  rows: RepPerformanceRow[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <WidgetCard title="Rep performance" icon={<UserGroupIcon className="h-4 w-4 text-[var(--primary)]" />}>
        <div className="h-[140px] animate-pulse rounded-xl bg-[var(--muted)]/30" />
      </WidgetCard>
    );
  }
  return (
    <WidgetCard title="Rep performance" icon={<UserGroupIcon className="h-4 w-4 text-[var(--primary)]" />}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              <th className="py-2 pr-2 font-semibold">Rep</th>
              <th className="px-2 py-2 text-right font-semibold">Accts</th>
              <th className="px-2 py-2 text-right font-semibold">Contacts</th>
              <th className="px-2 py-2 text-right font-semibold">Sent</th>
              <th className="px-2 py-2 text-right font-semibold">Open</th>
              <th className="px-2 py-2 text-right font-semibold">Click</th>
              <th className="pl-2 py-2 text-right font-semibold">Health</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tone = classifyHealth(row.averageHealthScore);
              return (
                <tr key={row.repId || 'unassigned'} className="border-b border-[var(--border)]/40">
                  <td className="py-2 pr-2 font-medium">{row.repName}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.accountCount}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.contactCount.toLocaleString()}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.sentInPeriod.toLocaleString()}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.deliveredInPeriod > 0 ? formatPct(row.openRate, 0) : '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.deliveredInPeriod > 0 ? formatPct(row.clickRate, 1) : '—'}</td>
                  <td className="pl-2 py-2 text-right">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${TONE_RING[tone.tone]}`}>
                      {row.averageHealthScore}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </WidgetCard>
  );
}

// ── Meta Ads Pacer summary ──────────────────────────────────────

export function MetaPacerSummaryWidget({
  rows,
  loading,
}: {
  rows: MetaPacerSummaryRow[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <WidgetCard title="Meta Ads Pacer" icon={<CurrencyDollarIcon className="h-4 w-4 text-[var(--primary)]" />}>
        <div className="h-[140px] animate-pulse rounded-xl bg-[var(--muted)]/30" />
      </WidgetCard>
    );
  }
  return (
    <WidgetCard
      title="Meta Ads Pacer"
      icon={<CurrencyDollarIcon className="h-4 w-4 text-[var(--primary)]" />}
      action={
        <Link href="/tools/meta-ads-pacer" className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          Open pacer →
        </Link>
      }
    >
      <ul className="space-y-2">
        {rows.slice(0, 6).map((row) => {
          const pacing = row.pacingPct;
          const onTrack = pacing >= 0.4 && pacing <= 1.1;
          const overspend = pacing > 1.1;
          return (
            <li key={row.accountKey} className="rounded-xl border border-[var(--border)] bg-[var(--card)]/40 p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <Link href="/tools/meta-ads-pacer" className="truncate text-xs font-semibold hover:text-[var(--primary)]">{row.dealer}</Link>
                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${overspend ? 'text-red-600' : onTrack ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {overspend ? <ArrowTrendingUpIcon className="h-3 w-3" /> : <ArrowTrendingDownIcon className="h-3 w-3" />}
                  {formatPct(pacing, 0)}
                </span>
              </div>
              <p className="text-[11px] text-[var(--muted-foreground)] tabular-nums">
                ${row.actualSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })} / ${row.totalBudgetGoal.toLocaleString(undefined, { maximumFractionDigits: 0 })} · {row.adCount} ads
              </p>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--muted)]/40">
                <div
                  className={`h-full transition-all ${overspend ? 'bg-red-500' : onTrack ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  style={{ width: `${Math.min(pacing * 100, 110)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </WidgetCard>
  );
}
