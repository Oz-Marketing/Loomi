'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AdjustmentsHorizontalIcon,
  BanknotesIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { AccountAvatar } from '@/components/account-avatar';
import { BUDGET_CHANNELS, channelLabel, isPacedChannel } from '@/lib/budget/channels';
import { ChannelIcon } from '@/components/icons/channel-icon';
import { periodOf } from '@/lib/budget/period';
import { useProjectOptions } from './use-project-options';
import { jsonFetcher } from './fetcher';
import { BudgetLineDrawer } from './budget-line-drawer';
import { BudgetPlanModal } from './budget-plan-modal';
import { StatusPill } from './budget-status-pill';
import {
  MONTH_ABBR,
  SOURCE_LABEL,
  compactMoney as compact,
  monthIndexOf,
  usd0,
  usd2,
  type BudgetLine,
  type BudgetPlan as Plan,
  type BudgetSummary as Summary,
} from './budget-shared';

export function BudgetHub({ initialAccountKey }: { initialAccountKey: string | null }) {
  const options = useProjectOptions();
  const [accountKey, setAccountKey] = useState(initialAccountKey ?? '');
  const [year, setYear] = useState(() => new Date().getFullYear());

  const [summary, setSummary] = useState<Summary | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [planOpen, setPlanOpen] = useState(false);
  // The cell (channel × period) whose lines are being inspected, or 'pool'.
  const [openCell, setOpenCell] = useState<{ channel: string; period: string } | null>(null);
  const [poolOpen, setPoolOpen] = useState(false);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);

  // Once an account has any budget selected, default the picker to it so the
  // page isn't an empty prompt on every visit.
  useEffect(() => {
    if (!accountKey && options?.accounts.length) setAccountKey(options.accounts[0]!.key);
  }, [options, accountKey]);

  const reload = useCallback(async () => {
    if (!accountKey) return;
    setLoading(true);
    setLoadError(false);
    try {
      const q = `accountKey=${encodeURIComponent(accountKey)}&year=${year}`;
      const [s, p, l] = await Promise.all([
        jsonFetcher(`/api/budget/summary?${q}`),
        jsonFetcher(`/api/budget/plan?${q}`),
        jsonFetcher(`/api/budget/lines?${q}`),
      ]);
      setSummary(s.summary);
      setPlan(p.plan);
      setLines(l.lines);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [accountKey, year]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ── Derived grid ──
  // Only channels with money are shown by default; the full registry is behind
  // "add a line", so an account running Meta + radio isn't an 11-row table of
  // mostly dashes.
  const activeLines = useMemo(() => lines.filter((l) => l.status !== 'canceled'), [lines]);
  const placed = useMemo(() => activeLines.filter((l) => !l.isPool), [activeLines]);
  const poolLines = useMemo(() => activeLines.filter((l) => l.isPool), [activeLines]);

  const grid = useMemo(() => {
    const byChannel = new Map<string, number[]>();
    for (const l of placed) {
      if (!l.channel || !l.period) continue;
      const m = monthIndexOf(l.period);
      if (m < 0) continue;
      const row = byChannel.get(l.channel) ?? Array(12).fill(0);
      row[m] += l.amount;
      byChannel.set(l.channel, row);
    }
    // Registry order, so Digital sits above Traditional consistently rather
    // than in whatever order money happened to be entered.
    return BUDGET_CHANNELS.filter((c) => byChannel.has(c.key)).map((c) => ({
      channel: c.key,
      label: c.label,
      category: c.category,
      months: byChannel.get(c.key)!,
      total: byChannel.get(c.key)!.reduce((a, b) => a + b, 0),
    }));
  }, [placed]);

  const monthTotals = useMemo(() => {
    const t = Array(12).fill(0);
    for (const row of grid) row.months.forEach((v, i) => (t[i] += v));
    return t;
  }, [grid]);

  const cellLines = useMemo(() => {
    if (!openCell) return [];
    return placed.filter((l) => l.channel === openCell.channel && l.period === openCell.period);
  }, [openCell, placed]);

  const accountOptions = useMemo(
    () => (options?.accounts ?? []).map((a) => ({ value: a.key, label: a.dealer })),
    [options],
  );
  const account = options?.accounts.find((a) => a.key === accountKey) ?? null;

  const yearOptions = useMemo(() => {
    const now = new Date().getFullYear();
    return [now - 1, now, now + 1].map((y) => ({ value: String(y), label: String(y) }));
  }, []);

  // ── Mutations ──

  async function savePlan(body: Record<string, unknown>, generate = false) {
    try {
      const res = await fetch(`/api/budget/plan${generate ? '?generate=true' : ''}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountKey, year, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not save the plan');
      if (generate) {
        const n = data?.generated?.length ?? 0;
        toast.success(
          n > 0
            ? `Created ${n} retainer month${n === 1 ? '' : 's'}`
            : 'Every month already has a retainer line',
        );
      } else {
        toast.success('Budget plan saved');
      }
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the plan');
    }
  }

  async function addLine(body: Record<string, unknown>) {
    try {
      const res = await fetch('/api/budget/lines', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountKey, year, status: 'committed', ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not add the line');
      toast.success('Budget line added');
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add the line');
    }
  }

  if (!options) {
    return <p className="py-10 text-sm text-[var(--muted-foreground)]">Loading…</p>;
  }

  return (
    <div className="py-6">
      {/* ── Identity + controls ──
          The account is the subject of this page, so it leads: a real-size
          logo and the dealer name, with Budget/year as the context line. The
          pickers and Plan sit opposite as controls, not as page identity. */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          {account ? (
            <AccountAvatar
              name={account.dealer}
              accountKey={account.key}
              logos={account.logos}
              size={44}
              aspect="auto"
              maxWidth={200}
              logoInsetClassName="p-0"
              className="flex-shrink-0 rounded-lg"
            />
          ) : (
            <div className="h-[44px] w-[44px] flex-shrink-0 rounded-lg bg-[var(--muted)]" />
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-[var(--foreground)]">
              {account?.dealer ?? 'Select an account'}
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <span>Budget · {year}</span>
              {summary?.overAllocated && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600">
                  <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                  Over-allocated
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="min-w-[200px]">
            <SearchableSelect
              value={accountKey}
              onChange={setAccountKey}
              options={accountOptions}
              placeholder="Select account"
              className="!bg-[var(--input)] !rounded-lg !px-3 !py-2 !text-sm"
            />
          </div>
          <div className="w-[96px]">
            <SearchableSelect
              value={String(year)}
              onChange={(v) => setYear(Number(v))}
              searchable={false}
              options={yearOptions}
              className="!bg-[var(--input)] !rounded-lg !px-3 !py-2 !text-sm"
            />
          </div>
          <button
            type="button"
            disabled={!accountKey}
            onClick={() => setPlanOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)] disabled:opacity-50"
          >
            <AdjustmentsHorizontalIcon className="h-4 w-4" />
            Plan
          </button>
        </div>
      </div>

      {loadError ? (
        <div className="mt-6 rounded-2xl border border-dashed border-[var(--border)] py-16 text-center">
          <p className="text-sm text-[var(--foreground)]">Couldn&apos;t load this account&apos;s budget.</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="mt-3 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground)] transition hover:bg-[var(--muted)]"
          >
            Retry
          </button>
        </div>
      ) : !summary ? (
        <p className="mt-10 text-sm text-[var(--muted-foreground)]">Loading…</p>
      ) : (
        <>
          {/* ── Stat cards ──
              Four peers, each its own card. The sub-line under each number is
              where the relationship between them lives, so the row reads as a
              sentence rather than four unrelated figures. */}
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Planned for the year"
              value={summary.declaredTotal}
              empty="Not set"
              sub={
                summary.declaredTotal == null
                  ? 'Add one in Plan to track against'
                  : summary.monthlyRetainer
                    ? `${usd0(summary.monthlyRetainer)}/mo Managed Marketing Service`
                    : 'What the client signed up for'
              }
            />
            <StatCard
              label="Committed"
              value={summary.totalCommitted}
              tone={summary.overAllocated ? 'warn' : undefined}
              sub={
                summary.declaredTotal
                  ? summary.overAllocated
                    ? `Scheduled + pool · ${usd0(Math.abs(summary.unplanned ?? 0))} over plan`
                    : `Scheduled + pool · ${Math.round((summary.totalCommitted / summary.declaredTotal) * 100)}% of plan`
                  : 'Scheduled + pool'
              }
            />
            <StatCard
              label="Scheduled"
              value={summary.allocated}
              sub={
                grid.length > 0
                  ? `Placed across ${grid.length} channel${grid.length === 1 ? '' : 's'}`
                  : 'Nothing placed yet'
              }
            />
            <StatCard
              label="Unassigned pool"
              value={summary.pool}
              tone={summary.pool > 0 ? 'accent' : undefined}
              sub={
                summary.pool > 0
                  ? 'Committed, no channel or month yet'
                  : 'Everything is placed'
              }
            />
          </div>

          {/* Progress strip — relates the four numbers above. Only meaningful
              once there's a declared total to measure against. */}
          {summary.declaredTotal != null && (
            <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <ProgressBar
                declared={summary.declaredTotal}
                allocated={summary.allocated}
                pool={summary.pool}
              />
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--muted-foreground)]">
                <LegendDot className={summary.overAllocated ? 'bg-amber-500' : 'bg-[var(--primary)]'}>
                  Scheduled {usd0(summary.allocated)}
                </LegendDot>
                <LegendDot
                  className={summary.overAllocated ? 'bg-amber-500/50' : 'bg-[var(--primary)]/40'}
                >
                  Pool {usd0(summary.pool)}
                </LegendDot>
                <LegendDot
                  className={
                    summary.unplanned != null && summary.unplanned < 0
                      ? 'bg-amber-600'
                      : 'bg-[var(--border)]'
                  }
                >
                  {summary.unplanned != null && summary.unplanned >= 0 ? (
                    <>Uncommitted {usd0(summary.unplanned)}</>
                  ) : (
                    <span className="font-medium text-amber-600">
                      {usd0(Math.abs(summary.unplanned ?? 0))} beyond plan
                    </span>
                  )}
                </LegendDot>
              </div>
            </div>
          )}

          {/* ── Channel × month grid ── */}
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">By channel &amp; month</h2>
              <AddLineButton year={year} onAdd={addLine} />
            </div>

            {grid.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border)] py-14 text-center">
                <BanknotesIcon className="mx-auto h-9 w-9 text-[var(--muted-foreground)]" />
                <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
                  Nothing scheduled for {year}
                </p>
                <p className="mx-auto mt-1 max-w-md text-sm text-[var(--muted-foreground)]">
                  Set a monthly Managed Marketing Service amount in Plan to lay out the year, or
                  add a one-off line. Budget also lands here on its own when a rep files a funded
                  ticket.
                </p>
                <button
                  type="button"
                  onClick={() => setPlanOpen(true)}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground)] transition hover:bg-[var(--muted)]"
                >
                  <AdjustmentsHorizontalIcon className="h-4 w-4" />
                  Open Plan
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--card)]">
                <table className="w-full min-w-[820px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)]">
                        Channel
                      </th>
                      {MONTH_ABBR.map((m) => (
                        <th
                          key={m}
                          className="px-1.5 py-2.5 text-right text-xs font-medium text-[var(--muted-foreground)]"
                        >
                          {m}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-right text-xs font-medium text-[var(--muted-foreground)]">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {grid.map((row) => (
                      <tr key={row.channel} className="border-b border-[var(--border)] last:border-0">
                        <td className="whitespace-nowrap px-3 py-2">
                          <span className="inline-flex items-center gap-2">
                            <ChannelIcon
                              channel={row.channel}
                              className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]"
                            />
                            <span className="text-[var(--foreground)]">{row.label}</span>
                            {isPacedChannel(row.channel) && (
                              <span
                                className="text-[10px] text-[var(--muted-foreground)]"
                                title="Feeds the Ad Pacer when the month is budget-managed"
                              >
                                ↗
                              </span>
                            )}
                          </span>
                        </td>
                        {row.months.map((v, i) => {
                          const period = periodOf(year, i + 1);
                          const isOpen =
                            openCell?.channel === row.channel && openCell?.period === period;
                          return (
                            <td key={i} className="px-1.5 py-2 text-right tabular-nums">
                              {v === 0 ? (
                                <span className="text-[var(--muted-foreground)]">—</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setOpenCell(isOpen ? null : { channel: row.channel, period })
                                  }
                                  className={`rounded px-1.5 py-0.5 transition hover:bg-[var(--muted)] ${
                                    isOpen
                                      ? 'bg-[var(--muted)] font-semibold text-[var(--foreground)]'
                                      : 'text-[var(--foreground)]'
                                  }`}
                                >
                                  {compact(v)}
                                </button>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-[var(--foreground)]">
                          {compact(row.total)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-[var(--muted)]/40">
                      <td className="px-3 py-2 text-xs font-medium text-[var(--muted-foreground)]">
                        Total
                      </td>
                      {monthTotals.map((v, i) => (
                        <td
                          key={i}
                          className="px-1.5 py-2 text-right text-xs font-semibold tabular-nums text-[var(--foreground)]"
                        >
                          {compact(v)}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-[var(--foreground)]">
                        {compact(summary.allocated)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Lines behind the selected cell */}
            {openCell && (
              <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                    <ChannelIcon
                      channel={openCell.channel}
                      className="h-4 w-4 text-[var(--muted-foreground)]"
                    />
                    {channelLabel(openCell.channel)} ·{' '}
                    {MONTH_ABBR[monthIndexOf(openCell.period)]} {year}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpenCell(null)}
                    className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  >
                    Close
                  </button>
                </div>
                <LineList lines={cellLines} onOpen={setActiveLineId} />
              </div>
            )}
          </div>

          {/* ── Pool ── */}
          <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--card)]">
            <button
              type="button"
              onClick={() => setPoolOpen((o) => !o)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                Unassigned pool
                <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted-foreground)]">
                  {poolLines.length}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className="text-sm font-semibold tabular-nums text-[var(--foreground)]">
                  {usd0(summary.pool)}
                </span>
                {poolOpen ? (
                  <ChevronDownIcon className="h-4 w-4 text-[var(--muted-foreground)]" />
                ) : (
                  <ChevronRightIcon className="h-4 w-4 text-[var(--muted-foreground)]" />
                )}
              </span>
            </button>
            {poolOpen && (
              <div className="border-t border-[var(--border)] p-4">
                {poolLines.length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    Nothing unassigned. Money lands here when a line is released back, or when
                    budget is committed without a channel and month yet.
                  </p>
                ) : (
                  <LineList lines={poolLines} onOpen={setActiveLineId} />
                )}
              </div>
            )}
          </div>

          {loading && (
            <p className="mt-3 text-xs text-[var(--muted-foreground)]">Refreshing…</p>
          )}
        </>
      )}

      {planOpen && accountKey && (
        <BudgetPlanModal
          year={year}
          accountName={account?.dealer ?? accountKey}
          plan={plan}
          onSave={savePlan}
          onClose={() => setPlanOpen(false)}
        />
      )}

      {activeLineId && (
        <BudgetLineDrawer
          lineId={activeLineId}
          year={year}
          onClose={() => setActiveLineId(null)}
          onChanged={() => void reload()}
        />
      )}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

/**
 * One headline figure as its own card. `tone` colors the value only — the label
 * and sub-line stay muted so a warning reads as emphasis on the number, not as
 * the whole card shouting.
 */
function StatCard({
  label,
  value,
  sub,
  empty,
  tone,
}: {
  label: string;
  value: number | null;
  sub?: string;
  empty?: string;
  tone?: 'warn' | 'accent';
}) {
  const valueColor =
    tone === 'warn'
      ? 'text-amber-600'
      : tone === 'accent'
        ? 'text-[var(--primary)]'
        : 'text-[var(--foreground)]';
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3.5">
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums leading-tight ${valueColor}`}>
        {value == null ? (
          <span className="text-lg font-normal text-[var(--muted-foreground)]">
            {empty ?? '—'}
          </span>
        ) : (
          usd0(value)
        )}
      </p>
      {sub && (
        <p className="mt-0.5 truncate text-[11px] text-[var(--muted-foreground)]" title={sub}>
          {sub}
        </p>
      )}
    </div>
  );
}

function LegendDot({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${className}`} />
      {children}
    </span>
  );
}

/**
 * Scheduled vs pooled vs unplanned against the declared total. Over-allocation
 * renders as a full amber bar rather than overflowing the track — the number
 * beneath it carries the magnitude.
 */
function ProgressBar({
  declared,
  allocated,
  pool,
}: {
  declared: number;
  allocated: number;
  pool: number;
}) {
  if (declared <= 0) return null;
  const over = allocated + pool > declared;
  const pct = (n: number) => Math.max(0, Math.min(100, (n / declared) * 100));
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-[var(--muted)]">
      <div
        className={over ? 'bg-amber-500' : 'bg-[var(--primary)]'}
        style={{ width: `${pct(allocated)}%` }}
      />
      <div
        className={over ? 'bg-amber-500/50' : 'bg-[var(--primary)]/40'}
        style={{ width: `${pct(pool)}%` }}
      />
    </div>
  );
}

function LineList({
  lines,
  onOpen,
}: {
  lines: BudgetLine[];
  onOpen: (id: string) => void;
}) {
  if (lines.length === 0) {
    return <p className="text-sm text-[var(--muted-foreground)]">No lines here.</p>;
  }
  return (
    <ul className="divide-y divide-[var(--border)]">
      {lines.map((l) => (
        <li key={l.id}>
          <button
            type="button"
            onClick={() => onOpen(l.id)}
            className="flex w-full items-center gap-3 py-2 text-left transition hover:bg-[var(--muted)]/50"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-[var(--foreground)]">
                {l.label || l.taskTitle || 'Untitled line'}
              </span>
              <span className="block truncate text-[11px] text-[var(--muted-foreground)]">
                {SOURCE_LABEL[l.source] ?? l.source}
                {l.taskTitle && ` · ${l.taskTitle}`}
                {l.isCrossAccount && ` · spends from ${l.spendAccountDealer ?? l.spendAccountKey}`}
              </span>
            </span>
            <span className="flex flex-shrink-0 items-center gap-2">
              <StatusPill status={l.status} />
              <span className="text-sm font-medium tabular-nums text-[var(--foreground)]">
                {usd2(l.amount)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** One-off line entry — channel, month, amount. Everything else takes defaults. */
function AddLineButton({
  year,
  onAdd,
}: {
  year: number;
  onAdd: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState(BUDGET_CHANNELS[0]!.key);
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error('Enter an amount');
      return;
    }
    setSaving(true);
    await onAdd({
      channel,
      period: periodOf(year, Number(month)),
      amount: n,
      label: label.trim() || null,
      source: 'adhoc',
    });
    setSaving(false);
    setOpen(false);
    setAmount('');
    setLabel('');
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--foreground)] transition hover:bg-[var(--muted)]"
      >
        <PlusIcon className="h-3.5 w-3.5" />
        Add a line
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-2">
      <div className="w-[150px]">
        <SearchableSelect
          value={channel}
          onChange={setChannel}
          searchable={false}
          options={BUDGET_CHANNELS.map((c) => ({
            value: c.key,
            label: c.label,
            icon: <ChannelIcon channel={c.key} className="h-4 w-4" />,
          }))}
          className="!bg-[var(--input)] !rounded-lg !px-2.5 !py-1.5 !text-xs"
        />
      </div>
      <div className="w-[110px]">
        <SearchableSelect
          value={month}
          onChange={setMonth}
          searchable={false}
          options={MONTH_ABBR.map((m, i) => ({ value: String(i + 1), label: m }))}
          className="!bg-[var(--input)] !rounded-lg !px-2.5 !py-1.5 !text-xs"
        />
      </div>
      <input
        type="number"
        min="0"
        step="any"
        placeholder="Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="loomi-input w-[110px] !bg-[var(--input)] !py-1.5 !text-xs"
      />
      <input
        type="text"
        placeholder="Label (optional)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="loomi-input w-[160px] !bg-[var(--input)] !py-1.5 !text-xs"
      />
      <button
        type="button"
        disabled={saving}
        onClick={() => void submit()}
        className="rounded-lg bg-[var(--primary)] px-2.5 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Adding…' : 'Add'}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded-lg px-2 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      >
        Cancel
      </button>
    </div>
  );
}

