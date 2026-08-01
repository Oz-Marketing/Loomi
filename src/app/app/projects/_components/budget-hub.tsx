'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  DocumentTextIcon,
  BanknotesIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { AccountAvatar } from '@/components/account-avatar';
import {
  BUDGET_CHANNELS,
  LINE_TYPES,
  isPacedChannel,
} from '@/lib/budget/channels';
import { ChannelIcon } from '@/components/icons/channel-icon';
import { Collapse } from '@/components/ui/collapse';
import { periodOf } from '@/lib/budget/period';
import { useAccount } from '@/contexts/account-context';
import { jsonFetcher } from './fetcher';
import { BudgetLineDrawer } from './budget-line-drawer';
import { BudgetAgreementModal } from './budget-agreement-modal';
import { BudgetCategoriseModal } from './budget-categorise-modal';
import { BudgetAddLineModal } from './budget-add-line-modal';
import { StatusPill } from './budget-status-pill';
import {
  LINE_TYPE_COLOR,
  MONTH_ABBR,
  compactMoney as compact,
  monthIndexOf,
  sourceLabel,
  usd0,
  usd2,
  type BudgetLine,
  type BudgetAgreement as Agreement,
  type BudgetSummary as Summary,
} from './budget-shared';

export function BudgetHub() {
  // The account comes from the GLOBAL switcher, not a picker on this page.
  // Two selectors for the same thing is a trap: whichever you didn't touch is
  // silently wrong, and there's no way to tell which one the page is obeying.
  const { accountKey, accountData, initialized } = useAccount();
  const [year, setYear] = useState(() => new Date().getFullYear());

  const [summary, setSummary] = useState<Summary | null>(null);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [agreementsOpen, setAgreementsOpen] = useState(false);
  // The cell (channel × period) whose lines are being inspected, or 'pool'.
  const [openCell, setOpenCell] = useState<{ channel: string; period: string } | null>(null);
  const [closingCell, setClosingCell] = useState(false);
  /** Line-type sections folded shut. Keyed by section, not index, so it
   *  survives a channel appearing or disappearing. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [categoriseOpen, setCategoriseOpen] = useState(false);
  const [poolOpen, setPoolOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accountKey) return;
    setLoading(true);
    setLoadError(false);
    try {
      const q = `accountKey=${encodeURIComponent(accountKey)}&year=${year}`;
      const [s, p, l] = await Promise.all([
        jsonFetcher(`/api/budget/summary?${q}`),
        jsonFetcher(`/api/budget/agreements?${q}`),
        jsonFetcher(`/api/budget/lines?${q}`),
      ]);
      setSummary(s.summary);
      setAgreements(p.agreements ?? []);
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
    // Registry order, so the grid reads the same way every time rather than in
    // whatever order money happened to be entered.
    return BUDGET_CHANNELS.filter((c) => byChannel.has(c.key)).map((c) => ({
      channel: c.key,
      label: c.label,
      category: c.category,
      lineType: c.lineType,
      months: byChannel.get(c.key)!,
      total: byChannel.get(c.key)!.reduce((a, b) => a + b, 0),
    }));
  }, [placed]);

  /**
   * The grid grouped into Media / Services / Fees / Production / Needs
   * categorising. A flat 44-row table mixes a Google buy with a management fee
   * as if they were the same kind of thing — they aren't, and the sections are
   * what make a long grid readable.
   */
  const gridSections = useMemo(
    () =>
      LINE_TYPES.map((t) => ({
        ...t,
        rows: grid.filter((r) => r.lineType === t.key),
      })).filter((sec) => sec.rows.length > 0),
    [grid],
  );

  const monthTotals = useMemo(() => {
    const t = Array(12).fill(0);
    for (const row of grid) row.months.forEach((v, i) => (t[i] += v));
    return t;
  }, [grid]);

  /**
   * Closing is two-stage: flip `closingCell` so the accordion animates shut,
   * then drop the row. Clearing `openCell` outright would unmount the <tr>
   * mid-transition and the panel would just vanish.
   */
  const closeCell = useCallback(() => {
    setClosingCell(true);
    setTimeout(() => {
      setOpenCell(null);
      setClosingCell(false);
    }, 250);
  }, []);

  /**
   * The line-type breakdown, sorted biggest first and carrying each type's
   * share. Sorted rather than left in registry order so the bar reads
   * largest-to-smallest, which is how a proportion is scanned.
   */
  const composition = useMemo(() => {
    const parts = [...(summary?.byLineType ?? [])].sort((a, b) => b.amount - a.amount);
    const total = parts.reduce((t, p) => t + p.amount, 0);
    return {
      total,
      parts: parts.map((p) => ({
        ...p,
        label: LINE_TYPES.find((x) => x.key === p.lineType)?.label ?? p.lineType,
        color: LINE_TYPE_COLOR[p.lineType] ?? 'bg-[var(--muted)]',
        pct: total > 0 ? (p.amount / total) * 100 : 0,
      })),
    };
  }, [summary]);

  /** Money on this account with no line type — what the triage modal fixes. */
  const untypedTotal = useMemo(
    () => summary?.byLineType.find((t) => t.lineType === 'unclassified')?.amount ?? 0,
    [summary],
  );

  const toggleSection = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else {
        next.add(key);
        // An open detail row inside a section being folded away would keep
        // rendering with nothing above it to explain what it belongs to.
        setOpenCell(null);
      }
      return next;
    });
  }, []);

  const cellLines = useMemo(() => {
    if (!openCell) return [];
    return placed.filter((l) => l.channel === openCell.channel && l.period === openCell.period);
  }, [openCell, placed]);

  /**
   * The sub-line under "Committed by Agreement". A term that only partly
   * overlaps the year is the case worth explaining — the card's number is that
   * term's SHARE of the year, and without saying so it looks like the contract
   * value is wrong.
   */
  const agreementSub = useMemo(() => {
    if (agreements.length === 0) return 'Add a contract to track against';
    if (summary?.declaredTotal == null) return 'No total set on the contract';
    const fees = agreements.reduce((t, a) => t + a.monthlyFeeTotal, 0);
    const partial = agreements.filter((a) => a.monthsInYear != null && a.monthsInYear < a.termMonths);
    if (partial.length > 0) {
      return agreements.length === 1
        ? `${partial[0].monthsInYear} of ${partial[0].termMonths} months of the term fall in ${year}`
        : `Pro-rated share of ${agreements.length} contracts`;
    }
    if (fees > 0) return `${usd0(fees)}/mo recurring`;
    return agreements.length === 1 ? 'What the client signed up for' : `Across ${agreements.length} contracts`;
  }, [agreements, summary?.declaredTotal, year]);

  const yearOptions = useMemo(() => {
    const now = new Date().getFullYear();
    return [now - 1, now, now + 1].map((y) => ({ value: String(y), label: String(y) }));
  }, []);

  // ── Mutations ──

  /** Create or update an agreement. Returns whether it stuck, so the modal
   *  knows not to close over an error. */
  async function saveAgreement(body: Record<string, unknown>, id: string | null) {
    try {
      const res = await fetch(id ? `/api/budget/agreements/${id}` : '/api/budget/agreements', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountKey, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not save the contract');
      toast.success(id ? 'Contract saved' : 'Contract created');
      await reload();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the contract');
      return false;
    }
  }

  async function generateFees(id: string) {
    try {
      const res = await fetch(`/api/budget/agreements/${id}?generate=${year}`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not lay out the year');
      const n = data?.generated?.length ?? 0;
      toast.success(
        n > 0
          ? `Created ${n} fee line${n === 1 ? '' : 's'}`
          : 'Every month already has its fee lines',
      );
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not lay out the year');
    }
  }

  async function archiveAgreement(id: string) {
    try {
      const res = await fetch(`/api/budget/agreements/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not archive the contract');
      // Lines keep their money — archiving ends the commitment, it doesn't
      // unwind what's already been budgeted against it.
      toast.success('Contract archived · its budget lines are untouched');
      await reload();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not archive the contract');
      return false;
    }
  }

  /** Book a dated media buy. The server derives the months. */
  async function addFlight(body: Record<string, unknown>) {
    try {
      const res = await fetch('/api/budget/flights', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountKey, status: 'committed', ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not book the flight');
      const n = data?.lines?.length ?? 0;
      toast.success(`Booked ${n} month${n === 1 ? '' : 's'}`);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not book the flight');
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

  // Wait for the switcher to resolve before deciding there's no account —
  // it defaults to admin mode for a tick on first load.
  if (!initialized) {
    return <p className="py-10 text-sm text-[var(--muted-foreground)]">Loading…</p>;
  }

  // Admin / agency view has no single account to show a year for.
  if (!accountKey) {
    return (
      <div className="py-6">
        <h1 className="text-xl font-semibold text-[var(--foreground)]">Budget</h1>
        <div className="mt-6 rounded-2xl border border-dashed border-[var(--border)] py-16 text-center">
          <BanknotesIcon className="mx-auto h-9 w-9 text-[var(--muted-foreground)]" />
          <p className="mt-3 text-sm font-medium text-[var(--foreground)]">Pick an account</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--muted-foreground)]">
            A budget belongs to one client. Choose an account from the switcher at the top of the
            sidebar to see its year.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-6">
      {/* ── Identity + controls ──
          The account is the subject of this page, so it leads: a real-size
          logo and the dealer name, with Budget/year as the context line. The
          pickers and Agreement sit opposite as controls, not page identity. */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <AccountAvatar
            name={accountData?.dealer ?? accountKey}
            accountKey={accountKey}
            logos={accountData?.logos ?? null}
            size={44}
            aspect="auto"
            maxWidth={200}
            logoInsetClassName="p-0"
            className="flex-shrink-0 rounded-lg"
          />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-[var(--foreground)]">
              {accountData?.dealer ?? accountKey}
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
            onClick={() => setAgreementsOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)] disabled:opacity-50"
          >
            <DocumentTextIcon className="h-4 w-4" />
            {agreements.length > 1 ? `Contracts · ${agreements.length}` : 'Contract'}
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
              label="Total budget"
              value={summary.declaredTotal}
              empty="Not set"
              sub={agreementSub}
            />
            <StatCard
              label="Planned"
              value={summary.totalCommitted}
              tone={summary.overAllocated ? 'warn' : undefined}
              sub={
                summary.declaredTotal
                  ? summary.overAllocated
                    ? `Scheduled + pool · ${usd0(Math.abs(summary.unplanned ?? 0))} over plan`
                    : `Scheduled + pool · ${Math.round((summary.totalCommitted / summary.declaredTotal) * 100)}% of budget`
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

          {/* ── The year at a glance ──
              Two questions, one card: how much of the commitment is spoken
              for, and what kind of money it is. They were two cards, which
              put two unlabelled full-width bars back to back and made them
              read as two versions of the same chart. */}
          {(summary.declaredTotal != null || summary.byLineType.length > 1) && (
            <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--card)]">
              {/* Progress — relates the four stat cards above. Only meaningful
                  once there's a commitment to measure against. */}
              {summary.declaredTotal != null && (
                <div className="px-4 py-3.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                      Against the total budget
                    </p>
                    <p className="text-xs tabular-nums text-[var(--muted-foreground)]">
                      {Math.round((summary.totalCommitted / summary.declaredTotal) * 100)}% of{' '}
                      {usd0(summary.declaredTotal)}
                    </p>
                  </div>
                  <div className="mt-3">
                    <ProgressBar
                      declared={summary.declaredTotal}
                      allocated={summary.allocated}
                      pool={summary.pool}
                    />
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-[var(--muted-foreground)]">
                    <LegendDot
                      className={summary.overAllocated ? 'bg-amber-500' : 'bg-[var(--primary)]'}
                    >
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
                          {usd0(Math.abs(summary.unplanned ?? 0))} over budget
                        </span>
                      )}
                    </LegendDot>
                  </div>

                  {/* Base vs added — the OTHER way this money divides, and the
                      one the Ad Pacer actually consumes: base is the client's
                      standing budget, added is everything asked for on top, and
                      they land in the pacer's two separate goal fields. It was
                      computed inside the pacer sync and shown nowhere, so the
                      hub couldn't explain a number the pacer was acting on. */}
                  {summary.totalCommitted > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-[var(--border)] pt-2.5">
                      <span className="text-[11px] text-[var(--muted-foreground)]">
                        Base{' '}
                        <span className="font-medium tabular-nums text-[var(--foreground)]">
                          {usd0(summary.baseTotal)}
                        </span>
                        <span className="ml-1 opacity-60">
                          {Math.round((summary.baseTotal / summary.totalCommitted) * 100)}%
                        </span>
                      </span>
                      <span className="text-[11px] text-[var(--muted-foreground)]">
                        Added{' '}
                        <span className="font-medium tabular-nums text-[var(--foreground)]">
                          {usd0(summary.addedTotal)}
                        </span>
                        <span className="ml-1 opacity-60">
                          {Math.round((summary.addedTotal / summary.totalCommitted) * 100)}%
                        </span>
                      </span>
                      <span className="text-[10px] text-[var(--muted-foreground)] opacity-70">
                        The two goals the Ad Pacer receives on a managed month
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Composition — the thing Oz Reports could never show: how much
                  of this client is media pass-through vs agency revenue. Only
                  when there's more than one kind of money; a media-only account
                  learns nothing from a one-row breakdown. */}
              {summary.byLineType.length > 1 && (
                <div
                  className={`px-4 py-3.5 ${
                    summary.declaredTotal != null ? 'border-t border-[var(--border)]' : ''
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div>
                      <p className="text-sm font-semibold text-[var(--foreground)]">
                        What this client is made of
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                        {usd0(composition.total)} billed ·{' '}
                        <span className="text-[var(--foreground)]">
                          {usd0(summary.knownRevenue)} revenue
                        </span>
                        {summary.uncostedAmount > 0 && (
                          <span className="text-amber-600">
                            {' '}
                            · {usd0(summary.uncostedAmount)} still uncosted
                          </span>
                        )}
                      </p>
                    </div>
                    {/* The way out of "uncosted". Only offered when there IS
                        something untyped — a button that always does nothing
                        teaches people to stop pressing it. */}
                    {untypedTotal > 0 && (
                      <button
                        type="button"
                        onClick={() => setCategoriseOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-600 transition hover:bg-amber-500/20"
                      >
                        <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                        Categorise {usd0(untypedTotal)}
                      </button>
                    )}
                  </div>

                  {/* The composition itself. A row of numbers makes you do the
                      division in your head; the bar IS the answer to "made of". */}
                  <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
                    {composition.parts.map((t) => (
                      <div
                        key={t.lineType}
                        title={`${t.label} · ${usd0(t.amount)} · ${t.pct.toFixed(1)}%`}
                        className={`${t.color} transition-[flex-grow] duration-500`}
                        style={{ flexGrow: t.amount, flexBasis: 0, minWidth: '4px' }}
                      />
                    ))}
                  </div>

                  {/* Legend. Wrapping, with a min width but NOT flex-1 — two
                      kinds of money stretched to half the page each looked
                      like a layout bug, and five in a fixed four-column grid
                      orphaned the last one on a row of its own. */}
                  <div className="mt-3 flex flex-wrap gap-x-10 gap-y-3">
                    {composition.parts.map((t) => (
                      <div key={t.lineType} className="min-w-[132px]">
                        <p className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
                          <span className={`h-2 w-2 flex-shrink-0 rounded-full ${t.color}`} />
                          {t.label}
                          <span className="tabular-nums opacity-60">{Math.round(t.pct)}%</span>
                        </p>
                        <p className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--foreground)]">
                          {usd0(t.amount)}
                        </p>
                        <p className="text-[10px] tabular-nums">
                          {t.costKnown ? (
                            <span className="text-[var(--muted-foreground)]">
                              {usd0(t.revenue)} revenue
                              {t.amount > 0 && (
                                <span className="opacity-60">
                                  {' '}
                                  · {Math.round((t.revenue / t.amount) * 100)}%
                                </span>
                              )}
                            </span>
                          ) : (
                            // Saying "0% margin" would be a lie; saying nothing
                            // hides that a number is missing.
                            <span className="text-amber-600">Cost not entered</span>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Channel × month grid ── */}
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">By channel &amp; month</h2>
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--foreground)] transition hover:bg-[var(--muted)]"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                Add a line
              </button>
            </div>

            {grid.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border)] py-14 text-center">
                <BanknotesIcon className="mx-auto h-9 w-9 text-[var(--muted-foreground)]" />
                <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
                  Nothing scheduled for {year}
                </p>
                <p className="mx-auto mt-1 max-w-md text-sm text-[var(--muted-foreground)]">
                  Add recurring fees to the client&rsquo;s contract and lay out the year, or add a
                  one-off line. Budget also lands here on its own when a rep files a funded ticket.
                </p>
                <button
                  type="button"
                  onClick={() => setAgreementsOpen(true)}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground)] transition hover:bg-[var(--muted)]"
                >
                  <DocumentTextIcon className="h-4 w-4" />
                  {agreements.length > 0 ? 'Open Contract' : 'Add a Contract'}
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
                    {gridSections.map((section) => (
                      <Fragment key={section.key}>
                        {/* Section header — only when there's more than one kind
                            of money, so a media-only account isn't given a
                            header for the sake of it. Doubles as the collapse
                            toggle; a 44-channel account is a long grid and
                            most visits care about one kind of money. */}
                        {gridSections.length > 1 && (
                          <tr
                            className="cursor-pointer border-b border-[var(--border)] bg-[var(--muted)]/25 transition hover:bg-[var(--muted)]/45"
                            onClick={() => toggleSection(section.key)}
                          >
                            <td
                              colSpan={13}
                              className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]"
                            >
                              <span className="inline-flex items-center gap-1.5">
                                <ChevronRightIcon
                                  className={`h-3 w-3 transition-transform duration-200 ${
                                    collapsed.has(section.key) ? '' : 'rotate-90'
                                  }`}
                                />
                                {section.label}
                                <span className="font-normal normal-case tracking-normal opacity-70">
                                  {collapsed.has(section.key)
                                    ? `${section.rows.length} channel${section.rows.length === 1 ? '' : 's'} hidden`
                                    : section.blurb}
                                </span>
                              </span>
                            </td>
                            {/* The section's own total, so collapsing hides
                                detail without hiding money. */}
                            <td className="px-3 py-1.5 text-right text-[11px] font-semibold tabular-nums text-[var(--muted-foreground)]">
                              {compact(section.rows.reduce((t, r) => t + r.total, 0))}
                            </td>
                          </tr>
                        )}
                        {(collapsed.has(section.key) ? [] : section.rows).map((row, rowIndex) => {
                          const openPeriod =
                            openCell?.channel === row.channel ? openCell.period : null;
                          return (
                            <Fragment key={row.channel}>
                      {/* Rows fade in on expand. A table row's height can't be
                          transitioned the way `<Collapse>` does it — a <tr> has
                          no box to grow — so the motion is opacity and offset,
                          staggered so a long section unfolds rather than
                          flashing. */}
                      <tr
                        className={`animate-fade-in-up border-b border-[var(--border)] last:border-0 ${
                          openPeriod ? 'bg-[var(--primary)]/[0.06]' : ''
                        }`}
                        style={{ animationDelay: `${Math.min(rowIndex, 8) * 25}ms` }}
                      >
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
                                    isOpen
                                      ? closeCell()
                                      : setOpenCell({ channel: row.channel, period })
                                  }
                                  className={`rounded-md px-1.5 py-0.5 transition ${
                                    isOpen
                                      ? // Solid primary, not a grey wash. The old
                                        // active state was one muted step off the
                                        // hover state, so on a 12-column grid you
                                        // couldn't tell at a glance which cell the
                                        // list below belonged to.
                                        'bg-[var(--primary)] font-semibold text-white shadow-sm ring-2 ring-[var(--primary)]/30'
                                      : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
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

                      {/* The cell's lines, expanded IN PLACE. They used to
                          render in a panel under the whole table, which put
                          them a scroll away from the number that opened them
                          and left you re-reading the header to remember which
                          cell you'd clicked. */}
                      {openPeriod && (
                        <tr className="border-b border-[var(--border)] last:border-0">
                          <td colSpan={14} className="bg-[var(--primary)]/[0.04] p-0">
                            <Collapse open={!closingCell} unmountOnClose>
                              <div className="px-3 pb-3 pt-3">
                                <div className="mb-2 flex items-center justify-between">
                                  <span className="text-xs font-medium text-[var(--muted-foreground)]">
                                    {MONTH_ABBR[monthIndexOf(openPeriod)]} {year} ·{' '}
                                    {cellLines.length} line{cellLines.length === 1 ? '' : 's'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={closeCell}
                                    className="text-xs text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
                                  >
                                    Close
                                  </button>
                                </div>
                                <LineList lines={cellLines} onOpen={setActiveLineId} />
                              </div>
                            </Collapse>
                          </td>
                        </tr>
                      )}
                            </Fragment>
                          );
                        })}
                      </Fragment>
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
                <ChevronRightIcon
                  className={`h-4 w-4 text-[var(--muted-foreground)] transition-transform duration-200 ${
                    poolOpen ? 'rotate-90' : ''
                  }`}
                />
              </span>
            </button>
            <Collapse open={poolOpen} mountClosed={false}>
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
            </Collapse>
          </div>

          {loading && (
            <p className="mt-3 text-xs text-[var(--muted-foreground)]">Refreshing…</p>
          )}
        </>
      )}

      {categoriseOpen && accountKey && (
        <BudgetCategoriseModal
          accountKey={accountKey}
          year={year}
          accountName={accountData?.dealer ?? accountKey}
          onChanged={() => void reload()}
          onClose={() => setCategoriseOpen(false)}
        />
      )}

      {agreementsOpen && accountKey && (
        <BudgetAgreementModal
          year={year}
          accountName={accountData?.dealer ?? accountKey}
          agreements={agreements}
          onSave={saveAgreement}
          onArchive={archiveAgreement}
          onGenerate={generateFees}
          onClose={() => setAgreementsOpen(false)}
        />
      )}

      {addOpen && accountKey && (
        <BudgetAddLineModal
          year={year}
          accountName={accountData?.dealer ?? accountKey}
          onAdd={addLine}
          onAddFlight={addFlight}
          onClose={() => setAddOpen(false)}
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
      {lines.map((l) => {
        // Drop anything that just repeats the title. Both of these genuinely
        // collide: a Managed Marketing Service line is labelled with its own
        // source, and a ticket-sourced line takes the ticket's title as its
        // label — so the row printed its own name twice in two different ways.
        const title = l.label || l.taskTitle || '';
        const sub = [
          sourceLabel(l.source) === title ? null : sourceLabel(l.source),
          l.taskTitle === title ? null : l.taskTitle,
          l.isCrossAccount ? `Spends from ${l.spendAccountDealer ?? l.spendAccountKey}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
        <li key={l.id}>
          <button
            type="button"
            onClick={() => onOpen(l.id)}
            className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition hover:bg-[var(--muted)]/60"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-[var(--foreground)]">
                {title || 'Untitled line'}
              </span>
              {sub && (
                <span className="block truncate text-[11px] text-[var(--muted-foreground)]">
                  {sub}
                </span>
              )}
            </span>
            <span className="flex flex-shrink-0 items-center gap-2">
              <StatusPill status={l.status} />
              <span className="text-sm font-medium tabular-nums text-[var(--foreground)]">
                {usd2(l.amount)}
              </span>
            </span>
          </button>
        </li>
        );
      })}
    </ul>
  );
}

