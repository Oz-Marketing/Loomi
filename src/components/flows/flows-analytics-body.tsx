'use client';

/**
 * Flow analytics body — KPIs + per-flow performance table + status
 * breakdown. Reusable across surfaces: the studio `/flows/analytics`
 * page and the `/reporting/engagement` reporting page both render this
 * component.
 *
 * Self-fetches from `/api/flows/analytics`. Pass `presetAccountKey` to
 * scope to one account; pass `null` for an admin view across all
 * accounts. `showPageHeader` controls whether the "Flow Analytics"
 * sticky title renders (turn off when embedding inside another page
 * that supplies its own chrome).
 */
import { useMemo } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useAccount } from '@/contexts/account-context';
import { AccountAvatar } from '@/components/account-avatar';
import {
  PaperAirplaneIcon,
  EnvelopeOpenIcon,
  CursorArrowRaysIcon,
  PlayIcon,
  CheckCircleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { FlowIcon } from '@/components/icon-map';

// ── Types matching /api/flows/analytics ──

interface FlowAnalyticsRow {
  id: string;
  name: string;
  status: string;
  accountKey: string;
  publishedAt: string;
  archivedAt: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  active: number;
  completed: number;
  exited: number;
  failed: number;
  totalSends: number;
  totalOpens: number;
  totalClicks: number;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  return res.json();
};

// ── Helpers ── (matches the campaigns engagement-section helpers so
// the two analytics surfaces format numbers identically)

function pct(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  return `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
}

function num(value: number): string {
  return value.toLocaleString();
}

function shortDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function FlowsAnalyticsBody({
  scopeKey,
  subtitle,
  showAccountColumn,
  presetAccountKey,
  showPageHeader = true,
}: {
  scopeKey: string;
  subtitle: string;
  showAccountColumn: boolean;
  presetAccountKey: string | null;
  /** When false, omit the "Flow Analytics" sticky page header — used
   *  when this body is embedded inside another page (e.g. /reporting/engagement)
   *  that provides its own chrome. */
  showPageHeader?: boolean;
}) {
  const { accounts } = useAccount();
  const query = presetAccountKey
    ? `?accountKey=${encodeURIComponent(presetAccountKey)}`
    : '';
  const { data, error, isLoading } = useSWR<{ flows: FlowAnalyticsRow[] }>(
    `/api/flows/analytics${query}`,
    fetcher,
  );

  const accountMeta = useMemo(() => {
    const map: Record<
      string,
      {
        dealer: string;
        logos?: { light?: string; dark?: string; white?: string; black?: string };
      }
    > = {};
    for (const [key, account] of Object.entries(accounts)) {
      map[key] = { dealer: account.dealer, logos: account.logos };
    }
    return map;
  }, [accounts]);

  const flows = data?.flows ?? [];

  // ── Aggregated totals across all flows in scope ──
  const totals = useMemo(() => {
    const t = {
      flowCount: flows.length,
      activeFlows: 0,
      pausedFlows: 0,
      draftFlows: 0,
      archivedFlows: 0,
      activeEnrollments: 0,
      completedEnrollments: 0,
      exitedEnrollments: 0,
      failedEnrollments: 0,
      sent: 0,
      uniqueOpens: 0,
      uniqueClicks: 0,
    };
    for (const f of flows) {
      if (f.status === 'active') t.activeFlows += 1;
      else if (f.status === 'paused') t.pausedFlows += 1;
      else if (f.status === 'draft') t.draftFlows += 1;
      else if (f.status === 'archived') t.archivedFlows += 1;
      t.activeEnrollments += f.active;
      t.completedEnrollments += f.completed;
      t.exitedEnrollments += f.exited;
      t.failedEnrollments += f.failed;
      t.sent += f.totalSends;
      t.uniqueOpens += f.totalOpens;
      t.uniqueClicks += f.totalClicks;
    }
    return t;
  }, [flows]);

  const openRate = totals.sent > 0 ? totals.uniqueOpens / totals.sent : 0;
  const clickRate = totals.sent > 0 ? totals.uniqueClicks / totals.sent : 0;
  const completionRate =
    totals.activeEnrollments + totals.completedEnrollments > 0
      ? totals.completedEnrollments /
        (totals.activeEnrollments + totals.completedEnrollments)
      : 0;

  // ── Per-flow rows sorted by send volume ──
  const sortedFlows = useMemo(() => {
    return [...flows].sort((a, b) => b.totalSends - a.totalSends);
  }, [flows]);

  if (isLoading) {
    return (
      <div className="glass-section-card rounded-2xl p-6 border border-[var(--border)] animate-pulse">
        <div className="h-5 w-40 bg-[var(--muted)] rounded mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-20 bg-[var(--muted)] rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-section-card rounded-2xl p-6 border border-red-500/20">
        <p className="text-sm font-semibold text-[var(--foreground)]">
          Couldn&apos;t load flow analytics
        </p>
        <p className="text-xs text-[var(--muted-foreground)] mt-1">
          {error.message}
        </p>
      </div>
    );
  }

  return (
    <div key={scopeKey}>
      {/* Sticky header — matches the campaigns/analytics chrome. Hidden
          when this body is embedded in another page that supplies its
          own header (see `showPageHeader` prop). */}
      {showPageHeader && (
        <div className="page-sticky-header mb-8">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <FlowIcon className="w-7 h-7 text-[var(--primary)]" />
              <div>
                <h2 className="text-2xl font-bold">Flow Analytics</h2>
                <p className="text-[var(--muted-foreground)] text-sm mt-0.5">
                  {subtitle}
                  <span className="ml-1 tabular-nums">
                    · {totals.flowCount} flow{totals.flowCount === 1 ? '' : 's'}
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-5">
        {/* ── KPI cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            icon={PlayIcon}
            label="Active flows"
            primary={num(totals.activeFlows)}
            secondary={`${num(totals.flowCount)} total`}
            tone="primary"
          />
          <KpiCard
            icon={ClockIcon}
            label="In-flight"
            primary={num(totals.activeEnrollments)}
            secondary="enrollments"
            tone="sky"
          />
          <KpiCard
            icon={CheckCircleIcon}
            label="Completed"
            primary={num(totals.completedEnrollments)}
            secondary={pct(completionRate)}
            tone="emerald"
          />
          <KpiCard
            icon={PaperAirplaneIcon}
            label="Sent"
            primary={num(totals.sent)}
            tone="violet"
          />
          <KpiCard
            icon={EnvelopeOpenIcon}
            label="Open rate"
            primary={pct(openRate)}
            secondary={`${num(totals.uniqueOpens)} unique`}
            tone="amber"
          />
          <KpiCard
            icon={CursorArrowRaysIcon}
            label="Click rate"
            primary={pct(clickRate)}
            secondary={`${num(totals.uniqueClicks)} unique`}
            tone="zinc"
          />
        </div>

        {/* ── Per-flow table + status breakdown (two-column) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(280px,360px)] gap-5 items-start">
          <div className="glass-section-card rounded-2xl border border-[var(--border)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">
                Flow performance
              </h3>
              <p className="text-[11px] text-[var(--muted-foreground)]">
                {sortedFlows.length} flow{sortedFlows.length === 1 ? '' : 's'}
              </p>
            </div>
            {sortedFlows.length === 0 ? (
              <p className="px-5 py-6 text-xs text-[var(--muted-foreground)]">
                No flows in this view yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr className="bg-[var(--muted)] border-b border-[var(--border)]">
                      <th className="text-left px-4 py-2 text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                        Flow
                      </th>
                      {showAccountColumn && (
                        <th className="text-left px-3 py-2 text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                          Sub-Account
                        </th>
                      )}
                      <th className="text-right px-3 py-2 text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                        Enrolled
                      </th>
                      <th className="text-right px-3 py-2 text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                        Sent
                      </th>
                      <th className="text-right px-3 py-2 text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                        Open
                      </th>
                      <th className="text-right px-3 py-2 text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider">
                        Click
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFlows.slice(0, 25).map((f) => {
                      const meta = f.accountKey ? accountMeta[f.accountKey] : null;
                      const open = f.totalSends > 0 ? f.totalOpens / f.totalSends : 0;
                      const click = f.totalSends > 0 ? f.totalClicks / f.totalSends : 0;
                      return (
                        <tr
                          key={f.id}
                          className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/40 transition-colors"
                        >
                          <td className="px-4 py-2.5 align-middle min-w-0">
                            <Link
                              href={`/flows/${f.id}`}
                              className="block text-sm font-medium truncate text-[var(--foreground)] hover:text-[var(--primary)] transition-colors"
                            >
                              {f.name || '(Untitled flow)'}
                            </Link>
                            <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5 uppercase tracking-wider">
                              {f.status}
                              {f.publishedAt && (
                                <>
                                  <span className="mx-1 opacity-50">·</span>
                                  published {shortDate(f.publishedAt)}
                                </>
                              )}
                            </p>
                          </td>
                          {showAccountColumn && (
                            <td className="px-3 py-2.5 align-middle max-w-[180px]">
                              {meta ? (
                                <div className="flex items-center gap-2 min-w-0">
                                  <AccountAvatar
                                    name={meta.dealer}
                                    logos={meta.logos}
                                    size={20}
                                    className="flex-shrink-0"
                                  />
                                  <span className="text-xs text-[var(--muted-foreground)] truncate">
                                    {meta.dealer}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-[var(--muted-foreground)]">
                                  —
                                </span>
                              )}
                            </td>
                          )}
                          <td className="px-3 py-2.5 align-middle text-right text-xs tabular-nums">
                            <span className="font-medium text-[var(--foreground)]">
                              {num(f.active)}
                            </span>
                            {f.completed > 0 && (
                              <span className="block text-[10px] text-[var(--muted-foreground)]">
                                {num(f.completed)} done
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 align-middle text-right text-xs tabular-nums">
                            {num(f.totalSends)}
                          </td>
                          <td className="px-3 py-2.5 align-middle text-right text-xs tabular-nums">
                            {f.totalSends > 0 ? (
                              <>
                                <span className="font-medium text-[var(--foreground)]">
                                  {pct(open)}
                                </span>
                                <span className="block text-[10px] text-[var(--muted-foreground)]">
                                  {num(f.totalOpens)}
                                </span>
                              </>
                            ) : (
                              <span className="text-[var(--muted-foreground)]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 align-middle text-right text-xs tabular-nums">
                            {f.totalSends > 0 ? (
                              <>
                                <span className="font-medium text-[var(--foreground)]">
                                  {pct(click)}
                                </span>
                                <span className="block text-[10px] text-[var(--muted-foreground)]">
                                  {num(f.totalClicks)}
                                </span>
                              </>
                            ) : (
                              <span className="text-[var(--muted-foreground)]">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="glass-section-card rounded-2xl p-5 border border-[var(--border)]">
            <div className="flex items-center gap-2 mb-3">
              <FlowIcon className="w-4 h-4 text-[var(--muted-foreground)]" />
              <h3 className="text-sm font-semibold text-[var(--foreground)]">
                Status breakdown
              </h3>
            </div>
            {totals.flowCount === 0 ? (
              <p className="text-xs text-[var(--muted-foreground)]">
                No flows yet.
              </p>
            ) : (
              <ul className="space-y-2">
                <StatusBreakdownRow
                  label="Active"
                  count={totals.activeFlows}
                  total={totals.flowCount}
                  tone="emerald"
                />
                <StatusBreakdownRow
                  label="Paused"
                  count={totals.pausedFlows}
                  total={totals.flowCount}
                  tone="amber"
                />
                <StatusBreakdownRow
                  label="Draft"
                  count={totals.draftFlows}
                  total={totals.flowCount}
                  tone="zinc"
                />
                <StatusBreakdownRow
                  label="Archived"
                  count={totals.archivedFlows}
                  total={totals.flowCount}
                  tone="rose"
                />
              </ul>
            )}

            {totals.exitedEnrollments + totals.failedEnrollments > 0 && (
              <div className="mt-4 pt-3 border-t border-[var(--border)]">
                <h4 className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wider mb-2">
                  Enrollment exits
                </h4>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--muted-foreground)]">Exited</span>
                  <span className="font-medium tabular-nums">
                    {num(totals.exitedEnrollments)}
                  </span>
                </div>
                {totals.failedEnrollments > 0 && (
                  <div className="flex items-center justify-between text-xs mt-1.5">
                    <span className="text-red-400">Failed</span>
                    <span className="font-medium text-red-400 tabular-nums">
                      {num(totals.failedEnrollments)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── KPI card (lifted from campaigns engagement-section so both
//    analytics surfaces speak the same visual language) ──

const TONE_CLASSES: Record<string, { bg: string; text: string }> = {
  primary: { bg: 'bg-[var(--primary)]/10', text: 'text-[var(--primary)]' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  sky:     { bg: 'bg-sky-500/10',     text: 'text-sky-400' },
  violet:  { bg: 'bg-violet-500/10',  text: 'text-violet-400' },
  amber:   { bg: 'bg-amber-500/10',   text: 'text-amber-400' },
  zinc:    { bg: 'bg-zinc-500/10',    text: 'text-zinc-400' },
  rose:    { bg: 'bg-rose-500/10',    text: 'text-rose-400' },
};

function KpiCard({
  icon: Icon,
  label,
  primary,
  secondary,
  tone,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  primary: string;
  secondary?: string;
  tone: keyof typeof TONE_CLASSES;
}) {
  const t = TONE_CLASSES[tone];
  return (
    <div className="glass-section-card rounded-xl p-4 border border-[var(--border)]">
      <div className="flex items-center gap-2 mb-2">
        <div
          className={`w-7 h-7 rounded-md ${t.bg} ${t.text} flex items-center justify-center`}
        >
          <Icon className="w-3.5 h-3.5" />
        </div>
        <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
          {label}
        </p>
      </div>
      <p className="text-xl font-bold tabular-nums">{primary}</p>
      {secondary && (
        <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 tabular-nums">
          {secondary}
        </p>
      )}
    </div>
  );
}

function StatusBreakdownRow({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: keyof typeof TONE_CLASSES;
}) {
  const t = TONE_CLASSES[tone];
  const pctValue = total > 0 ? (count / total) * 100 : 0;
  return (
    <li>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-[var(--muted-foreground)]">{label}</span>
        <span className="tabular-nums">
          <span className="font-medium text-[var(--foreground)]">{count}</span>
          <span className="text-[10px] text-[var(--muted-foreground)] ml-1">
            {Math.round(pctValue)}%
          </span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--muted)] overflow-hidden">
        <div
          className={`h-full rounded-full ${t.bg.replace('/10', '/60')}`}
          style={{ width: `${Math.max(pctValue, count > 0 ? 4 : 0)}%` }}
        />
      </div>
    </li>
  );
}
