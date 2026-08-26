'use client';

/**
 * Per-LP analytics view — rendered as a tab on the LP detail page.
 *
 * Layout:
 *  - Range pills (7d / 28d / 90d)
 *  - Four stat cards (views, uniques, conversions, conversion rate)
 *  - Daily views/conversions bar chart (CSS bars, no library)
 *  - Scroll-depth funnel (25/50/75/100)
 *  - Top UTM sources + top referrers + top CTAs tables (3-col)
 *  - Recent leads table
 *
 * Charts are pure CSS/SVG — matches the rest of the app's chart
 * style and keeps the bundle slim. The tradeoff vs. a chart library
 * is no hover tooltips on the bar chart; we expose exact numbers
 * in the per-day grid label instead.
 */
import * as React from 'react';
import useSWR from 'swr';
import {
  ArrowTrendingUpIcon,
  ChartBarIcon,
  CursorArrowRaysIcon,
  EyeIcon,
  GlobeAltIcon,
  InboxIcon,
  TagIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import type { LpAnalyticsSummary, AnalyticsRange } from '@/lib/services/lp-analytics';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

const RANGES: { value: AnalyticsRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '28d', label: '28 days' },
  { value: '90d', label: '90 days' },
];

export function LandingPageAnalytics({ pageId }: { pageId: string }) {
  const [range, setRange] = React.useState<AnalyticsRange>('28d');
  const { data, isLoading, error } = useSWR<{ analytics: LpAnalyticsSummary }>(
    `/api/landing-pages/${pageId}/analytics?range=${range}`,
    fetcher,
    { revalidateOnFocus: false },
  );

  return (
    <div className="space-y-6">
      <RangeBar range={range} onChange={setRange} />

      {error ? (
        <ErrorPanel />
      ) : isLoading || !data ? (
        <LoadingPanel />
      ) : (
        <Body analytics={data.analytics} />
      )}
    </div>
  );
}

// ── Header range pills ─────────────────────────────────────────────

function RangeBar({
  range,
  onChange,
}: {
  range: AnalyticsRange;
  onChange: (r: AnalyticsRange) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="text-sm text-[var(--muted-foreground)]">
        Visitor activity, conversions, and traffic sources for this page.
      </div>
      <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 gap-0.5">
        {RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => onChange(r.value)}
            aria-pressed={range === r.value}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded transition-colors ${
              range === r.value
                ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Body ───────────────────────────────────────────────────────────

function Body({ analytics }: { analytics: LpAnalyticsSummary }) {
  const { totals, byDay, scrollFunnel, topUtmSources, topReferrers, topCtas, recentSubmissions } =
    analytics;

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<EyeIcon className="w-4 h-4" />}
          label="Total views"
          value={formatInt(totals.views)}
          tone="indigo"
        />
        <StatCard
          icon={<UsersIcon className="w-4 h-4" />}
          label="Unique visitors"
          value={formatInt(totals.uniqueVisitors)}
          tone="emerald"
        />
        <StatCard
          icon={<InboxIcon className="w-4 h-4" />}
          label="Conversions"
          value={formatInt(totals.conversions)}
          sub="form submissions"
          tone="violet"
        />
        <StatCard
          icon={<ArrowTrendingUpIcon className="w-4 h-4" />}
          label="Conversion rate"
          value={
            totals.conversionRatePct == null ? '—' : `${totals.conversionRatePct.toFixed(1)}%`
          }
          sub={totals.views === 0 ? 'No views yet' : `${totals.conversions} / ${totals.views}`}
          tone="amber"
        />
      </div>

      {/* Daily chart */}
      <Panel
        icon={<ChartBarIcon className="w-4 h-4" />}
        title="Daily activity"
        subtitle="Bars are page views; the line tracks conversions."
      >
        <DailyChart byDay={byDay} />
      </Panel>

      {/* Scroll funnel + top sources side-by-side on wide screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          icon={<ArrowTrendingUpIcon className="w-4 h-4" />}
          title="Scroll depth"
          subtitle="Sessions reaching each milestone in this range."
        >
          <ScrollFunnel
            funnel={scrollFunnel}
            totalSessions={Math.max(scrollFunnel.reached25, totals.uniqueVisitors)}
          />
        </Panel>
        <Panel
          icon={<TagIcon className="w-4 h-4" />}
          title="Top UTM sources"
          subtitle="By page-view volume."
        >
          {topUtmSources.length === 0 ? (
            <EmptyHint text="No tagged traffic yet." />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-[var(--muted-foreground)] tracking-wider">
                <tr>
                  <th className="text-left py-1.5 font-medium">Source</th>
                  <th className="text-left py-1.5 font-medium">Medium</th>
                  <th className="text-left py-1.5 font-medium">Campaign</th>
                  <th className="text-right py-1.5 font-medium">Views</th>
                </tr>
              </thead>
              <tbody>
                {topUtmSources.map((row, i) => (
                  <tr key={i} className="border-t border-[var(--border)]">
                    <td className="py-1.5 font-medium truncate max-w-[120px]">{row.source}</td>
                    <td className="py-1.5 text-[var(--muted-foreground)] truncate max-w-[120px]">
                      {row.medium ?? '—'}
                    </td>
                    <td className="py-1.5 text-[var(--muted-foreground)] truncate max-w-[180px]">
                      {row.campaign ?? '—'}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{formatInt(row.views)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      {/* Referrers + CTAs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          icon={<GlobeAltIcon className="w-4 h-4" />}
          title="Top referrers"
          subtitle="Where untagged traffic came from."
        >
          {topReferrers.length === 0 ? (
            <EmptyHint text="No referrer data yet." />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {topReferrers.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span
                    className="truncate max-w-[80%] text-[var(--foreground)]"
                    title={r.referrer}
                  >
                    {prettyReferrer(r.referrer)}
                  </span>
                  <span className="tabular-nums text-[var(--muted-foreground)]">
                    {formatInt(r.views)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          icon={<CursorArrowRaysIcon className="w-4 h-4" />}
          title="Top CTA clicks"
          subtitle={
            <>
              From elements tagged{' '}
              <code className="font-mono text-[11px]">data-loomi-track=&quot;cta&quot;</code>.
            </>
          }
        >
          {topCtas.length === 0 ? (
            <EmptyHint text="No CTA clicks recorded yet." />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {topCtas.map((c, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[var(--foreground)]">
                      {c.label || '(no label)'}
                    </span>
                    {c.href && (
                      <span
                        className="block truncate text-[11px] text-[var(--muted-foreground)] font-mono"
                        title={c.href}
                      >
                        {c.href}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums text-[var(--muted-foreground)]">
                    {formatInt(c.clicks)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Recent submissions */}
      <Panel
        icon={<InboxIcon className="w-4 h-4" />}
        title="Recent leads"
        subtitle="Latest form submissions attributed to this page."
      >
        {recentSubmissions.length === 0 ? (
          <EmptyHint text="No submissions in this range." />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase text-[var(--muted-foreground)] tracking-wider">
              <tr>
                <th className="text-left py-1.5 font-medium">When</th>
                <th className="text-left py-1.5 font-medium">Contact</th>
                <th className="text-left py-1.5 font-medium">Form</th>
                <th className="text-left py-1.5 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {recentSubmissions.map((s) => (
                <tr key={s.id} className="border-t border-[var(--border)]">
                  <td className="py-1.5 text-[var(--muted-foreground)] whitespace-nowrap">
                    {formatRelativeTime(s.createdAt)}
                  </td>
                  <td className="py-1.5 min-w-0">
                    <div className="font-medium truncate max-w-[200px]">
                      {s.contactName ?? s.contactEmail ?? '(anonymous)'}
                    </div>
                    {s.contactName && s.contactEmail && (
                      <div className="text-[11px] text-[var(--muted-foreground)] truncate max-w-[200px]">
                        {s.contactEmail}
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 text-[var(--muted-foreground)] truncate max-w-[160px]">
                    {s.formName ?? '—'}
                  </td>
                  <td className="py-1.5 text-[var(--muted-foreground)] truncate max-w-[160px]">
                    {s.utmSource
                      ? `${s.utmSource}${s.utmCampaign ? ` · ${s.utmCampaign}` : ''}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

// ── Stat card ──────────────────────────────────────────────────────

const TONE_CLASSES = {
  indigo: 'bg-indigo-500/15 text-indigo-300',
  emerald: 'bg-emerald-500/15 text-emerald-300',
  violet: 'bg-violet-500/15 text-violet-300',
  amber: 'bg-amber-500/15 text-amber-300',
} as const;

function StatCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone: keyof typeof TONE_CLASSES;
}) {
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center justify-center w-7 h-7 rounded-lg ${TONE_CLASSES[tone]}`}
        >
          {icon}
        </span>
        <span className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
          {label}
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{sub}</p>}
    </div>
  );
}

// ── Panel wrapper ──────────────────────────────────────────────────

function Panel({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-card rounded-2xl p-4">
      <div className="flex items-start gap-2 mb-3">
        <span className="text-[var(--muted-foreground)] mt-0.5">{icon}</span>
        <div>
          <h3 className="text-sm font-semibold leading-tight">{title}</h3>
          {subtitle && (
            <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

// ── Daily chart (CSS bars) ─────────────────────────────────────────

function DailyChart({ byDay }: { byDay: LpAnalyticsSummary['byDay'] }) {
  const maxViews = Math.max(1, ...byDay.map((d) => d.views));
  const maxConv = Math.max(1, ...byDay.map((d) => d.conversions));
  // Sample ~8 evenly-spaced ticks for the x-axis label row so the
  // chart stays readable at any range length.
  const tickEvery = Math.max(1, Math.ceil(byDay.length / 8));

  return (
    <div className="overflow-x-auto">
      <div className="min-w-full" style={{ minWidth: `${byDay.length * 14}px` }}>
        <div className="flex items-end gap-1 h-48 px-1" aria-hidden="true">
          {byDay.map((d, i) => {
            const viewsPct = (d.views / maxViews) * 100;
            const convPct = (d.conversions / maxConv) * 100;
            return (
              <div key={d.date} className="flex-1 min-w-[8px] flex flex-col items-center group">
                <div className="relative w-full h-full flex items-end">
                  <div
                    className="absolute inset-x-0 bottom-0 bg-[var(--primary)]/70 rounded-sm transition-all group-hover:bg-[var(--primary)]"
                    style={{ height: `${viewsPct}%` }}
                    title={`${d.date}: ${d.views} views, ${d.conversions} conversions`}
                  />
                  {d.conversions > 0 && (
                    <div
                      className="absolute inset-x-0 bottom-0 bg-emerald-400/80 rounded-sm"
                      style={{ height: `${(convPct / 100) * viewsPct}%` }}
                    />
                  )}
                </div>
                {i % tickEvery === 0 && (
                  <span className="mt-1 text-[9px] text-[var(--muted-foreground)] whitespace-nowrap">
                    {formatDayTick(d.date)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-4 mt-3 text-[11px] text-[var(--muted-foreground)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-[var(--primary)]/70" />
          Views
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400/80" />
          Conversions
        </span>
      </div>
    </div>
  );
}

// ── Scroll funnel ──────────────────────────────────────────────────

function ScrollFunnel({
  funnel,
  totalSessions,
}: {
  funnel: LpAnalyticsSummary['scrollFunnel'];
  totalSessions: number;
}) {
  const rows = [
    { label: '25% reached', value: funnel.reached25 },
    { label: '50% reached', value: funnel.reached50 },
    { label: '75% reached', value: funnel.reached75 },
    { label: '100% reached', value: funnel.reached100 },
  ];
  const max = Math.max(totalSessions, 1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const pct = (r.value / max) * 100;
        return (
          <li key={r.label}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[var(--foreground)]">{r.label}</span>
              <span className="tabular-nums text-[var(--muted-foreground)]">
                {formatInt(r.value)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-[var(--muted)] overflow-hidden">
              <div
                className="h-full bg-[var(--primary)]/70 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── States ─────────────────────────────────────────────────────────

function LoadingPanel() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="glass-card rounded-2xl p-4 animate-pulse h-[88px]" />
        ))}
      </div>
      <div className="glass-card rounded-2xl p-4 animate-pulse h-56" />
    </div>
  );
}

function ErrorPanel() {
  return (
    <div className="glass-card rounded-2xl p-6 text-center text-sm text-[var(--muted-foreground)]">
      Could not load analytics. Try refreshing the page.
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <p className="text-xs text-[var(--muted-foreground)] py-4 text-center">{text}</p>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function formatInt(n: number): string {
  return n.toLocaleString();
}

function formatDayTick(date: string): string {
  // YYYY-MM-DD → "Jun 12"
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function prettyReferrer(raw: string): string {
  // Show the host only — full URLs are noisy and we don't want the
  // visitor's query strings (which may carry tracking junk) leaking
  // into the analytics view.
  try {
    const url = new URL(raw);
    return url.host || raw;
  } catch {
    return raw;
  }
}
