'use client';

/**
 * The Google pacing card — a top-down account allocator plus flight-aware pacing
 * (google-pacing-card spec). Replaces the per-campaign island-budget pacer: the
 * account's payable is the source, and every campaign's daily budget is derived
 * from its share of it.
 *
 * All arithmetic lives in lib/ad-pacer/google-allocator (pure, unit-tested against
 * the spec's acceptance criteria). This file is presentation and persistence:
 * it renders the view the allocator computes and writes the results back.
 *
 * Three things worth knowing before editing:
 *
 *  - ONE UNIT for the whole card. Percent mode stores the percent so the dollar
 *    target can be re-derived when the payable changes; dollar mode stores dollars.
 *    `allocation` is always written in dollars, because reconciliation, the budget
 *    panels and the over/under all read dollars and must not learn about modes.
 *  - THE RECOMMENDED DAILY IS STATELESS. It is (target − spent) ÷ remaining whole
 *    flight days. Delivery diagnosis lives in the health popup, never in this
 *    number.
 *  - EVERY summary number rescopes to the active label filter (§9). The totals row,
 *    the meter, the header pace and the move panel all read the filtered view.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  ViewColumnsIcon,
  NoSymbolIcon,
  ClockIcon,
  ArrowSmallDownIcon,
  ArrowSmallUpIcon,
  ArchiveBoxIcon,
  ArrowUturnLeftIcon,
  BoltIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  Squares2X2Icon,
  TableCellsIcon,
  LockClosedIcon,
  LockOpenIcon,
  MinusSmallIcon,
  PlusSmallIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { COLORS, GOOGLE_SETTLING_HOURS } from '@/lib/ad-pacer/constants';
import { fmt, fmtDate, num } from '@/lib/ad-pacer/helpers';
import { collectLabels, serializeTags } from '@/lib/ad-pacer/labels';
import {
  applyBlockedReason,
  applyEligibility,
  balance,
  buildAllocatorView,
  convertMode,
  moneyEq,
  planMove,
  PUSH_DRIFT_FRACTION,
  PUSH_DRIFT_MIN_DOLLARS,
  resolveClock,
  resolvePayable,
  sourceAvailable,
  targetOf,
  type AllocationMode,
  type AllocatorLine,
  type AllocatorView,
  type BalanceMode,
  type MoveMethod,
  type MoveSource,
} from '@/lib/ad-pacer/google-allocator';
import type { PacerAd, PacerPlan } from '@/lib/ad-pacer/types';
import {
  InlineMoneyCell,
  LabelChips,
  LabelFilterBar,
  Tooltip,
} from '@/app/app/tools/_shared';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { zonedTodayIso } from '@/lib/timezone';
import { toast } from '@/lib/toast';
import { COL, GoogleCampaignCard } from './GoogleCampaignCard';
import { capDelivery, isFutileRaise } from '@/lib/ad-pacer/google-metrics';
import {
  adStatusTone,
  normalizeAdStatus,
  statusMismatch,
  statusReasonText,
  type StatusMismatch,
} from '@/lib/ad-pacer/platform-status';
import { GoogleDeliveryExpander } from './GoogleDeliveryExpander';
import { PACE_COLORS, PACE_LABELS, campaignColor } from './google-pacing-theme';
import { GoogleCompareModal } from './GoogleCompareModal';
import { GoogleApplyConfirmModal, type ApplyChange } from './GoogleApplyConfirmModal';

/** §10 — the comparison is 2–4 campaigns. Below two there is nothing to compare;
 *  above four the grid stops being readable at a glance, which is its only job. */
const COMPARE_MIN = 2;
const COMPARE_MAX = 4;

/** "August 2026" for the period heading — same wording as the shell's. */
function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

const money2 = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface GooglePacingCardProps {
  accountKey: string;
  period: string;
  plan: PacerPlan;
  ads: PacerAd[];
  /** Rows the sidebar filters + search admit. The allocator still totals the FULL
   *  set, because an allocation that only sums the rows you happen to be looking
   *  at is not an allocation. */
  visibleAds: PacerAd[];
  timeZone: string;
  frozen: boolean;
  /**
   * ONE write path for everything this card changes — the ad rows and/or the
   * period-scoped settings. Deliberately not two callbacks: the save is a
   * full-replace PUT, so a mode switch that wrote the rows and the mode in two
   * calls raced, and whichever call captured the pre-switch rows won — wiping
   * every allocation on the account. Anything that changes both goes in one call.
   */
  onPersist: (payload: {
    ads?: PacerAd[];
    allocationMode?: AllocationMode;
    eventBudgets?: Record<string, number>;
  }) => void;
  /** Push the recommended dailies to Google (batched — see §8). */
  /** §14 — apply. No argument = the whole drifted batch; a list of ids = exactly
   *  those campaigns, honoured even below the drift threshold. */
  onPushBudgets: (adIds?: readonly string[]) => void;
  pushing?: boolean;
  googleConnected: boolean;
  /** Re-run the account sync (spend + the §4 metric columns). Shared by every
   *  open delivery panel — ten open rows must never fire ten syncs. */
  onSyncFromGoogle?: () => void;
  syncing?: boolean;
  /** Search / sync / Add Plan, rendered directly above the table so the controls
   *  sit with the rows they act on rather than above the whole card. */
  tableActions?: React.ReactNode;
}

export function GooglePacingCard({
  accountKey,
  period,
  plan,
  ads,
  visibleAds,
  timeZone,
  frozen,
  onPersist,
  onPushBudgets,
  pushing = false,
  googleConnected,
  onSyncFromGoogle,
  syncing = false,
  tableActions,
}: GooglePacingCardProps) {
  const readOnly = frozen;
  const [mode, setMode] = useState<AllocationMode>(plan.allocationMode ?? 'pct');
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [eventBudgets, setEventBudgets] = useState<Record<string, number>>(
    plan.eventBudgets ?? {},
  );
  const [moveOpen, setMoveOpen] = useState(false);
  // §10 Compare selection. Deliberately the SAME set the Compare-view Move
  // button pre-loads (§9's second entry point) rather than a second selection
  // model — "look, then move without re-picking" is the whole reason Compare
  // flows into Move, and two independent selections would break that in the one
  // step where it matters.
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [compareOpen, setCompareOpen] = useState(false);
  /** Destinations Move opens pre-filled with. Empty = opened from the toolbar. */
  const [movePreload, setMovePreload] = useState<string[]>([]);
  /**
   * §14 — the pending push, awaiting confirmation. Null = nothing staged.
   *
   * `mode` is carried explicitly rather than inferred from the row count. The
   * two paths mean different things to the server — 'single' names its campaign
   * so the drift gate is dropped for it, 'all' sends no ids and lets the server
   * rebuild the batch — and inferring that from "is this list the same length as
   * the batch" silently picks the wrong one whenever a single deliberate apply
   * happens to be the only drifted campaign on the account.
   */
  const [pendingApply, setPendingApply] = useState<{
    changes: ApplyChange[];
    mode: 'single' | 'all';
  } | null>(null);
  const [spendOpen, setSpendOpen] = useState(false);
  // Table (dense, comparative) vs cards (one campaign at a time, Meta's shape).
  const [layout, setLayout] = useState<'table' | 'cards'>('table');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Which rows have their delivery panel open (§1). A SET, not a single id:
  // choosing who gives budget and who gets it is a comparison, and the modal
  // this replaced could only ever show one campaign while hiding the table
  // behind it. Opening a row never closes another — the user decides what stays
  // open. Kept separate from `expandedIds` (the cards layout's planning body)
  // so the two panels don't fight over one toggle.
  const [deliveryIds, setDeliveryIds] = useState<Set<string>>(new Set());
  const toggleSet =
    (setter: typeof setExpandedIds) =>
    (id: string) =>
      setter((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
  const toggleExpanded = toggleSet(setExpandedIds);
  const toggleDelivery = toggleSet(setDeliveryIds);
  // Undo holds whole ad sets — every mutation here is a multi-row rewrite
  // (balance, move, a mode switch), so a field-level undo would be a lie.
  const [undoStack, setUndoStack] = useState<PacerAd[][]>([]);

  // Follow the server when the period/account changes underneath.
  useEffect(() => {
    setMode(plan.allocationMode ?? 'pct');
    setEventBudgets(plan.eventBudgets ?? {});
    setActiveLabel(null);
    setUndoStack([]);
  }, [plan.allocationMode, plan.eventBudgets, period, accountKey]);

  const { totalBudget, payable, markup } = useMemo(
    () =>
      resolvePayable({
        baseBudgetGoal: plan.baseBudgetGoal,
        addedBudgetGoal: plan.addedBudgetGoal,
        markup: plan.markup,
      }),
    [plan.baseBudgetGoal, plan.addedBudgetGoal, plan.markup],
  );

  // §10: the data edge comes from the synced series, so the card's day counts and
  // its spend figure stop at the same instant. Union of every Google row's series.
  const clock = useMemo(() => {
    const dates = new Set<string>();
    for (const ad of ads) for (const p of ad.dailySpend ?? []) dates.add(p.date);
    return resolveClock(period, zonedTodayIso(Date.now(), timeZone), [...dates]);
  }, [ads, period, timeZone]);

  const view = useMemo(
    () =>
      buildAllocatorView({
        ads,
        mode,
        payable,
        clock,
        activeLabel,
        eventBudgets,
      }),
    [ads, mode, payable, clock, activeLabel, eventBudgets],
  );

  const allLabels = useMemo(() => collectLabels(ads), [ads]);
  // The sidebar/search filter narrows what's DRAWN; the allocator's own label
  // filter decides what's counted (§9).
  const searchVisible = useMemo(() => new Set(visibleAds.map((a) => a.id)), [visibleAds]);
  const rows = useMemo(
    () => view.visible.filter((l) => searchVisible.has(l.id)),
    [view.visible, searchVisible],
  );

  const adsById = useMemo(() => new Map(ads.map((a) => [a.id, a])), [ads]);

  // ── persistence ──

  /** Write a set of new INPUT values (in the card's current unit) onto the rows,
   *  keeping `allocation` (dollars) and `allocationPercent` consistent. */
  const applyInputs = useCallback(
    (inputs: Map<string, number>, opts: { snapshot?: boolean } = {}) => {
      if (readOnly || inputs.size === 0) return;
      if (opts.snapshot !== false) setUndoStack((s) => [...s.slice(-29), ads]);
      const next = ads.map((ad) => {
        const input = inputs.get(ad.id);
        if (input == null) return ad;
        const dollars = targetOf(input, mode, payable);
        return {
          ...ad,
          allocation: dollars.toFixed(2),
          // Percent mode keeps the percent so a later payable change re-derives
          // the dollars; dollar mode drops it so nothing stale lingers.
          allocationPercent: mode === 'pct' ? String(input) : null,
        };
      });
      onPersist({ ads: next });
    },
    [ads, mode, payable, onPersist, readOnly],
  );

  const updateAd = useCallback(
    (id: string, patch: Partial<PacerAd>) => {
      if (readOnly) return;
      setUndoStack((s) => [...s.slice(-29), ads]);
      onPersist({ ads: ads.map((ad) => (ad.id === id ? { ...ad, ...patch } : ad)) });
    },
    [ads, onPersist, readOnly],
  );

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const prev = stack[stack.length - 1];
      onPersist({ ads: prev });
      return stack.slice(0, -1);
    });
  }, [onPersist]);

  // ── §3 mode switch ──
  const switchMode = (next: AllocationMode) => {
    if (next === mode || readOnly) return;
    // Convert in place: targets do not move, only the notation (AC 2).
    const converted = convertMode(
      view.lines.map((l) => ({ id: l.id, input: l.input })),
      mode,
      next,
      payable,
    );
    setUndoStack((s) => [...s.slice(-29), ads]);
    const byId = new Map(converted.map((c) => [c.id, c]));
    setMode(next);
    // Rows AND the mode in a single write — see the onPersist doc. Two calls here
    // raced and the stale one wiped every allocation.
    onPersist({
      ads: ads.map((ad) => {
        const row = byId.get(ad.id);
        if (!row) return ad;
        return {
          ...ad,
          allocation: row.target.toFixed(2),
          allocationPercent: next === 'pct' ? String(row.input) : null,
        };
      }),
      allocationMode: next,
    });
  };

  // ── §12 balance ──
  const doBalance = (balanceMode: BalanceMode) => {
    if (readOnly) return;
    // Balance works on the lines the denominator covers — the filtered subset when
    // a label view is active, so balancing an event never reshuffles the account.
    // The target total is the active denominator expressed in the card's unit:
    // 100% / the payable unfiltered, and the label's own share of either when
    // filtered (an event budget is dollars, so percent mode converts it).
    const denominatorInUnit =
      mode === 'amt'
        ? view.totals.denominator
        : payable > 0
          ? (view.totals.denominator / payable) * 100
          : 0;
    const result = balance(
      view.visible.map((l) => ({ id: l.id, input: l.input, locked: l.locked })),
      denominatorInUnit,
      balanceMode,
    );
    if (result.size === 0) {
      toast.error('Every line in view is locked — nothing to balance');
      return;
    }
    applyInputs(result);
    toast.success(
      balanceMode === 'even'
        ? 'Split evenly across unlocked campaigns'
        : 'Balanced — kept your proportions',
    );
  };

  /** Write a manual flight override as day-of-month bounds within this month. */
  // Cap the comparison at four columns. Past that the grid stops being readable
  // at a glance, which is the only thing it is for — the fifth column is where
  // someone starts scrolling sideways and comparing from memory again.
  const toggleCompare = useCallback((id: string) => {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < COMPARE_MAX) next.add(id);
      return next;
    });
  }, []);

  // The compared lines in TABLE order, not click order: the grid should read the
  // same way the table does.
  const compareLines = useMemo(
    () => view.visible.filter((l) => compareIds.has(l.id)),
    [view.visible, compareIds],
  );

  // Drop selections that leave the view (filter change, campaign removed) so the
  // count can never claim campaigns the grid would not show.
  useEffect(() => {
    setCompareIds((prev) => {
      const valid = new Set(view.visible.map((l) => l.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [view.visible]);

  // §14 — stage one campaign for confirmation. Never pushes directly: no write
  // to a live account happens without the concrete change stated first.
  const requestApply = useCallback((change: ApplyChange) => {
    setPendingApply({ changes: [change], mode: 'single' });
  }, []);

  // §14 — the demoted apply-all. Same drift gate the server applies to a batch,
  // recomputed here only to SHOW the list before committing; the server rebuilds
  // it from stored allocations and remains the authority on what is written.
  const applyAllChanges = useMemo<ApplyChange[]>(() => {
    const out: ApplyChange[] = [];
    for (const line of view.visible) {
      const ad = adsById.get(line.id);
      if (!applyEligibility(line, ad?.googleBudgetResourceName ?? null).ok) continue;
      const drift = Math.abs(line.recommendedDaily - line.currentDaily);
      const threshold = Math.max(
        PUSH_DRIFT_MIN_DOLLARS,
        line.currentDaily * PUSH_DRIFT_FRACTION,
      );
      if (drift < threshold) continue;
      out.push({
        id: line.id,
        name: line.name,
        currentDaily: line.currentDaily,
        newDaily: line.recommendedDaily,
        futile: isFutileRaise({
          currentDaily: line.currentDaily,
          recommendedDaily: line.recommendedDaily,
          delivery: capDelivery({
            budgetConstrained: line.budgetLimited,
            channelType: line.channelType,
            budgetLostIsRaw: ad?.googleSearchBudgetLostIs ?? null,
            series: ad?.dailySpend,
            cap: line.currentDaily,
            dataEdgeIso: clock.dataEdgeIso,
          }),
        }),
      });
    }
    return out;
  }, [view.visible, adsById, clock.dataEdgeIso]);

  // The sum of what Google actually holds right now. `currentDaily` is synced
  // from Google and rewritten the moment a push succeeds, so this stays honest
  // between syncs. Reserved and total-budget lines are excluded on both sides,
  // so the two totals compare like for like.
  const liveAccountDaily = useMemo(
    () =>
      view.visible.reduce(
        (sum, l) => sum + (l.dailyControllable && !l.reserved ? l.currentDaily : 0),
        0,
      ),
    [view.visible],
  );

  const requestApplyAll = useCallback(() => {
    if (applyAllChanges.length > 0) setPendingApply({ changes: applyAllChanges, mode: 'all' });
  }, [applyAllChanges]);

  const setFlight = useCallback(
    (id: string, startDay: number, endDay: number) => {
      const pad = (n: number) => String(n).padStart(2, '0');
      updateAd(id, {
        googleFlightStartOverride: `${period}-${pad(startDay)}`,
        googleFlightEndOverride: `${period}-${pad(endDay)}`,
      });
    },
    [period, updateAd],
  );

  // Bar widths measure against the LARGER of the denominator and the plan, so an
  // over-allocated plan compresses rather than overflowing the track.
  const meterBasis = Math.max(view.totals.denominator, view.totals.allocated) || 1;
  const allocColor = view.totals.fullyAllocated
    ? COLORS.success
    : view.totals.unallocated > 0
      ? COLORS.warn
      : COLORS.error;

  const carryoverNote =
    (num(plan.baseCarryover) ?? 0) + (num(plan.addedCarryover) ?? 0);

  return (
    <div>
      {/* ── Headline stats ──
          One card per number, above the allocation bar. These are the figures a
          rep reads first and quotes to a client, so they get their own surfaces
          rather than being crammed into a header row. MetricBox is Loomi's
          passive-stat primitive (same one the pacer cards use), so they match the
          rest of the tool. Filtered views swap the account's budget/payable for
          the denominator the slice is actually measured against (§9). */}
      <div
        className={`mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 ${
          view.activeLabel ? 'lg:grid-cols-4' : 'lg:grid-cols-5'
        }`}
      >
        {view.activeLabel ? (
          <StatCard
            label={view.denominatorKind === 'eventBudget' ? 'Event Budget' : 'Campaign Total'}
            value={fmt(view.totals.denominator)}
            tooltip={
              view.denominatorKind === 'eventBudget'
                ? 'The budget you intended for this label. The tagged allocation is checked against it.'
                : 'No event budget set for this label, so the tagged campaigns are checked against their own total.'
            }
          />
        ) : (
          <>
            <StatCard
              label="Total Budget"
              value={fmt(totalBudget)}
              sub="client gross"
              tooltip="The client's budget for the month, before the markup. Set it on the Planner tab."
            />
            <StatCard
              label="Actual Spend"
              value={fmt(payable)}
              sub={`× ${(markup * 100).toFixed(1)}% markup`}
              color={carryoverNote !== 0 ? COLORS.warn : undefined}
              tooltip={`Client budget × ${(markup * 100).toFixed(1)}% markup — the spend that actually reaches Google, and the denominator every allocation is measured against.${
                carryoverNote !== 0
                  ? ` This month also carries a ${money2(carryoverNote)} reconciliation carryover, which is NOT included — apply it to the budget number if you want it paced.`
                  : ''
              }`}
            />
          </>
        )}
        <StatCard
          label="Spent MTD"
          value={fmt(view.totals.spent)}
          sub={clock.dataEdgeIso ? `through ${fmtDate(clock.dataEdgeIso)}` : 'no settled days'}
          color={COLORS.daily}
          tooltip="Delivered so far this month, from Google. Served cost, not billed."
        />
        <StatCard
          label="Expected MTD"
          value={fmt(view.totals.expected)}
          sub="at an even pace"
          tooltip="What should have been spent by now, at an even pace across each campaign's own flight days."
        />
        <StatCard
          label={view.activeLabel ? 'Campaign Pace' : 'Account Pace'}
          value={PACE_LABELS[view.totals.paceStatus]}
          sub={
            view.totals.paceRatio != null
              ? `${Math.round(view.totals.paceRatio * 100)}% of expected`
              : undefined
          }
          color={PACE_COLORS[view.totals.paceStatus]}
          tooltip={
            view.totals.paceRatio != null
              ? `Spent is ${Math.round(view.totals.paceRatio * 100)}% of expected. On track is within 12% either way — Google can spend up to 2× the daily on a busy day, so a tighter band would flip on any busy Saturday.`
              : 'No settled days yet.'
          }
        />
      </div>

      {/* ── Allocation bar ── */}
      <div className="glass-section-card rounded-xl px-5 py-4 mb-4">
        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          <span className="text-sm font-bold uppercase tracking-wider text-[var(--foreground)]">
            {view.activeLabel ?? 'Account'} Allocation
          </span>
          {/* Expands the two numbers that drive the day's work. */}
          <button
            type="button"
            onClick={() => setSpendOpen((o) => !o)}
            aria-expanded={spendOpen}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            {spendOpen ? 'Hide' : 'Spend to date'}
            <ChevronDownIcon
              className={`h-3.5 w-3.5 transition-transform ${spendOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        {/* Segmented allocation bar — one segment per campaign, matching the
            Base/Added bar's chrome so the two read as the same instrument. */}
        <div className="mb-2 flex h-2.5 overflow-hidden rounded-full bg-[var(--muted)]">
          {view.visible
            .filter((l) => l.target > 0)
            .map((l) => (
              <Tooltip
                key={l.id}
                className="h-full transition-[width] duration-500"
                label={`${l.name}: ${fmt(l.target)} (${l.percentOfPayable.toFixed(1)}% of actual spend)${l.locked ? ' · locked' : ''}`}
                style={{
                  width: `${(l.target / meterBasis) * 100}%`,
                  background: campaignColor(l.colorIndex),
                  // A locked carve-out is hatched so it reads as protected in
                  // the bar, not only in the row.
                  backgroundImage: l.locked
                    ? 'repeating-linear-gradient(45deg, rgba(255,255,255,.35) 0 3px, transparent 3px 6px)'
                    : undefined,
                  borderRight: '1px solid var(--background)',
                }}
              />
            ))}
          {view.totals.unallocated > 0.005 && (
            <Tooltip
              className="h-full"
              label={`Unallocated: ${fmt(view.totals.unallocated)}`}
              style={{
                width: `${(view.totals.unallocated / meterBasis) * 100}%`,
                background: 'var(--border)',
              }}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-xs text-[var(--muted-foreground)]">
            Allocated{' '}
            <span className="font-bold" style={{ color: allocColor }}>
              {fmt(view.totals.allocated)}
            </span>{' '}
            of {fmt(view.totals.denominator)} {denominatorNoun(view)}
          </div>
          {!view.totals.fullyAllocated && (
            <div className="text-xs font-bold" style={{ color: allocColor }}>
              {view.totals.unallocated > 0
                ? `${fmt(view.totals.unallocated)} unallocated`
                : `${fmt(-view.totals.unallocated)} over`}
            </div>
          )}
          {view.totals.lockedTarget > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
              <LockClosedIcon className="h-3 w-3" />
              {fmt(view.totals.lockedTarget)} locked
            </div>
          )}
          {/* §12 — the reserve is inside the allocation but outside every pacing
              figure, so the account's expected-MTD and daily-needed are lower
              than the allocation alone would imply. Say so here rather than
              leaving someone to reconcile the gap themselves. */}
          {view.totals.reservedTarget > 0 && (
            <Tooltip label="Committed to campaigns that cannot spend yet. Counted in the allocation and the payable check, and excluded from Expected MTD, the account pace, the daily needed and the push.">
              <div
                className="flex cursor-help items-center gap-1.5 text-xs"
                style={{ color: COLORS.lifetime }}
              >
                <ArchiveBoxIcon className="h-3 w-3" />
                {fmt(view.totals.reservedTarget)} reserved
              </div>
            </Tooltip>
          )}
          <div className="ml-auto text-xs text-[var(--muted-foreground)]">
            {fmt(Math.max(0, view.totals.denominator - view.totals.spent))} left to spend ·{' '}
            <span className="font-bold text-[var(--foreground)]">
              {fmt(view.totals.accountDaily)}/day
            </span>{' '}
            across campaigns
          </div>
        </div>

        {/* The two numbers the day's work actually turns on, at a size you can
            read across a desk. Collapsed by default so the panel stays a bar. */}
        {spendOpen && (
          <div className="mt-4 grid grid-cols-1 gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Left to spend
              </div>
              <div className="mt-1 text-3xl font-bold tabular-nums leading-tight text-[var(--foreground)]">
                {fmt(Math.max(0, view.totals.denominator - view.totals.spent))}
              </div>
              <div className="mt-1 text-xs text-[var(--muted-foreground)]">
                {fmt(view.totals.denominator)} {denominatorNoun(view)} − {fmt(view.totals.spent)} spent
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Daily budget needed
              </div>
              <div
                className="mt-1 text-3xl font-bold tabular-nums leading-tight"
                style={{ color: 'var(--primary)' }}
              >
                {fmt(view.totals.accountDaily)}
                <span className="text-base font-semibold text-[var(--muted-foreground)]">/day</span>
              </div>
              <div className="mt-1 text-xs text-[var(--muted-foreground)]">
                Across {view.visible.filter((l) => l.dailyControllable).length} campaign
                {view.visible.filter((l) => l.dailyControllable).length === 1 ? '' : 's'}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Days left
              </div>
              <div className="mt-1 text-3xl font-bold tabular-nums leading-tight text-[var(--foreground)]">
                {Math.max(0, clock.daysInMonth - clock.dataEdgeDay)}
              </div>
              <div className="mt-1 text-xs text-[var(--muted-foreground)]">
                of {clock.daysInMonth} — counted from the data edge, whole days
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Header: what you're looking at (left) and when (right), then the
          actions on their own row. Two rows so nothing sits on top of anything
          else, and the two identity facts share a baseline. */}
      <div className="mb-3 mt-6 flex flex-wrap items-start justify-between gap-4">
        <span className="text-lg font-bold tracking-tight text-[var(--foreground)]">
          {ads.length} Campaign{ads.length === 1 ? '' : 's'}{' '}
          <span className="font-normal text-[var(--muted-foreground)]">
            · {periodLabel(period)}
          </span>
        </span>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2">
            <span className="text-base font-bold tracking-tight text-[var(--foreground)]">
              {clock.todayDay != null
                ? `Day ${clock.todayDay} of ${clock.daysInMonth}`
                : `${clock.daysInMonth}-day month`}
            </span>
            {clock.stale && (
              <Tooltip label="Spend and the day count both stop at the last settled day, so the recommendation stays honest — but a fresh sync will move it.">
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: COLORS.warn }}
                >
                  <ArrowPathIcon className="h-3 w-3" />
                  Sync behind
                </span>
              </Tooltip>
            )}
          </div>
          <div className="text-xs text-[var(--muted-foreground)]">
            {clock.dataEdgeIso
              ? `data through ${fmtDate(clock.dataEdgeIso)}`
              : 'no settled days yet'}
          </div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip
            label={
              !googleConnected
                ? 'Connect Google Ads to push budgets'
                : applyAllChanges.length === 0
                  ? 'Nothing to apply in a batch — every campaign is already within the drift threshold of its recommended daily. You can still apply an individual campaign from its row.'
                  : `Apply all ${applyAllChanges.length} drifted campaign${applyAllChanges.length === 1 ? '' : 's'} at once. You will see the full list and confirm before anything is written. Applying one campaign at a time from its row is usually the better habit — this is here for when the whole plan already looks right.`
            }
          >
            <button
              type="button"
              onClick={requestApplyAll}
              disabled={readOnly || pushing || !googleConnected || applyAllChanges.length === 0}
              aria-label="Apply recommended daily budgets"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] transition-colors hover:border-[var(--primary)]/40 hover:bg-[var(--primary)]/10 hover:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pushing ? (
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
              ) : (
                <BoltIcon className="h-4 w-4" />
              )}
            </button>
          </Tooltip>
          <BalanceButton readOnly={readOnly} onBalance={doBalance} />
          <Tooltip
            label={
              compareIds.size < COMPARE_MIN
                ? `Tick ${COMPARE_MIN - compareIds.size} more campaign${COMPARE_MIN - compareIds.size === 1 ? '' : 's'} to compare them side by side — metrics as rows, campaigns as columns.`
                : `Compare these ${compareIds.size} side by side, then move budget between them without re-picking.`
            }
          >
            <button
              type="button"
              onClick={() => setCompareOpen(true)}
              disabled={compareIds.size < COMPARE_MIN}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ViewColumnsIcon className="h-4 w-4" />
              Compare
              {compareIds.size > 0 && (
                <span className="tabular-nums text-[var(--muted-foreground)]">
                  ({compareIds.size})
                </span>
              )}
            </button>
          </Tooltip>
          <Tooltip label="Shift budget between campaigns without changing the account total.">
            <button
              type="button"
              onClick={() => {
                setMovePreload([]);
                setMoveOpen(true);
              }}
              disabled={readOnly}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowsRightLeftIcon className="h-4 w-4" />
              Move budget
            </button>
          </Tooltip>
          <button
            type="button"
            onClick={undo}
            disabled={readOnly || undoStack.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUturnLeftIcon className="h-4 w-4" />
            Undo
          </button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5">
            {(
              [
                ['table', 'Table', TableCellsIcon],
                ['cards', 'Cards', Squares2X2Icon],
              ] as const
            ).map(([value, label, Icon]) => (
              <Tooltip key={value} label={`${label} view`}>
                <button
                  type="button"
                  onClick={() => setLayout(value)}
                  aria-pressed={layout === value}
                  aria-label={`${label} view`}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                    layout === value
                      ? 'bg-[var(--primary)] text-white'
                      : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </button>
              </Tooltip>
            ))}
          </div>
          <LabelFilterBar
            ads={ads}
            activeLabel={activeLabel}
            onChange={setActiveLabel}
            className="mb-0"
          />
          {tableActions}
        </div>
      </div>

      {/* Event budget check — only meaningful inside a label view (§9). */}
      {view.activeLabel && (
        <EventBudgetBar
          label={view.activeLabel}
          value={view.eventBudget}
          allocated={view.totals.allocated}
          matched={view.totals.fullyAllocated}
          readOnly={readOnly}
          onChange={(amount) => {
            const next = { ...eventBudgets };
            if (amount == null || amount <= 0) delete next[view.activeLabel as string];
            else next[view.activeLabel as string] = amount;
            setEventBudgets(next);
            onPersist({ eventBudgets: next });
          }}
        />
      )}

      {layout === 'cards' ? (
        /* Card view — same AllocatorLine as the table, so the two can never
           disagree; only the layout differs. */
        <div>
          {rows.map((line) => (
            <GoogleCampaignCard
              key={line.id}
              line={line}
              ad={adsById.get(line.id)}
              mode={mode}
              payable={payable}
              daysInMonth={clock.daysInMonth}
              allLabels={allLabels}
              readOnly={readOnly}
              expanded={expandedIds.has(line.id)}
              onToggleExpanded={() => toggleExpanded(line.id)}
              onInput={(value) => applyInputs(new Map([[line.id, value]]))}
              onToggleLock={() => updateAd(line.id, { pacerLocked: !line.locked })}
              onTagsChange={(tags) => updateAd(line.id, { pacerTags: serializeTags(tags) })}
              deliveryOpen={deliveryIds.has(line.id)}
              onToggleDelivery={() => toggleDelivery(line.id)}
              onFlightChange={(startDay, endDay) => setFlight(line.id, startDay, endDay)}
              delivery={
                deliveryIds.has(line.id) ? (
                  <GoogleDeliveryExpander
                    accountKey={accountKey}
                    period={period}
                    line={line}
                    ad={adsById.get(line.id)}
                    daysInMonth={clock.daysInMonth}
                    readOnly={readOnly}
                    onFlightChange={(startDay, endDay) => setFlight(line.id, startDay, endDay)}
                    onSyncFromGoogle={googleConnected ? onSyncFromGoogle : undefined}
                    syncing={syncing}
                  />
                ) : null
              }
            />
          ))}
          {rows.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--border)] px-6 py-10 text-center text-sm text-[var(--muted-foreground)]">
              No campaigns match this view.
            </div>
          )}
          {/* Totals, on the SAME column widths as every header line above so the
              list reads as a table. */}
          <div className="glass-section-card mt-2 flex items-center gap-3 rounded-xl px-4 py-3">
            <span className="min-w-0 flex-1 pl-[1.625rem] text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {view.activeLabel ? 'Campaign total' : 'Account total'}
            </span>
            <div className={`${COL.allocation} flex-shrink-0 text-right`}>
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                Allocation
              </div>
              <div className="text-sm font-bold tabular-nums text-[var(--foreground)]">
                {mode === 'pct'
                  ? `${view.visible.reduce((sum, l) => sum + l.input, 0).toFixed(1)}%`
                  : fmt(view.totals.allocated)}
              </div>
            </div>
            <div className={`${COL.spent} hidden flex-shrink-0 text-right sm:block`}>
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                Spent MTD
              </div>
              <div className="text-sm font-bold tabular-nums" style={{ color: COLORS.daily }}>
                {fmt(view.totals.spent)}
              </div>
            </div>
            <div className={`${COL.daily} hidden flex-shrink-0 text-right sm:block`}>
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                Current Daily
              </div>
              <div className="text-sm font-bold tabular-nums text-[var(--foreground)]">
                {fmt(view.visible.reduce((sum, l) => sum + l.currentDaily, 0))}
              </div>
            </div>
            <div className={`${COL.pace} flex-shrink-0 text-right`}>
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                New Daily
              </div>
              <div className="text-sm font-bold tabular-nums" style={{ color: 'var(--primary)' }}>
                {fmt(view.totals.accountDaily)}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="glass-table">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px]">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]">
                  <th className="w-10 px-2 py-2" />
                  <Th align="left">Campaign</Th>
                  <Th className="w-[170px]">
                    <span className="inline-flex items-center gap-1.5">
                      Allocation
                      {/* The unit belongs to this column — it shows the current
                          one and switches on click. */}
                      <Tooltip
                        label={
                          mode === 'pct'
                            ? 'Allocating by percent of the month’s actual spend — click to switch to dollar amounts.'
                            : 'Allocating by fixed dollar amounts — click to switch to percent of actual spend.'
                        }
                      >
                        <button
                          type="button"
                          onClick={() => switchMode(mode === 'pct' ? 'amt' : 'pct')}
                          disabled={readOnly}
                          aria-label={`Allocating by ${mode === 'pct' ? 'percent' : 'dollars'} — switch unit`}
                          className="inline-flex h-5 w-5 items-center justify-center rounded border border-[var(--border)] bg-[var(--card)] text-[11px] font-bold text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {mode === 'pct' ? '%' : '$'}
                        </button>
                      </Tooltip>
                    </span>
                  </Th>
                  <Th>Target Spend</Th>
                  <Th>Spent MTD</Th>
                  <Th tooltip="Target × (flight days elapsed ÷ total flight days) — what should have been spent by now at an even pace.">
                    Expected MTD
                  </Th>
                  <Th align="left">Pace</Th>
                  <Th tooltip="The average daily budget this campaign currently has in Google. The New Daily Budget beside it is what it should be — the gap is what a push would change.">
                    Current Daily
                  </Th>
                  <Th
                    hero
                    tooltip="(Monthly target − spent) ÷ remaining flight days. Set this as the campaign's daily budget in Google today to land on target."
                  >
                    New Daily Budget
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((line) => (
                  <Row
                    key={line.id}
                    line={line}
                    ad={adsById.get(line.id)}
                    mode={mode}
                    payable={payable}
                    allLabels={allLabels}
                    readOnly={readOnly}
                    accountKey={accountKey}
                    period={period}
                    daysInMonth={clock.daysInMonth}
                    dataEdgeIso={clock.dataEdgeIso}
                    onSyncFromGoogle={googleConnected ? onSyncFromGoogle : undefined}
                    syncing={syncing}
                    deliveryOpen={deliveryIds.has(line.id)}
                    onInput={(value) => applyInputs(new Map([[line.id, value]]))}
                    onToggleLock={() => updateAd(line.id, { pacerLocked: !line.locked })}
                    onToggleReserved={() =>
                      updateAd(line.id, { pacerReserved: !line.reserved })
                    }
                    onTagsChange={(tags) => updateAd(line.id, { pacerTags: serializeTags(tags) })}
                    onToggleDelivery={() => toggleDelivery(line.id)}
                    onFlightChange={(startDay, endDay) => setFlight(line.id, startDay, endDay)}
                    compareSelected={compareIds.has(line.id)}
                    compareDisabled={compareIds.size >= COMPARE_MAX}
                    onToggleCompare={() => toggleCompare(line.id)}
                    pushing={pushing}
                    googleConnected={googleConnected}
                    onApply={requestApply}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-3 py-10 text-center text-sm text-[var(--muted-foreground)]"
                    >
                      No campaigns match this view.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--border)] bg-[var(--muted)]/60">
                  <td />
                  <td className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    {view.activeLabel ? 'Campaign total' : 'Account total'}
                  </td>
                  <td className="px-3 py-3 text-right text-sm font-bold tabular-nums">
                    {mode === 'pct'
                      ? `${view.visible.reduce((s, l) => s + l.input, 0).toFixed(1)}%`
                      : fmt(view.totals.allocated)}
                  </td>
                  <td className="px-3 py-3 text-right text-sm font-bold tabular-nums">
                    {fmt(view.totals.allocated)}
                  </td>
                  <td className="px-3 py-3 text-right text-sm font-bold tabular-nums">
                    {fmt(view.totals.spent)}
                  </td>
                  <td className="px-3 py-3 text-right text-sm font-bold tabular-nums">
                    {fmt(view.totals.expected)}
                  </td>
                  <td />
                  <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-[var(--muted-foreground)]">
                    {fmt(view.visible.reduce((sum, l) => sum + l.currentDaily, 0))}
                  </td>
                  <td className="bg-[var(--muted)]/40 px-3 py-3 text-right">
                    <span
                      className="text-sm font-bold tabular-nums"
                      style={{ color: 'var(--primary)' }}
                    >
                      {fmt(view.totals.accountDaily)}
                    </span>
                    {/* §14 — what is actually set in Google right now, beside
                        what the plan wants. The recommended total is a property
                        of targets and spend, so it does NOT move when you apply;
                        only this one does. A gap is the honest picture of an
                        account where some campaigns cannot absorb what even-pace
                        math wants to give them — and it points at what to solve
                        with a move, which is why it is surfaced rather than
                        quietly reconciled. */}
                    <LiveDailyTotal
                      recommended={view.totals.accountDaily}
                      live={liveAccountDaily}
                      unapplied={applyAllChanges.length}
                    />
                    <Tooltip
                      label={
                        view.totals.fullyAllocated
                          ? 'The plan totals the denominator, so this daily total is what Google Ads Manager should show after applying.'
                          : 'The plan does not total the denominator — balance it before applying, or the account daily total will not match.'
                      }
                    >
                      <span
                        className="ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                        style={{
                          background: view.totals.fullyAllocated
                            ? 'rgba(34,197,94,0.16)'
                            : 'rgba(239,68,68,0.16)',
                          color: view.totals.fullyAllocated ? COLORS.success : COLORS.error,
                        }}
                      >
                        {view.totals.fullyAllocated ? 'Matches' : 'Off'}
                      </span>
                    </Tooltip>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {pendingApply != null && (
        <GoogleApplyConfirmModal
          changes={pendingApply.changes}
          pushing={pushing}
          onClose={() => setPendingApply(null)}
          onConfirm={() => {
            // Single: name the campaign, which tells the server to honour it
            // even below the drift threshold. All: send nothing and let the
            // server rebuild the batch from stored allocations.
            onPushBudgets(
              pendingApply.mode === 'single' ? pendingApply.changes.map((c) => c.id) : undefined,
            );
            setPendingApply(null);
          }}
        />
      )}

      {compareOpen && compareLines.length >= COMPARE_MIN && (
        <GoogleCompareModal
          lines={compareLines}
          adsById={adsById}
          onClose={() => setCompareOpen(false)}
          onMove={() => {
            // Hand the compared set straight to Move as its destinations and
            // close the grid. The source stays unpicked on purpose: Compare says
            // which campaigns are in play, not which one gives — that is the
            // decision the grid was opened to inform.
            setMovePreload(compareLines.map((l) => l.id));
            setCompareOpen(false);
            setMoveOpen(true);
          }}
        />
      )}

      {moveOpen && (
        <MoveBudgetModal
          accountKey={accountKey}
          period={period}
          initialDestinationIds={movePreload}
          view={view}
          mode={mode}
          payable={payable}
          readOnly={readOnly}
          onClose={() => setMoveOpen(false)}
          onCommit={(inputs, summary) => {
            applyInputs(inputs);
            toast.success(summary);
            setMoveOpen(false);
          }}
        />
      )}

    </div>
  );
}

function denominatorNoun(view: AllocatorView): string {
  return view.denominatorKind === 'payable'
    ? 'actual spend'
    : view.denominatorKind === 'eventBudget'
      ? 'event budget'
      : 'campaign total';
}

/** Headline stat. Same surface as the allocation container below it
 *  (glass-section-card) so the strip and the bar read as one panel split into
 *  parts, rather than two different kinds of card stacked. */
function StatCard({
  label,
  value,
  sub,
  color,
  tooltip,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  tooltip?: string;
}) {
  const body = (
    <div className="glass-section-card w-full rounded-xl px-4 py-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </div>
      <div
        className="mt-1 text-2xl font-bold tabular-nums leading-tight"
        style={{ color: color ?? 'var(--foreground)' }}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-[var(--muted-foreground)]">{sub}</div>}
    </div>
  );
  return tooltip ? (
    <Tooltip label={tooltip} className="w-full">
      {body}
    </Tooltip>
  ) : (
    body
  );
}

/** Table header cell — Planner's exact chrome, with an optional tooltip and the
 *  hero tint for the one column that is an instruction rather than a reading. */
function Th({
  children,
  align = 'right',
  hero = false,
  tooltip,
  className = '',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  hero?: boolean;
  tooltip?: string;
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-2 text-xs font-medium uppercase tracking-wider ${
        align === 'left' ? 'text-left' : 'text-right'
      } ${hero ? 'bg-[var(--muted)]/60 text-[var(--primary)]' : 'text-[var(--muted-foreground)]'} ${className}`}
    >
      {tooltip ? (
        <Tooltip label={tooltip}>
          <span className="cursor-help">{children}</span>
        </Tooltip>
      ) : (
        children
      )}
    </th>
  );
}

/**
 * §9 the label's intended budget. Optional — when set, the tagged allocation is
 * checked against it, which is how added sales dollars get confirmed as fully
 * placed rather than absorbed into regular budget. Never the account denominator.
 */
function EventBudgetBar({
  label,
  value,
  allocated,
  matched,
  readOnly,
  onChange,
}: {
  label: string;
  value: number | null;
  allocated: number;
  matched: boolean;
  readOnly: boolean;
  onChange: (amount: number | null) => void;
}) {
  const [draft, setDraft] = useState(value != null ? value.toFixed(2) : '');
  useEffect(() => {
    setDraft(value != null ? value.toFixed(2) : '');
  }, [value]);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-3.5 py-2.5">
      <Tooltip
        label={`The budget you intended for “${label}” — e.g. the added sales-event dollars. The tagged allocation is checked against it. This never changes the account's actual spend figure.`}
      >
        <span className="cursor-help text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Event budget
        </span>
      </Tooltip>
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)]">
          $
        </span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const parsed = Number(draft);
            onChange(draft.trim() === '' || !Number.isFinite(parsed) ? null : parsed);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          disabled={readOnly}
          inputMode="decimal"
          placeholder="optional"
          aria-label={`Event budget for ${label}`}
          className="w-32 rounded-lg border border-[var(--border)] bg-[var(--input)] py-1.5 pl-6 pr-2.5 text-sm tabular-nums text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none disabled:opacity-60"
        />
      </div>
      {value != null && value > 0 && (
        <span
          className="text-[11px] font-medium"
          style={{ color: matched ? COLORS.success : COLORS.warn }}
        >
          {matched
            ? `✓ ${fmt(allocated)} allocated — matches`
            : allocated < value
              ? `${fmt(value - allocated)} of the event money is not allocated to these campaigns yet`
              : `${fmt(allocated - value)} more than the event budget is allocated here`}
        </span>
      )}
    </div>
  );
}

/**
 * What Google reports for this campaign right now (§13), as a dot beside the
 * name — and, when it contradicts the team's own Ad Status, a loud one.
 *
 * The mismatch is the point of the pill. A row Loomi is pacing as live that
 * Google has paused is the expensive silent failure: the recommended daily, the
 * account total and the push all keep treating it as a running campaign, and
 * nothing on the card would otherwise say the money is not moving.
 */
function PlatformStatusPill({
  ad,
  mismatch,
}: {
  ad: PacerAd | undefined;
  mismatch: StatusMismatch;
}) {
  if (!ad) return null;
  const status = normalizeAdStatus(ad);
  // Not linked is said elsewhere on the row; a second badge for it is noise.
  if (status === 'Not linked' || status === 'Unknown') return null;
  const tone = adStatusTone(status);
  const color =
    tone === 'good'
      ? COLORS.success
      : tone === 'warn'
        ? COLORS.warn
        : tone === 'bad'
          ? COLORS.error
          : 'var(--muted-foreground)';
  const why = mismatch?.reasons.length
    ? ` Google says ${mismatch.reasons.map(statusReasonText).join(', ')}.`
    : '';
  const label = mismatch
    ? mismatch.kind === 'not_serving'
      ? `Loomi is pacing this as ${ad.adStatus.toLowerCase()}, but Google reports it ${status.toLowerCase()} — it is not serving.${why} Its recommended daily is a number for a campaign that is not running, and pushing it will change nothing.`
      : `Loomi has this as ${ad.adStatus.toLowerCase()}, but Google reports it ${status.toLowerCase()} — it is spending on a line the plan is not pacing.${why}`
    : `Google reports this campaign ${status.toLowerCase()}.${why} Platform status, read-only — it never changes the Ad Status the team sets.`;

  return (
    <Tooltip label={label}>
      {mismatch ? (
        <span
          className="inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ background: `${COLORS.error}1f`, color: COLORS.error }}
        >
          <ExclamationTriangleIcon className="h-3 w-3" />
          {mismatch.kind === 'not_serving' ? `Not serving · ${status}` : `Live in Google`}
        </span>
      ) : (
        <span
          className="inline-flex h-2 w-2 flex-shrink-0 rounded-full"
          style={{ background: color }}
          aria-label={`Google status: ${status}`}
        />
      )}
    </Tooltip>
  );
}

/** Row tag — colored text, no fill. A row can carry several of these at once
 *  (shared + ad schedule + disapproved), and filled badges stacked next to the
 *  campaign name turned the first column into a wall of blocks. */
function Tag({ color, label, tooltip }: { color: string; label: string; tooltip: string }) {
  return (
    <Tooltip label={tooltip}>
      <span
        className="whitespace-nowrap text-[10px] font-bold uppercase tracking-wider"
        style={{ color }}
      >
        {label}
      </span>
    </Tooltip>
  );
}

function Row({
  line,
  ad,
  mode,
  payable,
  allLabels,
  readOnly,
  accountKey,
  period,
  daysInMonth,
  dataEdgeIso,
  onSyncFromGoogle,
  syncing,
  deliveryOpen,
  onInput,
  onToggleLock,
  onToggleReserved,
  onTagsChange,
  onToggleDelivery,
  onFlightChange,
  compareSelected,
  compareDisabled,
  onToggleCompare,
  pushing,
  googleConnected,
  onApply,
}: {
  line: AllocatorLine;
  ad: PacerAd | undefined;
  mode: AllocationMode;
  payable: number;
  allLabels: readonly string[];
  readOnly: boolean;
  accountKey: string;
  period: string;
  daysInMonth: number;
  /** Last whole day with data — keeps today's partial out of the §8 bar read. */
  dataEdgeIso: string | null;
  onSyncFromGoogle?: () => void;
  syncing: boolean;
  deliveryOpen: boolean;
  onInput: (value: number) => void;
  onToggleLock: () => void;
  onToggleReserved: () => void;
  onTagsChange: (tags: string[]) => void;
  onToggleDelivery: () => void;
  onFlightChange: (startDay: number, endDay: number) => void;
  /** §10 Compare selection — the same set Move's second entry point pre-loads. */
  compareSelected: boolean;
  compareDisabled: boolean;
  onToggleCompare: () => void;
  /** §14 per-campaign apply. `pushing` disables every control during a write. */
  pushing: boolean;
  googleConnected: boolean;
  onApply: (change: ApplyChange) => void;
}) {
  // §13 — does the team's Ad Status contradict what Google reports? Display
  // only; it never rewrites either side.
  const mismatch = ad ? statusMismatch(ad) : null;

  // §8 — is this campaign genuinely filling its cap? Never the flag alone: on a
  // Search line it needs real lost impression share behind it, and on a PMax line
  // (no impression share) the recent bars have to actually sit at the cap.
  const atCap = capDelivery({
    budgetConstrained: line.budgetLimited,
    channelType: line.channelType,
    budgetLostIsRaw: ad?.googleSearchBudgetLostIs ?? null,
    series: ad?.dailySpend,
    cap: line.currentDaily,
    dataEdgeIso,
  });
  // §14 — is the recommendation a raise this campaign cannot act on? Reuses the
  // SAME cap read as the tag above, so the row cannot flag a futile raise while
  // simultaneously badging the campaign as delivering to its cap.
  const futileRaise = isFutileRaise({
    currentDaily: line.currentDaily,
    recommendedDaily: line.recommendedDaily,
    delivery: atCap,
  });

  // The tooltip has to bridge DELIVERY and PACE, or the tag reads as a
  // contradiction next to an "underspending" badge on the same row. At cap and
  // behind on the month is not a conflict — it is the whole diagnosis: the cap
  // is what's holding it back.
  const cappedTooltip =
    (atCap.basis === 'budget_lost_is'
      ? `Genuinely budget-limited: Google reports ${Math.round((atCap.budgetLostIs ?? 0) * 100)}% of impressions lost to budget, so there is demand it is turning away. `
      : `Its recent daily spend is sitting at the ${fmt(line.currentDaily)} cap, so it is filling the budget it has. `) +
    (line.paceStatus === 'under'
      ? 'It is still behind for the month because the cap is set low — a higher daily is what catches it up.'
      : line.paceStatus === 'over'
        ? 'It is also ahead of target for the month, so more budget is not the need here.'
        : 'It is on pace for the month.');

  // The recommended daily read against the even pace: up means it has to catch
  // up, down means it has to ease off. Purely directional — the number is the
  // instruction.
  const trend =
    line.currentDaily <= 0
      ? 'flat'
      : line.recommendedDaily > line.currentDaily * 1.02
        ? 'up'
        : line.recommendedDaily < line.currentDaily * 0.98
          ? 'down'
          : 'flat';

  return (
    <>
    <tr
      className={`border-b border-[var(--border)] transition-colors hover:bg-[var(--muted)]/30 ${
        line.locked ? 'bg-[var(--muted)]/20' : ''
      }`}
    >
      <td className="px-2 py-2.5 align-middle">
        <Tooltip
          label={
            line.locked
              ? 'Locked — protected from Balance and from Move. Unlock to let them touch it.'
              : 'Lock this budget — a fixed carve-out Balance and Move leave alone. Locking changes no numbers.'
          }
        >
          <button
            type="button"
            onClick={onToggleLock}
            disabled={readOnly}
            aria-pressed={line.locked}
            aria-label={line.locked ? `Unlock ${line.name}` : `Lock ${line.name}`}
            className={`inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              line.locked
                ? 'border-[var(--foreground)]/30 bg-[var(--foreground)]/10 text-[var(--foreground)]'
                : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--foreground)]/30 hover:text-[var(--foreground)]'
            }`}
          >
            {line.locked ? (
              <LockClosedIcon className="h-3 w-3" />
            ) : (
              <LockOpenIcon className="h-3 w-3" />
            )}
          </button>
        </Tooltip>
        {/* §12 Reserved, next to the lock: the two controls that answer "how may
            this budget be touched". Deliberately a manual toggle and nothing
            else — nothing infers it, because auto-dropping a campaign out of
            pacing off a missing daily would eventually misfire on a merely
            paused live campaign. */}
        <Tooltip
          label={
            line.reserved
              ? `Reserved — ${line.name} is out of Expected MTD, the account pace, the recommended daily and the push, but its target still counts toward the allocation. Un-reserve it when the campaign launches.`
              : `Reserve ${line.name} — for budget committed to a campaign that cannot spend yet (not built, or not linked to Google). It stays in the allocation and leaves every pacing figure, so the account read stops counting money that was never going to be spent this month.`
          }
        >
          <button
            type="button"
            onClick={onToggleReserved}
            disabled={readOnly}
            aria-pressed={line.reserved}
            aria-label={line.reserved ? `Un-reserve ${line.name}` : `Reserve ${line.name}`}
            className={`mt-1 inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              line.reserved
                ? 'border-[var(--foreground)]/30 bg-[var(--foreground)]/10'
                : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--foreground)]/30 hover:text-[var(--foreground)]'
            }`}
            style={line.reserved ? { color: COLORS.lifetime } : undefined}
          >
            <ArchiveBoxIcon className="h-3 w-3" />
          </button>
        </Tooltip>
      </td>

      <td className="px-3 py-2.5 text-left align-middle">
        <div className="flex flex-wrap items-center gap-2">
          {/* §10 selection. It sits with the campaign's identity rather than in
              the control column, which answers a different question ("how may
              this budget be touched"). Disabled past four with the reason, so a
              dead checkbox never reads as a broken one. */}
          <Tooltip
            label={
              compareSelected
                ? `Remove ${line.name} from the comparison.`
                : compareDisabled
                  ? 'Compare holds four campaigns — untick one to swap it out.'
                  : `Add ${line.name} to the comparison.`
            }
          >
            <input
              type="checkbox"
              checked={compareSelected}
              disabled={compareDisabled && !compareSelected}
              onChange={onToggleCompare}
              aria-label={`Compare ${line.name}`}
              className="h-3.5 w-3.5 flex-shrink-0 cursor-pointer rounded border-[var(--border)] accent-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-40"
            />
          </Tooltip>
          <span
            className="h-2 w-2 flex-shrink-0 rounded-sm"
            style={{ background: campaignColor(line.colorIndex) }}
          />
          <span className="text-sm font-semibold text-[var(--foreground)]">{line.name}</span>
          {/* §13 — what Google actually reports for this campaign, on the
              COLLAPSED row so status is legible across every line without
              opening anything. Read-only platform truth: it never touches the
              team's own Ad Status. */}
          <PlatformStatusPill ad={ad} mismatch={mismatch} />
          {!line.flight.fullMonth && (
            <Tooltip label="This campaign's flight window inside the month — it paces against these days, not the whole month.">
              <span className="whitespace-nowrap text-[10px] tabular-nums text-[var(--muted-foreground)]">
                day {line.flight.startDay}–{line.flight.endDay}
              </span>
            </Tooltip>
          )}
          {line.pacingType === 'Total' && (
            <Tag
              color={COLORS.lifetime}
              label="Total"
              tooltip="A total-budget campaign. Google paces it to its own end date, so there's no daily budget to set — it holds an allocation but stays out of the account daily total and the push."
            />
          )}
          {line.shared && (
            <Tag
              color={COLORS.daily}
              label={`Shared${line.sharedCount ? ` ×${line.sharedCount}` : ''}`}
              tooltip={`This campaign shares a Google budget with ${(line.sharedCount ?? 2) - 1} other${(line.sharedCount ?? 2) - 1 === 1 ? '' : 's'}, so its daily can't be set on its own. The push skips it.`}
            />
          )}
          {line.hasAdSchedule && (
            <Tag
              color={COLORS.warn}
              label="Ad schedule"
              tooltip="Runs on an ad schedule (restricted days/dayparts). Google concentrates the monthly cap into its active days, so calendar-day pacing reads it slightly low."
            />
          )}
          {line.disapproved && (
            <Tag
              color={COLORS.error}
              label="Ads disapproved"
              tooltip="At least one ad is disapproved — the budget is sized right but the ads can't serve. Fix the disapprovals; raising the budget won't help."
            />
          )}
          {atCap.atCap && (
            <Tag color={COLORS.success} label="Capped · headroom" tooltip={cappedTooltip} />
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {line.channelType && (
            <span className="text-[11px] text-[var(--muted-foreground)]">{line.channelType}</span>
          )}
          <LabelChips
            tags={ad?.pacerTags}
            allLabels={allLabels}
            readOnly={readOnly}
            onChange={onTagsChange}
          />
        </div>
      </td>

      <td className="px-3 py-2.5 text-right align-middle">
        <div className="inline-flex items-center justify-end gap-1.5">
          {/* Borderless until hovered or focused, like the planner's cells — a
              column of filled inputs reads as a form, not as a table of numbers. */}
          <span className="w-[86px]">
            <InlineMoneyCell
              value={formatInput(line.input, mode)}
              ariaLabel={`${mode === 'pct' ? 'Percent' : 'Dollar'} allocation for ${line.name}`}
              disabled={readOnly}
              display={
                <span className="block text-right text-sm font-semibold tabular-nums text-[var(--foreground)]">
                  {mode === 'pct'
                    ? `${Number(line.input.toFixed(2))}%`
                    : money2(line.input)}
                </span>
              }
              onCommit={(next) => {
                const parsed = Number(next);
                if (next == null || !Number.isFinite(parsed) || parsed < 0) return;
                if (Math.abs(parsed - line.input) > 0.0001) onInput(parsed);
              }}
            />
          </span>
          {mode === 'amt' && (
            // §3 companion readout: in dollar mode each line still shows its
            // share of actual spend, so the plan stays legible without switching.
            <Tooltip label="Share of the month's actual spend">
              <span className="w-9 text-left text-[10px] tabular-nums text-[var(--muted-foreground)]">
                {payable > 0 ? `${line.percentOfPayable.toFixed(1)}%` : '—'}
              </span>
            </Tooltip>
          )}
        </div>
      </td>

      <td className="px-3 py-2.5 text-right align-middle text-sm font-semibold tabular-nums">
        {fmt(line.target)}
      </td>
      <td className="px-3 py-2.5 text-right align-middle text-sm tabular-nums text-[var(--muted-foreground)]">
        {fmt(line.spentMTD)}
      </td>
      <td className="px-3 py-2.5 text-right align-middle text-sm tabular-nums text-[var(--muted-foreground)]">
        {fmt(line.expectedToDate)}
      </td>

      <td className="px-3 py-2.5 text-left align-middle">
        <div className="flex items-center gap-1.5">
          {line.reserved ? (
            /* §12 — a reserve is not underspending, it is money set aside for a
               campaign that cannot spend yet. Showing "0% of pace" here is a
               false alarm about a campaign doing exactly what was intended. */
            <Tooltip label="Reserved — budget committed to a campaign that cannot spend yet. It counts toward the account allocation but is out of Expected MTD, the account pace, the recommended daily and the push. Un-reserve it when the campaign launches; it will then pace its full target over the days that are left.">
              <span
                className="inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                style={{ background: `${COLORS.lifetime}1f`, color: COLORS.lifetime }}
              >
                <ArchiveBoxIcon className="h-3 w-3" />
                Reserved
              </span>
            </Tooltip>
          ) : (
          <Tooltip
            label={
              deliveryOpen
                ? 'Hide delivery detail'
                : 'Show delivery detail — is it spending its full daily, and can it absorb more? Open as many rows as you like.'
            }
          >
            <button
              type="button"
              onClick={onToggleDelivery}
              aria-expanded={deliveryOpen}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)] transition-opacity hover:opacity-70"
            >
              <span style={{ color: PACE_COLORS[line.paceStatus] }}>
                {PACE_LABELS[line.paceStatus]}
              </span>
              {deliveryOpen ? (
                <ChevronDownIcon className="h-3 w-3 text-[var(--muted-foreground)]" />
              ) : (
                <ChevronRightIcon className="h-3 w-3 text-[var(--muted-foreground)]" />
              )}
            </button>
          </Tooltip>
          )}
        </div>
        {!line.reserved && line.expectedToDate > 0 && (
          <div className="mt-0.5 text-[10px] tabular-nums text-[var(--muted-foreground)]">
            {line.paceRatio != null && `${Math.round(line.paceRatio * 100)}% · `}
            <span style={{ color: line.paceDelta >= 0 ? COLORS.warn : COLORS.lifetime }}>
              {line.paceDelta >= 0 ? '+' : '−'}
              {fmt(Math.abs(line.paceDelta))}
            </span>{' '}
            vs expected
          </div>
        )}
      </td>

      <td className="px-3 py-2.5 text-right align-middle text-sm tabular-nums text-[var(--muted-foreground)]">
        {line.currentDaily > 0 ? (
          fmt(line.currentDaily)
        ) : (
          <Tooltip label="No daily budget synced from Google yet — import or sync this campaign.">
            <span>—</span>
          </Tooltip>
        )}
      </td>

      <td className="bg-[var(--muted)]/40 px-3 py-2.5 text-right align-middle">
        {line.dailyControllable ? (
          <div className="flex items-center justify-end gap-1">
            {/* §14 — the PRIMARY apply control: one campaign, one deliberate
                action, right beside the number it writes. Apply-all still
                exists in the toolbar but is deliberately not the thumb-target,
                because this team looks before it acts and a one-click push of
                every drifted campaign is the riskier default. */}
            <ApplyButton
              line={line}
              ad={ad}
              futile={futileRaise}
              pushing={pushing}
              disabled={readOnly || !googleConnected}
              onApply={onApply}
            />
            <span className="text-sm font-bold tabular-nums text-[var(--foreground)]">
              {fmt(line.recommendedDaily)}
            </span>
            {trend !== 'flat' && (
              <Tooltip
                label={
                  trend === 'up'
                    ? 'Higher than the daily currently set in Google — raise it to land on target.'
                    : 'Lower than the daily currently set in Google — ease it off to land on target.'
                }
              >
                {trend === 'up' ? (
                  <ArrowSmallUpIcon
                    className="h-3.5 w-3.5 stroke-[2.5]"
                    style={{ color: COLORS.lifetime }}
                    aria-label="above even pace"
                  />
                ) : (
                  <ArrowSmallDownIcon
                    className="h-3.5 w-3.5 stroke-[2.5]"
                    style={{ color: COLORS.warn }}
                    aria-label="below even pace"
                  />
                )}
              </Tooltip>
            )}
          </div>
        ) : (
          <Tooltip label="Google paces a total budget to its own end date — there's no daily rate to set.">
            <span className="text-xs text-[var(--muted-foreground)]">—</span>
          </Tooltip>
        )}
      </td>
    </tr>
    {/* The delivery panel, full width beneath its own row (§1). It sits INSIDE
        the table rather than floating over it so the surrounding rows stay
        readable — the point of the panel is comparing this campaign against the
        ones above and below it. */}
    {deliveryOpen && (
      <tr className="border-b border-[var(--border)]">
        <td colSpan={9} className="p-0">
          <GoogleDeliveryExpander
            accountKey={accountKey}
            period={period}
            line={line}
            ad={ad}
            daysInMonth={daysInMonth}
            readOnly={readOnly}
            onFlightChange={onFlightChange}
            onSyncFromGoogle={onSyncFromGoogle}
            syncing={syncing}
          />
        </td>
      </tr>
    )}
    </>
  );
}

function formatInput(value: number, mode: AllocationMode): string {
  return mode === 'pct' ? String(Number(value.toFixed(2))) : value.toFixed(2);
}

// ── §12 balance split button ──

function BalanceButton({
  readOnly,
  onBalance,
}: {
  readOnly: boolean;
  onBalance: (mode: BalanceMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <Tooltip label="Scale the unlocked lines so the plan totals the actual spend, keeping their relative shape. Locked lines are never touched.">
        <button
          type="button"
          onClick={() => onBalance('proportional')}
          disabled={readOnly}
          className="rounded-l-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Balance
        </button>
      </Tooltip>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={readOnly}
        aria-label="Balance options"
        aria-expanded={open}
        className="rounded-r-lg border border-l-0 border-[var(--border)] bg-[var(--card)] px-2 py-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronDownIcon className="h-4 w-4" />
      </button>
      {/* Same opaque surface as the card's other dropdowns — this opens over the
          campaign table, where a translucent panel reads straight through
          (unlike the full modals, which sit on a dimmed overlay). */}
      {open && (
        <div className="animate-dropdown-in absolute bottom-full left-0 z-40 mb-1.5 w-64 rounded-lg border border-[var(--border)] bg-[var(--card-strong)] p-1 shadow-xl backdrop-blur-2xl backdrop-saturate-150">
          {(
            [
              ['proportional', 'Keep proportions', 'Scale unlocked lines, hold their shape', true],
              ['even', 'Even split', 'Set all unlocked lines equal', false],
            ] as const
          ).map(([value, title, sub, isDefault]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setOpen(false);
                onBalance(value);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--muted)]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-[var(--foreground)]">{title}</span>
                <span className="block text-[10px] text-[var(--muted-foreground)]">{sub}</span>
              </span>
              {isDefault && (
                <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--primary)]">
                  default
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── §8 move / distribute panel ──

/**
 * Hold a typed amount at or below the movable cap (§9). The cap is the ONE hard
 * limit in the Move tool, so it is enforced at the keystroke rather than as a
 * validation message after the fact — a number that cannot be committed should
 * not be typeable.
 *
 * Partial input ("", "12.") passes through untouched; clamping mid-keystroke
 * would fight the person typing.
 */
/**
 * The per-campaign apply control (§14).
 *
 * Three states, and the disabled one is the point: a campaign that cannot be
 * pushed says WHY on the control itself. A dead button with no explanation reads
 * as broken, and the reason here is usually the actual next action — "shared
 * budget, set it in Google" tells you where to go. Reserved campaigns get no
 * control at all rather than a disabled one: there is nothing to push and never
 * will be while the line is reserved, so an inert button would only invite the
 * question.
 */
/**
 * Plan total vs live total (§14). Two numbers that answer different questions:
 * what the plan wants set, and what is set. They match when everything is
 * applied and nothing has drifted; otherwise the gap IS the state of the
 * account, and a partial apply becomes visible and actionable instead of a
 * silent discrepancy.
 *
 * A healthy end state frequently is NOT "all applied" — you apply the working
 * raises and the cuts, leave the demand-limited underspenders alone, and move
 * their stranded budget. So the gap is reported without a nag to close it.
 */
function LiveDailyTotal({
  recommended,
  live,
  unapplied,
}: {
  recommended: number;
  live: number;
  unapplied: number;
}) {
  const inSync = moneyEq(recommended, live);
  const delta = live - recommended;
  return (
    <Tooltip
      label={
        inSync
          ? 'What the plan wants and what Google currently holds are the same. Nothing to apply.'
          : `Google currently holds ${fmt(live)}/day across these campaigns; the plan wants ${fmt(recommended)}/day. ${
              unapplied > 0
                ? `${unapplied} campaign${unapplied === 1 ? '' : 's'} past the drift threshold ${unapplied === 1 ? 'is' : 'are'} un-applied.`
                : 'The difference is in campaigns below the drift threshold.'
            } Applying never changes the plan total — only the live one moves.`
      }
    >
      <span className="mt-0.5 block cursor-help text-[10px] tabular-nums text-[var(--muted-foreground)]">
        {inSync ? (
          <span style={{ color: COLORS.success }}>in sync</span>
        ) : (
          <>
            live {fmt(live)}
            <span className="ml-1" style={{ color: delta > 0 ? COLORS.warn : COLORS.daily }}>
              ({delta > 0 ? '+' : '−'}
              {fmt(Math.abs(delta))})
            </span>
          </>
        )}
      </span>
    </Tooltip>
  );
}

function ApplyButton({
  line,
  ad,
  futile,
  pushing,
  disabled,
  onApply,
}: {
  line: AllocatorLine;
  ad: PacerAd | undefined;
  futile: boolean;
  pushing: boolean;
  disabled: boolean;
  onApply: (change: ApplyChange) => void;
}) {
  const eligibility = applyEligibility(line, ad?.googleBudgetResourceName ?? null);
  // §12 — reserved lines are out of pacing entirely; no control, not a dead one.
  if (eligibility.reason === 'reserved') return null;

  const pushedAt = ad?.googleDailyPushedAt ? new Date(ad.googleDailyPushedAt) : null;
  // Google re-paces over 24–48h, so a push inside that window is still settling
  // and the numbers on this row still describe the OLD rate.
  const settling =
    pushedAt != null && Date.now() - pushedAt.getTime() < GOOGLE_SETTLING_HOURS * 3600 * 1000;
  const matches = moneyEq(line.recommendedDaily, line.currentDaily);

  if (!eligibility.ok && eligibility.reason) {
    return (
      <Tooltip label={applyBlockedReason(eligibility.reason)}>
        <span
          aria-label={`Cannot apply ${line.name}: ${applyBlockedReason(eligibility.reason)}`}
          className="inline-flex h-6 w-6 cursor-not-allowed items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] opacity-40"
        >
          <NoSymbolIcon className="h-3 w-3" />
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip
      label={
        matches
          ? `${line.name} is already set to ${fmt(line.recommendedDaily)}/day in Google. Applying again would rewrite the same rate.`
          : settling
            ? `Applied ${fmtRelativeHours(pushedAt as Date)}. Google re-paces over 24–48 hours, so today's spend still reflects the old rate — you can push again, but the numbers have not caught up yet.`
            : futile
              ? `Set ${line.name} to ${fmt(line.recommendedDaily)}/day in Google. Note: it is not spending the daily it already has, so the raise is unlikely to move spend — this is budget worth moving instead.`
              : `Set ${line.name} to ${fmt(line.recommendedDaily)}/day in Google. You will confirm the change first.`
      }
    >
      <button
        type="button"
        disabled={disabled || pushing}
        onClick={() =>
          onApply({
            id: line.id,
            name: line.name,
            currentDaily: line.currentDaily,
            newDaily: line.recommendedDaily,
            futile,
          })
        }
        aria-label={`Apply ${fmt(line.recommendedDaily)} daily budget to ${line.name}`}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          borderColor: settling ? COLORS.daily : 'var(--border)',
          color: matches ? 'var(--muted-foreground)' : settling ? COLORS.daily : 'var(--primary)',
        }}
      >
        {settling ? <ClockIcon className="h-3 w-3" /> : <BoltIcon className="h-3 w-3" />}
      </button>
    </Tooltip>
  );
}

/** "3 hours ago" / "yesterday" — enough precision to judge a settling window. */
function fmtRelativeHours(at: Date): string {
  const hours = Math.floor((Date.now() - at.getTime()) / 3600000);
  if (hours < 1) return 'just now';
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  return hours < 48 ? 'yesterday' : `${Math.floor(hours / 24)} days ago`;
}

function capAmount(raw: string, cap: number): string {
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(n)) return raw;
  const ceiling = Math.max(0, cap);
  return n > ceiling ? String(Number(ceiling.toFixed(2))) : raw;
}

function MoveBudgetModal({
  accountKey,
  period,
  view,
  mode,
  payable,
  readOnly,
  initialDestinationIds,
  onClose,
  onCommit,
}: {
  accountKey: string;
  period: string;
  view: AllocatorView;
  mode: AllocationMode;
  payable: number;
  readOnly: boolean;
  /**
   * §9's two entry points, one engine. Opened from the toolbar this is empty and
   * nothing is pre-selected; opened from Compare it carries the compared set as
   * destinations so the move needs no re-picking. Only what is pre-filled
   * differs — every rule, cap, warning and recompute below is identical, because
   * a move that behaved differently depending on which button opened it would be
   * two tools wearing one name.
   */
  initialDestinationIds?: readonly string[];
  onClose: () => void;
  onCommit: (inputs: Map<string, number>, summary: string) => void;
}) {
  const [sourceKey, setSourceKey] = useState<string>('');
  const [method, setMethod] = useState<MoveMethod>('even');
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialDestinationIds ?? []),
  );
  const [evenTotal, setEvenTotal] = useState('');
  const [custom, setCustom] = useState<Record<string, string>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Locked lines are out of both lists (§4). The active label view scopes them
  // too: moving budget between a label's campaigns must not reach outside it.
  const options = useMemo(() => view.visible.filter((l) => !l.locked), [view.visible]);
  // Unallocated is only offered unfiltered — inside a label view the leftover
  // belongs to the account, not the label, and spending it there would quietly
  // pull account budget into an event (§9).
  const leftover = view.denominatorKind === 'payable' ? Math.max(0, view.totals.unallocated) : 0;
  const offerUnallocated = leftover > 0.005;

  // Drop selections that stop being valid when the filter or the locks change.
  useEffect(() => {
    setSelected((prev) => {
      const valid = new Set(options.map((o) => o.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [options]);

  const source: MoveSource | null =
    sourceKey === ''
      ? null
      : sourceKey === '__unalloc'
        ? { kind: 'unallocated' }
        : { kind: 'campaign', id: sourceKey };

  const plan = useMemo(() => {
    if (!source) return null;
    return planMove({
      lines: view.visible,
      mode,
      payable,
      source,
      destinationIds: [...selected],
      method,
      evenTotal: Number(evenTotal),
      customAmounts: Object.fromEntries(
        Object.entries(custom).map(([k, v]) => [k, Number(v)]),
      ),
      denominator: view.totals.denominator,
    });
  }, [source, view.visible, view.totals.denominator, mode, payable, selected, method, evenTotal, custom]);

  const available = source
    ? sourceAvailable({ lines: view.visible, source, denominator: view.totals.denominator })
    : 0;

  const commit = () => {
    if (!plan?.ok) return;
    const label = plan.source?.label ?? 'source';
    // The durable record (§9). Fire-and-forget on purpose: the money moves
    // through autosave, and a logging failure must not block or undo a move the
    // person already confirmed. It is logged best-effort and reported quietly.
    void fetch(`/api/google-ads-pacer/${encodeURIComponent(accountKey)}/move-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period,
        sourceId: source?.kind === 'campaign' ? source.id : null,
        total: plan.total,
        allocations: plan.allocations.map((a) => ({ id: a.id, amount: a.amount })),
      }),
    }).catch(() => {
      toast.error('Move applied, but it could not be written to the change log.');
    });
    onCommit(
      plan.inputs,
      `Moved ${fmt(plan.total)} from ${label} across ${plan.allocations.length} campaign${plan.allocations.length === 1 ? '' : 's'}`,
    );
    setSelected(new Set());
    setCustom({});
    setEvenTotal('');
  };

  if (options.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-start justify-center bg-black/50 p-4 backdrop-blur-sm sm:pt-20"
      onClick={onClose}
    >
      <div
        className="glass-modal flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-[var(--foreground)]">Move budget</h3>
            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
              Pull from one source and spread it across the campaigns you pick — the{' '}
              {view.activeLabel ? 'label' : 'account'} total holds steady.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          From
        </span>
        {/* Loomi's searchable combobox rather than a native select: an account
            can carry dozens of campaigns, and it portals so the list isn't
            clipped by the card. Each option carries its campaign color, the same
            swatch used in the meter and the destination chips. */}
        <div className="w-56">
          <SearchableSelect
            value={sourceKey}
            onChange={(value) => {
              setSourceKey(value);
              setSelected((prev) => {
                const next = new Set(prev);
                next.delete(value);
                return next;
              });
            }}
            disabled={readOnly}
            searchable
            placeholder="Choose a source…"
            className="py-2 text-sm"
            options={[
              ...(offerUnallocated
                ? [{ value: '__unalloc', label: `Unallocated (${fmt(leftover)})` }]
                : []),
              ...options.map((o) => ({
                value: o.id,
                // Movable, not target (§9). The picker is where someone decides
                // what to draw from, so showing the full target here would set
                // an expectation the amount field then refuses.
                label: `${o.name} (${fmt(Math.max(0, o.target - o.spentMTD))} movable)`,
                icon: (
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-sm"
                    style={{ background: campaignColor(o.colorIndex) }}
                  />
                ),
              })),
            ]}
          />
        </div>

        <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5">
          {(
            [
              ['even', 'Even split'],
              ['custom', 'Custom amounts'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMethod(value)}
              disabled={readOnly}
              aria-pressed={method === value}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                method === value
                  ? 'bg-[var(--primary)] text-white'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {method === 'even' && (
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)]">
              $
            </span>
            <input
              value={evenTotal}
              // Only clamp once a source is chosen. With no source `available`
              // is 0, and capping against it would make the field refuse every
              // keystroke for anyone who types the amount before picking where
              // it comes from.
              onChange={(e) =>
                setEvenTotal(capAmount(e.target.value, source ? available : Infinity))
              }
              disabled={readOnly}
              inputMode="decimal"
              placeholder="total to spread"
              aria-label="Total to spread"
              className="w-40 rounded-lg border border-[var(--border)] bg-[var(--input)] py-2 pl-6 pr-2.5 text-sm tabular-nums text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none disabled:opacity-60"
            />
          </div>
        )}
        {source && (
          /* Both halves of the cap (§9). "Available" alone reads as arbitrary
             the moment it is smaller than the target on the row above. */
          <Tooltip
            label={
              source.kind === 'campaign'
                ? 'Movable = target − spent MTD. Money already spent has left the account and sits against this campaign in Google, so it cannot be given to another one.'
                : 'The leftover between the plan and the payable — budget never assigned to a campaign.'
            }
          >
            <span className="cursor-help text-[10px] tabular-nums text-[var(--muted-foreground)]">
              {fmt(available)} movable
              {source.kind === 'campaign' && plan != null && plan.sourceSpent > 0 && (
                <> · {fmt(plan.sourceSpent)} already spent</>
              )}
            </span>
          </Tooltip>
        )}
      </div>

      <div className="mb-2 mt-3.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        Spread across
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options
          .filter((o) => o.id !== sourceKey)
          .map((o) => {
            const on = selected.has(o.id);
            return (
              <span key={o.id} className="inline-flex items-stretch">
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(o.id)) {
                        next.delete(o.id);
                        setCustom((c) => {
                          const rest = { ...c };
                          delete rest[o.id];
                          return rest;
                        });
                      } else next.add(o.id);
                      return next;
                    })
                  }
                  aria-pressed={on}
                  className={`inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    on && method === 'custom' ? 'rounded-l-lg border-r-0' : 'rounded-lg'
                  } ${
                    on
                      ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                      : 'border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--muted)]'
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-sm"
                    style={{ background: campaignColor(o.colorIndex) }}
                  />
                  {o.name}
                </button>
                {on && method === 'custom' && (
                  <span className="inline-flex items-center rounded-r-lg border border-[var(--primary)] bg-[var(--input)] pl-1.5 pr-2">
                    <span className="text-[10px] text-[var(--muted-foreground)]">$</span>
                    <input
                      value={custom[o.id] ?? ''}
                      onChange={(e) =>
                        setCustom((c) => ({
                          ...c,
                          // Each field caps at what is left after the OTHER
                          // destinations, so the running total can't cross the
                          // movable amount either.
                          [o.id]: capAmount(
                            e.target.value,
                            source
                              ? available -
                                Object.entries(c).reduce(
                                  (sum, [id, v]) =>
                                    id === o.id || !selected.has(id) ? sum : sum + (Number(v) || 0),
                                  0,
                                )
                              : Infinity,
                          ),
                        }))
                      }
                      disabled={readOnly}
                      inputMode="decimal"
                      placeholder="0"
                      aria-label={`Amount for ${o.name}`}
                      className="w-14 bg-transparent px-1 py-1 text-right text-xs tabular-nums text-[var(--foreground)] focus:outline-none"
                    />
                  </span>
                )}
              </span>
            );
          })}
      </div>

      {/* §8 preview before commit — every side, target before → after, plus the
          new recommended daily, so the consequence is visible first. */}
      {plan && (plan.error || plan.allocations.length > 0) && (
        <div className="mt-3.5">
          {plan.error ? (
            <span className="text-xs font-medium" style={{ color: COLORS.error }}>
              {plan.error}
            </span>
          ) : (
            <div className="flex flex-wrap gap-2">
              {plan.source && (
                <PreviewPill
                  direction="give"
                  name={plan.source.label}
                  before={plan.source.targetBefore}
                  after={plan.source.targetAfter}
                  newDaily={plan.source.recommendedDailyAfter}
                  showDaily={source?.kind === 'campaign'}
                />
              )}
              {plan.allocations.map((a) => (
                <PreviewPill
                  key={a.id}
                  direction="get"
                  name={a.name}
                  before={a.targetBefore}
                  after={a.targetAfter}
                  newDaily={a.recommendedDailyAfter}
                  showDaily
                />
              ))}
            </div>
          )}
          {/* §9 soft warnings — judgment calls, so they sit under the preview
              rather than beside the commit button, and the button stays live.
              Warned-about moves are frequently the RIGHT move (deliberately
              starving a campaign you are about to pause); the warning's job is
              to make sure the consequence was seen, not to argue. */}
          {plan.warnings.length > 0 && (
            <ul className="mt-2.5 space-y-1.5">
              {plan.warnings.map((w) => (
                <li
                  key={`${w.kind}:${w.lineId}`}
                  className="flex gap-2 rounded-lg px-3 py-2 text-[11px] leading-relaxed"
                  style={{ background: `${COLORS.warn}14`, color: 'var(--foreground)' }}
                >
                  <ExclamationTriangleIcon
                    className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                    style={{ color: COLORS.warn }}
                    aria-hidden
                  />
                  <span>{w.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

        </div>

        {/* Footer: the commit sits on the modal edge, with the consequence
            spelled out beside it rather than only in the preview above. */}
        <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] px-5 py-3.5">
          {plan?.ok && (
            <span className="mr-auto text-[11px] tabular-nums text-[var(--muted-foreground)]">
              Moving {fmt(plan.total)} across {plan.allocations.length} campaign
              {plan.allocations.length === 1 ? '' : 's'}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={readOnly || !plan?.ok}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Move
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewPill({
  direction,
  name,
  before,
  after,
  newDaily,
  showDaily,
}: {
  direction: 'give' | 'get';
  name: string;
  before: number;
  after: number;
  newDaily: number;
  showDaily?: boolean;
}) {
  const color = direction === 'give' ? COLORS.warn : COLORS.lifetime;
  // Plus/minus rather than the pace arrows: this is money leaving one line and
  // arriving at another, not a rate above or below its even pace. Reusing the
  // arrows here would make two different signals look like one.
  const Icon = direction === 'give' ? MinusSmallIcon : PlusSmallIcon;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-[11px]">
      <Icon
        className="h-3.5 w-3.5 flex-shrink-0"
        style={{ color }}
        aria-label={direction === 'give' ? 'gives' : 'receives'}
      />
      <span className="font-semibold text-[var(--foreground)]">{name}</span>
      <span className="tabular-nums text-[var(--muted-foreground)]">
        {fmt(before)} → <span className="font-bold text-[var(--foreground)]">{fmt(after)}</span>
      </span>
      {showDaily && (
        <span className="tabular-nums" style={{ color: 'var(--primary)' }}>
          new daily {fmt(newDaily)}
        </span>
      )}
    </span>
  );
}
