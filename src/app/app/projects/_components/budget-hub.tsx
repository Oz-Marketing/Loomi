'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  BanknotesIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/lib/toast';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { AccountAvatar } from '@/components/account-avatar';
import { LINE_TYPES } from '@/lib/budget/channels';
import { useBudgetChannels } from '@/contexts/budget-channels-context';
import { ChannelIcon } from '@/components/icons/channel-icon';
import { Collapse } from '@/components/ui/collapse';
import { periodOf } from '@/lib/budget/period';
import { useAccount } from '@/contexts/account-context';
import { jsonFetcher } from './fetcher';
import { BudgetAgreementModal } from './budget-agreement-modal';
import { BudgetCategorizeModal } from './budget-categorize-modal';
import { BudgetMonthView } from './budget-month-view';
import { BudgetPanel } from './budget-panel';
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
  const { channels: ch } = useBudgetChannels();
  const [year, setYear] = useState(() => new Date().getFullYear());

  const [summary, setSummary] = useState<Summary | null>(null);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // One entry point for adding budget, straight into the form. There was a
  // chooser asking one-time vs recurring; a one-off is just a budget that runs
  // for one month, so the question was asking people to classify something the
  // form already handles.
  const [addFlow, setAddFlow] = useState<'new-budget' | 'budgets' | null>(null);
  // The cell (channel × period) whose lines are being inspected, or 'pool'.
  const [openCell, setOpenCell] = useState<{ channel: string; period: string } | null>(null);
  const [closingCell, setClosingCell] = useState(false);
  /** Line-type sections folded shut. Keyed by section, not index, so it
   *  survives a channel appearing or disappearing. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [categorizeOpen, setCategorizeOpen] = useState(false);
  /** Year grid vs one month in full. */
  const [view, setView] = useState<'year' | 'month'>('year');
  const [focusMonth, setFocusMonth] = useState(() => new Date().getMonth() + 1);

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
    return ch.all.filter((c) => byChannel.has(c.key)).map((c) => ({
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
   * categorizing. A flat 44-row table mixes a Google buy with a management fee
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

  /**
   * Everything on the paced channels. The denominator for base vs added,
   * because that split only exists where the Ad Pacer reads it.
   */
  const pacedTotal = (summary?.baseTotal ?? 0) + (summary?.addedTotal ?? 0);

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
   * The open cell's lines rolled up by the budget they came from — the same
   * shape the month view shows. A cell held the raw pieces (SEM, Search) while
   * the month view showed "Some Sales Event"; the same money reading two
   * different ways depending on where you clicked is its own kind of wrong.
   */
  const cellGroups = useMemo(() => {
    const byBudget = new Map<string, BudgetLine[]>();
    const loose: BudgetLine[] = [];
    for (const l of cellLines) {
      if (!l.agreementId) {
        loose.push(l);
        continue;
      }
      const rows = byBudget.get(l.agreementId) ?? [];
      rows.push(l);
      byBudget.set(l.agreementId, rows);
    }
    return {
      budgets: [...byBudget.entries()]
        .map(([id, rows]) => ({
          id,
          name: agreements.find((a) => a.id === id)?.name ?? rows[0]?.label ?? 'Budget',
          rows,
          amount: rows.reduce((t, r) => t + r.amount, 0),
        }))
        .sort((a, b) => b.amount - a.amount),
      loose,
    };
  }, [cellLines, agreements]);

  /**
   * What the side panel is showing: a title and the lines under it. A single
   * line is a group of one, so there's one panel rather than a group view and
   * a line view that each handle half the job.
   */
  const [activeGroup, setActiveGroup] = useState<{ title: string; lineIds: string[] } | null>(null);
  const openLine = useCallback(
    (id: string) => {
      const line = activeLines.find((l) => l.id === id);
      if (line) {
        setActiveGroup({
          title: line.label || line.taskTitle || ch.label(line.channel),
          lineIds: [id],
        });
      }
    },
    [activeLines],
  );
  const activeGroupLines = useMemo(
    () =>
      activeGroup
        ? activeGroup.lineIds
            .map((id) => activeLines.find((l) => l.id === id))
            .filter((l): l is BudgetLine => !!l)
        : [],
    [activeGroup, activeLines],
  );

  /**
   * The sub-line under "Total budget". A term that only partly
   * overlaps the year is the case worth explaining — the card's number is that
   * term's SHARE of the year, and without saying so it looks like the contract
   * value is wrong.
   */
  const agreementSub = useMemo(() => {
    if (agreements.length === 0) return 'Add a budget to track against';
    if (summary?.declaredTotal == null) return 'No total set on the budget';
    const fees = agreements.reduce((t, a) => t + a.monthlyFeeTotal, 0);
    const partial = agreements.filter((a) => a.monthsInYear != null && a.monthsInYear < a.termMonths);
    if (partial.length > 0) {
      return agreements.length === 1
        ? `${partial[0].monthsInYear} of ${partial[0].termMonths} months of the term fall in ${year}`
        : `Pro-rated share of ${agreements.length} budgets`;
    }
    if (fees > 0) return `${usd0(fees)}/mo recurring`;
    return agreements.length === 1 ? 'What the client signed up for' : `Across ${agreements.length} budgets`;
  }, [agreements, summary?.declaredTotal, year]);

  const yearOptions = useMemo(() => {
    const now = new Date().getFullYear();
    return [now - 1, now, now + 1].map((y) => ({ value: String(y), label: String(y) }));
  }, []);

  // ── Mutations ──

  /** Create or update a budget. Returns its id so the caller can lay it out,
   *  or null if the save failed — the modal must not close over an error. */
  async function saveAgreement(
    body: Record<string, unknown>,
    id: string | null,
  ): Promise<string | null> {
    try {
      const res = await fetch(id ? `/api/budget/agreements/${id}` : '/api/budget/agreements', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountKey, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not save the budget');
      toast.success(id ? 'Budget saved' : 'Budget created');
      return id ?? data?.agreement?.id ?? null;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the budget');
      return null;
    }
  }

  /**
   * Turn a budget's items into the actual lines for the year.
   *
   * Runs on every save, not behind a button. A budget whose items and term are
   * both set already says what the lines should be, and making that a separate
   * step meant creating a budget put nothing on the chart — the page looked
   * broken. Idempotent, so re-saving doesn't duplicate anything.
   */
  async function generateFees(id: string, quiet = false) {
    try {
      const res = await fetch(`/api/budget/agreements/${id}?generate=${year}`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      // A budget with no items yet has nothing to lay out; that's a fine state
      // to save in, not an error worth interrupting someone over.
      if (!res.ok) {
        if (!quiet) throw new Error(data?.error || 'Could not lay out the year');
        return;
      }
      const n = data?.generated?.length ?? 0;
      if (n > 0) toast.success(`Added ${n} line${n === 1 ? '' : 's'} to the year`);
      else if (!quiet) toast.success('Every month already has its lines');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not lay out the year');
    } finally {
      // Always — this is the last step of every save, and it's what puts the
      // new budget and its lines on the page.
      await reload();
    }
  }

  async function archiveAgreement(id: string) {
    try {
      const res = await fetch(`/api/budget/agreements/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not archive the budget');
      // Lines keep their money — archiving ends the commitment, it doesn't
      // unwind what's already been budgeted against it.
      toast.success('Budget archived · its lines are untouched');
      await reload();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not archive the budget');
      return false;
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
            onClick={() => setAddFlow('new-budget')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            <PlusIcon className="h-4 w-4" />
            Add Budget
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
          <div className="mt-6 grid grid-cols-2 gap-3">
            <StatCard
              label="Total budget"
              value={summary.declaredTotal}
              empty="Not set"
              sub={agreementSub}
            />
            {/* There were four cards. "Planned" and "Unassigned pool" both
                went: with every line committed on creation, planned was the
                same number as scheduled, and the pool was a bucket nothing
                ever landed in. Two cards that always agree teach people to
                read neither. */}
            <StatCard
              label="Scheduled"
              value={summary.allocated}
              tone={summary.overAllocated ? 'warn' : undefined}
              sub={
                summary.declaredTotal
                  ? summary.overAllocated
                    ? `${usd0(Math.abs(summary.unplanned ?? 0))} over the total budget`
                    : `${Math.round((summary.allocated / summary.declaredTotal) * 100)}% of the total budget`
                  : grid.length > 0
                    ? `Placed across ${grid.length} channel${grid.length === 1 ? '' : 's'}`
                    : 'Nothing placed yet'
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
                  {/* Percentages of the PACED money, not of the year. Base is
                      9% of everything on this account but 100% of what the
                      pacer sees, and the second number is the one that means
                      something. */}
                  {pacedTotal > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-[var(--border)] pt-2.5">
                      <span className="text-[11px] text-[var(--muted-foreground)]">
                        Base{' '}
                        <span className="font-medium tabular-nums text-[var(--foreground)]">
                          {usd0(summary.baseTotal)}
                        </span>
                        <span className="ml-1 opacity-60">
                          {Math.round((summary.baseTotal / pacedTotal) * 100)}%
                        </span>
                      </span>
                      <span className="text-[11px] text-[var(--muted-foreground)]">
                        Added{' '}
                        <span className="font-medium tabular-nums text-[var(--foreground)]">
                          {usd0(summary.addedTotal)}
                        </span>
                        <span className="ml-1 opacity-60">
                          {Math.round((summary.addedTotal / pacedTotal) * 100)}%
                        </span>
                      </span>
                      <span className="text-[11px] text-[var(--muted-foreground)] opacity-70">
                        of {usd0(pacedTotal)} on Meta &amp; Google
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
                        onClick={() => setCategorizeOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-600 transition hover:bg-amber-500/20"
                      >
                        <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                        Categorize {usd0(untypedTotal)}
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

          {/* ── The ledger ── */}
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">
                {view === 'year' ? 'By channel & month' : 'Month detail'}
              </h2>
              {/* Two shapes of the same money: the year answers "how is it
                  spread", the month answers "what exactly are we running". */}
              <div className="flex rounded-lg bg-[var(--muted)]/40 p-0.5">
                {(['year', 'month'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition ${
                      view === v
                        ? 'bg-[var(--primary)] text-white shadow-sm'
                        : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {view === 'month' ? (
              <BudgetMonthView
                year={year}
                month={focusMonth}
                lines={activeLines}
                budgets={agreements}
                onMonthChange={setFocusMonth}
                onOpenLine={openLine}
                onOpenGroup={(title, rows) =>
                  setActiveGroup({ title, lineIds: rows.map((r) => r.id) })
                }
              />
            ) : grid.length === 0 ? (
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
                  onClick={() => setAddFlow('new-budget')}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground)] transition hover:bg-[var(--muted)]"
                >
                  <PlusIcon className="h-4 w-4" />
                  Add Budget
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
                            {ch.isPaced(row.channel) && (
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
                                <LineList
                                  groups={cellGroups.budgets}
                                  loose={cellGroups.loose}
                                  onOpen={openLine}
                                  onOpenGroup={(title, rows) =>
                                    setActiveGroup({ title, lineIds: rows.map((r) => r.id) })
                                  }
                                />
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

          {loading && (
            <p className="mt-3 text-xs text-[var(--muted-foreground)]">Refreshing…</p>
          )}
        </>
      )}

      {categorizeOpen && accountKey && (
        <BudgetCategorizeModal
          accountKey={accountKey}
          year={year}
          accountName={accountData?.dealer ?? accountKey}
          onChanged={() => void reload()}
          onClose={() => setCategorizeOpen(false)}
        />
      )}

      {(addFlow === 'budgets' || addFlow === 'new-budget') && accountKey && (
        <BudgetAgreementModal
          year={year}
          accountName={accountData?.dealer ?? accountKey}
          agreements={agreements}
          startNew={addFlow === 'new-budget'}
          onSave={saveAgreement}
          onArchive={archiveAgreement}
          onGenerate={generateFees}
          onClose={() => setAddFlow(null)}
        />
      )}

      {activeGroup && activeGroupLines.length > 0 && (
        <BudgetPanel
          title={activeGroup.title}
          period={activeGroupLines[0]!.period ?? ''}
          lines={activeGroupLines}
          onClose={() => setActiveGroup(null)}
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

/**
 * A cell's contents: budgets first, then anything standalone.
 *
 * A budget shows as ONE row named after the budget, not as its pieces. The
 * chevron peeks at what's inside without leaving the list — "what is this
 * $3,000 going to" is a glance, not a task — while clicking the row opens the
 * panel, which is where pieces are actually edited. A single-piece budget has
 * no chevron and goes straight to the line; expanding to reveal one row you
 * can already see teaches nothing.
 */
function LineList({
  groups,
  loose,
  onOpen,
  onOpenGroup,
}: {
  groups: { id: string; name: string; rows: BudgetLine[]; amount: number }[];
  loose: BudgetLine[];
  onOpen: (id: string) => void;
  onOpenGroup: (title: string, rows: BudgetLine[]) => void;
}) {
  const { channels: ch } = useBudgetChannels();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  if (groups.length === 0 && loose.length === 0) {
    return <p className="text-sm text-[var(--muted-foreground)]">No lines here.</p>;
  }
  return (
    <ul className="divide-y divide-[var(--border)]">
      {groups.map((g) => {
        const single = g.rows.length === 1;
        const expanded = open.has(g.id);
        return (
          <li key={g.id}>
            <div className="-mx-2 flex w-[calc(100%+1rem)] items-center rounded-lg transition hover:bg-[var(--muted)]/60">
              {/* Its own hit area, so peeking inside never opens the panel
                  and opening the panel never collapses what you were reading. */}
              {single ? (
                <span className="w-7 flex-shrink-0" />
              ) : (
                <button
                  type="button"
                  aria-label={expanded ? `Hide ${g.name} items` : `Show ${g.name} items`}
                  aria-expanded={expanded}
                  onClick={() => toggle(g.id)}
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  <ChevronRightIcon
                    className={`h-3.5 w-3.5 transition-transform duration-200 ${
                      expanded ? 'rotate-90' : ''
                    }`}
                  />
                </button>
              )}
              <button
                type="button"
                onClick={() => (single ? onOpen(g.rows[0]!.id) : onOpenGroup(g.name, g.rows))}
                className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-2.5 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-[var(--foreground)]">{g.name}</span>
                  <span className="block truncate text-[11px] text-[var(--muted-foreground)]">
                    {single
                      ? sourceLabel(g.rows[0]!.source)
                      : `${g.rows.length} items`}
                  </span>
                </span>
                <span className="flex flex-shrink-0 items-center gap-2">
                  {single && <StatusPill status={g.rows[0]!.status} />}
                  <span className="text-sm font-medium tabular-nums text-[var(--foreground)]">
                    {usd2(g.amount)}
                  </span>
                </span>
              </button>
            </div>

            {!single && (
              <Collapse open={expanded}>
                <ul className="ml-7 border-l border-[var(--border)] pb-1 pl-3">
                  {g.rows.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(r.id)}
                        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--muted)]/60"
                      >
                        <ChannelIcon
                          channel={r.channel}
                          className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted-foreground)]"
                        />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--foreground)]">
                          {r.label || ch.label(r.channel)}
                        </span>
                        <span className="flex-shrink-0 text-[11px] text-[var(--muted-foreground)]">
                          {ch.label(r.channel)}
                        </span>
                        <span className="flex-shrink-0 text-[13px] tabular-nums text-[var(--foreground)]">
                          {usd2(r.amount)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Collapse>
            )}
          </li>
        );
      })}

      {loose.map((l) => {
        // Drop anything that just repeats the title. Both of these genuinely
        // collide: a budget-sourced line is labelled with its own source, and
        // a ticket-sourced line takes the ticket's title as its label — so the
        // row printed its own name twice in two different ways.
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

