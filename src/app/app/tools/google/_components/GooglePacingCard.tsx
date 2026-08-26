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
import { createPortal } from 'react-dom';
import {
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  ViewColumnsIcon,
  ClockIcon,
  ArrowSmallDownIcon,
  ArrowSmallUpIcon,
  ArchiveBoxIcon,
  ArrowUturnLeftIcon,
  BoltIcon,
  PencilSquareIcon,
  ChevronDownIcon,
  EllipsisVerticalIcon,
  ExclamationTriangleIcon,
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
  projectAtTypedDaily,
  type TypedDailyProjection,
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
  type PaceStatus,
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
import { capDelivery, isFutileRaise } from '@/lib/ad-pacer/google-metrics';
import {
  normalizeAdStatus,
  parseStatusReasons,
  platformStatusWord,
  statusMismatch,
  statusReasonLabel,
  statusReasonText,
  statusReasonTone,
  statusWordState,
  type StatusMismatch,
  type StatusReasonTone,
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
  /**
   * The account pace verdict, published up to the shell so it can sit beside the
   * account name rather than inside this card.
   *
   * A callback rather than the shell computing it: the verdict is a property of
   * the ALLOCATOR VIEW — filtered subset, reserved lines excluded, the data edge
   * and all — and a second derivation up there would be a second answer to the
   * same question the moment a label filter or a reserve changed one of them.
   * One computation, rendered in two places.
   */
  onPaceSummary?: (summary: AccountPaceSummary | null) => void;
}

/** What the shell needs to render the verdict — no presentation, so the card and
 *  the header cannot disagree about the numbers behind it. */
export interface AccountPaceSummary {
  status: PaceStatus;
  ratio: number | null;
  /** Null unless a label filter is active — the verdict is then about the slice. */
  scope: string | null;
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
  onPaceSummary,
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
  // Which rows have their delivery panel open (§1). A SET, not a single id:
  // choosing who gives budget and who gets it is a comparison, and the modal
  // this replaced could only ever show one campaign while hiding the table
  // behind it. Opening a row never closes another — the user decides what stays
  // open.
  const [deliveryIds, setDeliveryIds] = useState<Set<string>>(new Set());
  const toggleDelivery = (id: string) =>
    setDeliveryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
        markup,
      }),
    [ads, mode, payable, clock, activeLabel, eventBudgets, markup],
  );

  // Hand the verdict to the shell, and take it back down when this card unmounts
  // so a stale "Overspending" cannot outlive the tab that computed it.
  useEffect(() => {
    onPaceSummary?.({
      status: view.totals.paceStatus,
      ratio: view.totals.paceRatio,
      scope: view.activeLabel,
    });
  }, [view.totals.paceStatus, view.totals.paceRatio, view.activeLabel, onPaceSummary]);
  useEffect(() => () => onPaceSummary?.(null), [onPaceSummary]);

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
  /**
   * Persist a field WITHOUT pushing an undo frame. Undo restores whole ad sets,
   * and every entry on its stack is a plan change someone made here. A daily
   * budget that Google has already accepted is not one of those: undoing it
   * would rewrite our copy to a rate the platform is no longer running, which is
   * worse than the drift it would be trying to fix.
   */
  const syncAd = useCallback(
    (id: string, patch: Partial<PacerAd>) => {
      onPersist({ ads: ads.map((ad) => (ad.id === id ? { ...ad, ...patch } : ad)) });
    },
    [ads, onPersist],
  );

  /**
   * §2.4 — write ONE typed daily budget to Google, from the row's edit box.
   *
   * Routes through the guarded single-campaign push, which re-checks the row
   * server-side: unlinked, total-budget and shared-budget campaigns are refused
   * there whoever asks, so a hand-typed number cannot do what the batch push
   * deliberately will not. On success our copy is brought into lockstep with
   * what Google now holds, which is what keeps the footer's live total and the
   * drift check honest between syncs.
   */
  const pushTypedDaily = useCallback(
    async (adId: string, amount: number): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch(
          `/api/google-ads-pacer/${encodeURIComponent(accountKey)}/push-budget?period=${period}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adId, dailyBudget: amount }),
          },
        );
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) return { ok: false, error: json?.error ?? 'Google rejected the change' };
        syncAd(adId, {
          pacerDailyBudget: amount.toFixed(2),
          googleDailyPushedAt: new Date().toISOString(),
        });
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not reach Google' };
      }
    },
    [accountKey, period, syncAd],
  );

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

  // The campaigns the account daily is actually spread across. `dailyControllable`
  // already excludes reserved lines and total-budget campaigns, which is exactly
  // the set the number is summed over — deriving the count any other way is how a
  // "$340/day across 9 campaigns" ends up describing eight.
  const dailyLineCount = view.visible.filter((l) => l.dailyControllable).length;

  // §1.2 — the allocation health badge and the fourth stat beneath it are ONE
  // decision rendered twice (a word and a number), so they are computed once.
  // The comparison is allocated vs the denominator the view is measured against:
  // the payable unfiltered, the event budget inside a label.
  const allocHealth = view.totals.fullyAllocated
    ? {
        badge: 'Full',
        color: COLORS.success,
        statLabel: 'Unallocated',
        statAmount: 0,
        statSub: 'nothing left to place',
        tooltip: `The plan places exactly ${fmt(view.totals.denominator)} — every dollar of ${denominatorNoun(view)} is on a campaign.`,
      }
    : view.totals.unallocated < 0
      ? {
          badge: 'Over',
          color: COLORS.error,
          statLabel: 'Over',
          statAmount: -view.totals.unallocated,
          statSub: `more than ${denominatorNoun(view)}`,
          tooltip: `The campaign targets add up to ${fmt(view.totals.allocated)}, which is ${fmt(-view.totals.unallocated)} more than the ${fmt(view.totals.denominator)} there is to place. Balance, or trim a line.`,
        }
      : {
          badge: 'Under',
          color: COLORS.warn,
          statLabel: 'Unallocated',
          statAmount: view.totals.unallocated,
          statSub: 'not on any campaign',
          tooltip: `${fmt(view.totals.unallocated)} of ${denominatorNoun(view)} is not on a campaign yet. Until it is, the recommended dailies below add up to less than the month's rate.`,
        };

  return (
    <div>
      {/* ── §1.2 Allocation module ──
          Mirrors Meta's budget bar: a health badge that answers the question in
          one word, the four numbers the badge is computed from, the bar, and a
          legend tying every color back to a campaign. */}
      <div className="glass-section-card mb-4 rounded-xl px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          <span className="text-sm font-bold uppercase tracking-wider text-[var(--foreground)]">
            {view.activeLabel ?? 'Account'} allocation
          </span>
          <AllocationHealthBadge view={view} />
        </div>

        {/* The quartet the badge is computed from. Borderless — boxes here would
            restate the old five-card header inside the module it replaced. */}
        <div
          className="mb-4 grid grid-cols-2 gap-y-3 sm:grid-cols-4"
        >
          {view.activeLabel ? (
            <>
              {/* A label view asks the same question the account view does —
                  is the money placed — so it gets the same four numbers, with
                  the client figure typed in rather than read off the Planner.
                  The entry lives HERE, in the module that checks it, instead of
                  in a bar of its own between the toolbar and the table: the
                  number it is compared against is two inches away. */}
              <BudgetTargetStat
                label={view.activeLabel}
                gross={view.budgetTarget?.gross ?? null}
                readOnly={readOnly}
                onChange={(amount) => {
                  const next = { ...eventBudgets };
                  if (amount == null || amount <= 0) delete next[view.activeLabel as string];
                  else next[view.activeLabel as string] = amount;
                  setEventBudgets(next);
                  onPersist({ eventBudgets: next });
                }}
              />
              <PaceStat
                grow
                label={view.budgetTarget ? 'Actual spend' : 'Campaign total'}
                value={fmt(view.totals.denominator)}
                sub={
                  view.budgetTarget
                    ? markup > 0
                      ? `after ${((1 - markup) * 100).toFixed(1)}% margin`
                      : 'markup not set'
                    : 'no target set'
                }
              />
            </>
          ) : (
            <>
              <PaceStat
                grow
                label="Client budget"
                value={fmt(totalBudget)}
                sub="gross"
              />
              {/* "× 77.0% markup" said the factor, not the fact. 0.77 is the
                  gross→spend RETENTION factor for a 23%-margin account (see
                  lib/ad-pacer/markup) — nobody calls that a 77% markup, and 77
                  is the complement of the number the desk actually quotes. The
                  sub's job is to explain the gap to Client Budget directly
                  above it, and what closes that gap is the margin. */}
              <PaceStat
                grow
                label="Actual spend"
                value={fmt(payable)}
                sub={markup > 0 ? `after ${((1 - markup) * 100).toFixed(1)}% margin` : 'markup not set'}
                color={carryoverNote !== 0 ? COLORS.warn : undefined}
                tooltip={`${fmt(totalBudget)} client budget less the ${((1 - markup) * 100).toFixed(1)}% agency margin — the spend that actually reaches Google, and the denominator every allocation is measured against.${
                  carryoverNote !== 0
                    ? ` This month also carries a ${money2(carryoverNote)} reconciliation carryover, which is NOT included — apply it to the budget number if you want it paced.`
                    : ''
                }`}
              />
            </>
          )}
          <PaceStat
            label="Allocated"
            value={fmt(view.totals.allocated)}
            sub={`across ${view.visible.length} campaign${view.visible.length === 1 ? '' : 's'}`}
          />
          <PaceStat
            grow
            label={allocHealth.statLabel}
            value={fmt(allocHealth.statAmount)}
            color={allocHealth.color}
            sub={allocHealth.statSub}
            tooltip={allocHealth.tooltip}
          />
        </div>

        {/* Segmented allocation bar — one segment per campaign, matching the
            Base/Added bar's chrome so the two read as the same instrument. */}
        <div className="mb-1.5 flex h-2.5 overflow-hidden rounded-full bg-[var(--muted)]">
          {view.visible
            .filter((l) => l.target > 0)
            .map((l) => (
              <Tooltip
                key={l.id}
                className="h-full transition-[width] duration-500"
                label={`${l.name}: ${fmt(l.target)} (${l.percentOfPayable.toFixed(1)}% of actual spend)${
                  l.reserved ? ' · reserved — holds allocation, sits out of pacing' : ''
                }${l.locked ? ' · locked' : ''}`}
                style={{
                  width: `${(l.target / meterBasis) * 100}%`,
                  background: campaignColor(l.colorIndex),
                  // §1.2 — a reserve holds allocation but sits OUT of pacing, so
                  // it cannot look like the segments beside it. Bold stripes in
                  // the page background; a lock keeps the finer white hatch, so
                  // the two protections stay tellable apart at a glance.
                  backgroundImage: l.reserved
                    ? 'repeating-linear-gradient(45deg, var(--background) 0 4px, transparent 4px 8px)'
                    : l.locked
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {view.totals.lockedTarget > 0 && (
              <span className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
                <LockClosedIcon className="h-3 w-3" />
                {fmt(view.totals.lockedTarget)} locked
              </span>
          )}
          {/* §12 — the reserve is inside the allocation but outside every pacing
              figure, so the account's expected-MTD and daily-needed are lower
              than the allocation alone would imply. Say so here rather than
              leaving someone to reconcile the gap themselves. */}
          {view.totals.reservedTarget > 0 && (
            <Tooltip label="Committed to campaigns that cannot spend yet. Counted in the allocation and the payable check, and excluded from Expected MTD, the account pace, the daily needed and the push.">
              <span
                className="flex cursor-help items-center gap-1.5 text-[11px]"
                style={{ color: COLORS.lifetime }}
              >
                <ArchiveBoxIcon className="h-3 w-3" />
                {fmt(view.totals.reservedTarget)} reserved
              </span>
            </Tooltip>
          )}
          {/* The percent the bar is actually drawing: 100% when the plan totals
              the denominator, 108.5% when it is over it. */}
            <span
            className="text-sm font-bold tabular-nums"
            style={{ color: allocColor }}
          >
            {view.totals.denominator > 0
              ? `${((view.totals.allocated / view.totals.denominator) * 100).toFixed(1)}%`
              : '—'}
          </span>
        </div>

        {/* Legend — the one thing that makes the bar readable: which color is
            which campaign, and what each one holds. */}
        {view.visible.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-[var(--border)] pt-3">
            {view.visible.map((l) => (
              <span key={l.id} className="flex items-center gap-1.5 text-[11px]">
                <span
                  className="h-2 w-2 flex-shrink-0 rounded-sm"
                  style={{ background: campaignColor(l.colorIndex) }}
                />
                <span className="max-w-[14rem] truncate text-[var(--foreground)]">{l.name}</span>
                <span className="tabular-nums text-[var(--muted-foreground)]">
                  {fmt(l.target)}
                </span>
                {l.reserved ? (
                  <span className="tabular-nums" style={{ color: COLORS.lifetime }}>
                    reserved
                  </span>
                ) : (
                  <span className="tabular-nums text-[var(--muted-foreground)]">
                    {l.percentOfPayable.toFixed(1)}%
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── §1.1 The month's pacing numbers ──
          Below the allocation module, not above it, and in the module's own
          chrome. The order is the order of the question: allocation is what the
          plan INTENDS, pacing is how it is going against that, so the numbers
          that grade the plan cannot sit above the plan they grade.

          The verdict itself is not here — it moved up beside the account name
          (the shell renders it from `onPaceSummary`), because it is a statement
          about the account and belongs with the account's identity. */}
      <div className="mb-4">
        <div className="mb-2 flex flex-wrap items-center gap-2.5">
          <span className="text-sm font-bold uppercase tracking-wider text-[var(--foreground)]">
            {view.activeLabel ? `${view.activeLabel} pacing` : 'Total account pacing'}
          </span>
        </div>
        {/* One card per number, on the allocation module's own surface
            (glass-section-card) rather than a chrome of their own — the two
            sections have to read as the same instrument, and a second card
            style directly beneath the first is what made the old header look
            like two unrelated strips. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <PaceCard
            label="Spent MTD"
            value={fmt(view.totals.spent)}
            sub={clock.dataEdgeIso ? `through ${fmtDate(clock.dataEdgeIso)}` : 'no settled days'}
            color={COLORS.daily}
          />
          <PaceCard
            label="Expected MTD"
            value={fmt(view.totals.expected)}
            sub="at an even pace"
          />
          <PaceCard
            label="Left to spend"
            value={fmt(Math.max(0, view.totals.denominator - view.totals.spent))}
            sub={`${fmt(view.totals.denominator)} − ${fmt(view.totals.spent)}`}
          />
          {/* The one number the desk acts on, so it carries the accent color. */}
          <PaceCard
            label="Daily needed"
            value={`${fmt(view.totals.accountDaily)}/day`}
            sub={`across ${dailyLineCount} campaign${dailyLineCount === 1 ? '' : 's'}`}
            color="var(--primary)"
          />
          <PaceCard
            label="Days left"
            value={String(Math.max(0, clock.daysInMonth - clock.dataEdgeDay))}
            sub={`of ${clock.daysInMonth}`}
          />
        </div>
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
            <span className="text-lg font-bold tracking-tight text-[var(--foreground)]">
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
          <LabelFilterBar
            ads={ads}
            activeLabel={activeLabel}
            onChange={setActiveLabel}
            className="mb-0"
          />
          {tableActions}
        </div>
      </div>


      <div className="glass-table">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px]">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]">
                  {/* §2.3 — the row-expander affordance. The whole row is the
                      click target now, so this is the sign that it is, not the
                      only way in. */}
                  <th className="w-8 px-2 py-2" />
                  <Th align="left">Campaign</Th>
                  <Th className="w-[150px]">
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
                  <Th>Spent MTD</Th>
                  <Th tooltip="Target × (flight days elapsed ÷ total flight days) — what should have been spent by now at an even pace.">
                    Expected MTD
                  </Th>
                  <Th align="left">Pace</Th>
                  <Th tooltip="The average daily budget this campaign currently has in Google — edit it here to set a different one. The recommended daily beside it is what the target math wants; the gap is what a push would change.">
                    Daily Budget
                  </Th>
                  <Th
                    hero
                    tooltip="(Monthly target − spent) ÷ remaining flight days. Set this as the campaign's daily budget in Google today to land on target."
                  >
                    Recommended
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
                    onPushDaily={pushTypedDaily}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
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
                  <td className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wider text-[var(--foreground)]">
                    {view.activeLabel ? 'Campaign total' : 'Account total'}
                  </td>
                  {/* §5 put an integrity badge here, on the allocation total,
                      because what it checks is a property of THIS column. The
                      allocation module above now answers the same question
                      three ways over — a health badge, the unallocated dollars,
                      and the percent — so a fourth restatement only stacked up
                      the summary line. The claim it carried lives on this
                      total's tooltip instead, where it is one hover from the
                      number it is about. */}
                  <td className="px-3 py-3 text-right">
                    <Tooltip
                      label={
                        view.totals.fullyAllocated
                          ? `Fully allocated: the plan totals ${denominatorNoun(view)} exactly, so the recommended daily total beside it is what Google Ads Manager should show after applying.`
                          : `Under-allocated: ${fmt(Math.abs(view.totals.unallocated))} of ${denominatorNoun(view)} is ${view.totals.unallocated > 0 ? 'not placed on a campaign' : 'over-placed'}. Balance it, or the account daily total will not match Google Ads Manager after applying.`
                      }
                      className="w-full cursor-help"
                    >
                      {/* ONE child. The tooltip wrapper is an inline-flex, so
                          two siblings here lay out side by side instead of
                          stacking — which is what put the percent and the
                          dollars on the same line. */}
                      <div className="flex w-full items-start justify-end gap-1.5 text-right">
                        <div>
                          <div
                            className="text-sm font-bold tabular-nums"
                            style={{
                              color: view.totals.fullyAllocated ? undefined : COLORS.error,
                            }}
                          >
                            {mode === 'pct'
                              ? `${view.visible.reduce((s, l) => s + l.input, 0).toFixed(1)}%`
                              : fmt(view.totals.allocated)}
                          </div>
                        <div className="text-[10px] tabular-nums text-[var(--muted-foreground)]">
                          {mode === 'pct'
                            ? fmt(view.totals.allocated)
                            : `of ${fmt(view.totals.denominator)}`}
                        </div>
                        </div>
                        {/* Stands in for the rows' budget menu so the figures
                            share a right edge. Inert and hidden from readers. */}
                        <span aria-hidden className="h-6 w-6 flex-shrink-0" />
                      </div>
                    </Tooltip>
                  </td>
                  <td className="px-3 py-3 text-right text-sm font-bold tabular-nums">
                    {fmt(view.totals.spent)}
                  </td>
                  <td className="px-3 py-3 text-right text-sm font-bold tabular-nums">
                    {fmt(view.totals.expected)}
                  </td>
                  <td />
                  <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-[var(--muted-foreground)]">
                    {fmt(liveAccountDaily)}
                  </td>
                  {/* §5 — the plan total, and one stacked delta for the gap to
                      what Google holds. The live figure itself is NOT restated
                      here: the cell immediately to the left already totals that
                      exact number, and printing it twice is what made this cell
                      read as three competing numbers. */}
                  <td className="bg-[var(--muted)]/40 px-3 py-3 text-right">
                    {/* Same tight stack as the allocation total: the figure,
                        then its sub-line flush beneath it. Block children, so
                        nothing depends on an inline tooltip wrapper breaking
                        the line for it. */}
                    <div
                      className="text-sm font-bold tabular-nums"
                      // §5 — an under-allocated plan understates this total,
                      // because the money that is not on a campaign has no
                      // daily. Dimmed in that state only; a fully allocated plan
                      // is just a clean number and needs no badge to say so.
                      style={{
                        color: 'var(--primary)',
                        opacity: view.totals.unallocated > 0.005 ? 0.55 : 1,
                      }}
                    >
                      {fmt(view.totals.accountDaily)}
                    </div>
                    <div className="text-[10px] tabular-nums">
                      <LiveDailyTotal
                        recommended={view.totals.accountDaily}
                        live={liveAccountDaily}
                        unapplied={applyAllChanges.length}
                      />
                    </div>
                    {view.totals.unallocated > 0.005 && (
                      <div className="text-[10px] text-[var(--muted-foreground)]">
                        <Tooltip
                          label={`${fmt(view.totals.unallocated)} of ${denominatorNoun(view)} is not on a campaign, so no daily was computed for it. This total is the rate for the money that IS placed.`}
                        >
                          <span className="cursor-help">plan incomplete</span>
                        </Tooltip>
                      </div>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
      </div>

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
    : view.denominatorKind === 'budgetTarget'
      ? 'the budget target'
      : 'campaign total';
}

/**
 * One label-plus-number stat (§1.1/§1.2). Borderless by design: the header this
 * replaced put five of these in five identical cards, which gave a pace reading
 * and a budget figure the same visual weight and made the strip read as a
 * dashboard of equals rather than one verdict with its workings beside it. The
 * thin left rule is the only separator — enough to group, not enough to box.
 */
/** A pacing number as a card, on the allocation module's surface. Same content
 *  as PaceStat — the difference is only whether the number sits inside the
 *  module (borderless, divided by a rule) or beside it (its own card). */
function PaceCard({
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
    <div className="glass-section-card h-full w-full rounded-xl px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </div>
      <div
        className="mt-0.5 text-lg font-bold tabular-nums leading-tight"
        style={{ color: color ?? 'var(--foreground)' }}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[10px] tabular-nums text-[var(--muted-foreground)]">{sub}</div>
      )}
    </div>
  );
  return tooltip ? (
    <Tooltip label={tooltip} className="w-full cursor-help">
      {body}
    </Tooltip>
  ) : (
    body
  );
}

function PaceStat({
  label,
  value,
  sub,
  color,
  tooltip,
  grow = false,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  tooltip?: string;
  /** Fill the cell rather than sitting at its own natural size. The allocation
   *  quartet uses this: four numbers packed left under a full-width bar left a
   *  third of the module empty and made the quartet read as a caption rather
   *  than as the bar's own figures. Their container is a GRID — flex sizes each
   *  column around its content, so the widest number pushed the last two stats
   *  into the right-hand corner instead of spacing them evenly. */
  grow?: boolean;
}) {
  // The thin left rule is the only separator — enough to group, not enough to
  // box. It sits on the OUTER element so it lands between siblings, and the
  // leading one is dropped: a divider before the first stat has nothing on its
  // other side to divide it from.
  const outer = `border-l border-[var(--border)] pl-5 first:border-l-0 first:pl-0${
    grow ? ' min-w-0' : ''
  }`;
  const body = (
    <>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </div>
      <div
        className="text-lg font-bold tabular-nums leading-tight"
        style={{ color: color ?? 'var(--foreground)' }}
      >
        {value}
      </div>
      {sub && (
        <div className="text-[10px] tabular-nums text-[var(--muted-foreground)]">{sub}</div>
      )}
    </>
  );
  return tooltip ? (
    <Tooltip label={tooltip} className={`${outer} cursor-help`}>
      <div className="w-full">{body}</div>
    </Tooltip>
  ) : (
    <div className={outer}>{body}</div>
  );
}

/**
 * §1.2 — allocation health in one word, leading the module the way the pace
 * verdict leads the strip above it.
 *
 * Three states, one question: does the plan place exactly the money there is to
 * place? "Fully allocated" is the healthy one — it used to read "Zeroed", which
 * described the arithmetic (the remainder is zero) rather than the state anyone
 * cares about, and sounded like something had been wiped.
 */
function AllocationHealthBadge({ view }: { view: AllocatorView }) {
  // ONE WORD. It carried the dollar figure too ("Over by $400.01"), which is the
  // same number the quartet prints immediately below it — the badge is the
  // verdict, the stat under it is the amount.
  const health = view.totals.fullyAllocated
    ? { text: 'Full', color: COLORS.success }
    : view.totals.unallocated < 0
      ? { text: 'Over', color: COLORS.error }
      : { text: 'Under', color: COLORS.warn };
  return (
    <Tooltip
      label={
        view.totals.fullyAllocated
          ? `Every dollar of ${denominatorNoun(view)} is on a campaign, so the recommended dailies below add up to the month's rate.`
          : view.totals.unallocated < 0
            ? `The campaign targets add up to more than ${denominatorNoun(view)}. Balance, or trim a line.`
            : `Some of ${denominatorNoun(view)} is not on a campaign yet, so the plan is incomplete and the recommended total understates the month.`
      }
    >
      <span
        className="cursor-help rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
        style={{ background: `${health.color}1f`, color: health.color }}
      >
        {health.text}
      </span>
    </Tooltip>
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
 * §9 the label's BUDGET TARGET — the client budget for this push — as the first
 * card of the allocation module.
 *
 * Typed in CLIENT-GROSS dollars, which is the figure the push was actually sold
 * at and the only one anyone has to hand. The card beside it derives the spend
 * that reaches Google, and that derived figure is what the tagged allocation is
 * checked against. It used to take the number raw and compare it straight to
 * the allocation, so anyone entering the gross figure — the natural thing to
 * reach for — saw a shortfall exactly the size of the agency margin, against
 * money that was never going to reach Google at all.
 *
 * Optional. Without one the tagged campaigns are checked against their own
 * total, which makes them trivially fully allocated and says nothing.
 */
function BudgetTargetStat({
  label,
  gross,
  readOnly,
  onChange,
}: {
  label: string;
  gross: number | null;
  readOnly: boolean;
  onChange: (amount: number | null) => void;
}) {
  const [draft, setDraft] = useState(gross != null ? gross.toFixed(2) : '');
  useEffect(() => {
    setDraft(gross != null ? gross.toFixed(2) : '');
  }, [gross]);

  return (
    <div className="border-l border-[var(--border)] pl-5 first:border-l-0 first:pl-0">
      <Tooltip
        label={`The client budget for “${label}” — e.g. what the sales event was sold at. Enter it gross, the same way it was quoted; the card takes the agency margin off and checks the tagged campaigns against what actually reaches Google. This never changes the account's own budget or actual spend.`}
      >
        <span className="cursor-help text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Budget target
        </span>
      </Tooltip>
      <div className="relative">
        <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-lg font-bold text-[var(--muted-foreground)]">
          $
        </span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ''))}
          onBlur={() => {
            const parsed = Number(draft);
            onChange(draft.trim() === '' || !Number.isFinite(parsed) ? null : parsed);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          disabled={readOnly}
          inputMode="decimal"
          placeholder="0.00"
          aria-label={`Budget target for ${label}`}
          // Borderless until focused, like the planner's cells — a filled input
          // here would be the only boxed thing in a row of plain figures.
          className="w-full rounded-md bg-transparent pl-3.5 text-lg font-bold tabular-nums leading-tight text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/50 hover:bg-[var(--muted)]/60 focus:bg-[var(--input)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] disabled:opacity-60"
        />
      </div>
      <div className="text-[10px] tabular-nums text-[var(--muted-foreground)]">
        {gross != null ? 'client gross' : 'set one to check this label'}
      </div>
    </div>
  );
}

/**
 * A contradiction between the team's Ad Status and what Google reports (§13).
 *
 * §2.1 retired the plain status DOT this used to render beside the name: it sat
 * next to the allocation color swatch and read as a second identity color rather
 * than a status, and the row now says the platform status in words underneath
 * the name instead. What is left is the case that is not a status at all but an
 * error — a row Loomi is pacing as live that Google has paused is the expensive
 * silent failure, because the recommended daily, the account total and the push
 * all keep treating it as a running campaign — and that stays a loud badge.
 */
function PlatformStatusPill({
  ad,
  mismatch,
}: {
  ad: PacerAd | undefined;
  mismatch: StatusMismatch;
}) {
  if (!ad || !mismatch) return null;
  const status = normalizeAdStatus(ad);
  const why = mismatch.reasons.length
    ? ` Google says ${mismatch.reasons.map(statusReasonText).join(', ')}.`
    : '';
  const label =
    mismatch.kind === 'not_serving'
      ? `Loomi is pacing this as ${ad.adStatus.toLowerCase()}, but Google reports it ${status.toLowerCase()} — it is not serving.${why} Its recommended daily is a number for a campaign that is not running, and pushing it will change nothing.`
      : `Loomi has this as ${ad.adStatus.toLowerCase()}, but Google reports it ${status.toLowerCase()} — it is spending on a line the plan is not pacing.${why}`;

  return (
    <Tooltip label={label}>
      <span
        className="inline-flex cursor-help items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
        style={{ background: `${COLORS.error}1f`, color: COLORS.error }}
      >
        <ExclamationTriangleIcon className="h-3 w-3" />
        {mismatch.kind === 'not_serving' ? `Not serving · ${status}` : 'Live in Google'}
      </span>
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

/**
 * The row's two protections — Lock and Reserve — behind one three-dot control.
 *
 * They were a stacked pair of icon buttons in the leftmost column: two unlabeled
 * glyphs per row, twelve rows deep, neither of which anyone can name on sight
 * (a padlock and an archive box, meaning "Balance and Move leave this alone" and
 * "this money cannot be spent yet"). Behind a menu they get their real names and
 * a sentence each, and the column collapses to one target.
 *
 * PORTALLED, and it has to be: the table sits in an `overflow-x-auto` wrapper,
 * and an element that scrolls on one axis clips the other too, so a normally
 * positioned panel is cut off at the row's own bottom edge. It is positioned
 * from the trigger's client rect and rendered into the body.
 */
function RowActionsMenu({
  line,
  readOnly,
  onToggleLock,
  onToggleReserved,
}: {
  line: AllocatorLine;
  readOnly: boolean;
  onToggleLock: () => void;
  onToggleReserved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 244;
    // Flip above when there is no room below, so the last rows of a long table
    // do not open a menu into the viewport's floor.
    const below = window.innerHeight - rect.bottom;
    setPos({
      top: below < 150 ? Math.max(8, rect.top - 150) : rect.bottom + 6,
      left: Math.min(rect.left, window.innerWidth - width - 8),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    // Re-place rather than follow: the table scrolls sideways under the menu,
    // and a panel left behind at stale coordinates points at the wrong row.
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  const items = [
    {
      key: 'lock',
      Icon: line.locked ? LockClosedIcon : LockOpenIcon,
      title: line.locked ? 'Unlock budget' : 'Lock budget',
      sub: line.locked
        ? 'Let Balance, Move and the allocation box change this target again.'
        : 'A fixed carve-out: Balance, Move and the allocation box all leave it alone. Changes no numbers.',
      on: line.locked,
      run: onToggleLock,
    },
    {
      key: 'reserved',
      Icon: ArchiveBoxIcon,
      title: line.reserved ? 'Un-reserve budget' : 'Reserve budget',
      sub: line.reserved
        ? 'Put it back into Expected MTD, the account pace, the recommended daily and the push.'
        : 'For budget committed to a campaign that cannot spend yet. It stays in the allocation and leaves every pacing figure.',
      on: line.reserved,
      run: onToggleReserved,
    },
  ];

  return (
    <>
      <Tooltip label={`Budget protections for ${line.name} — lock and reserve.`}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={readOnly}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Budget options for ${line.name}`}
          // Lit only while the menu is OPEN. It used to stay lit for a locked or
          // reserved line, which made a control look permanently pressed when
          // nothing was pressed — and both states are already said twice over,
          // by the row's tint and by the glyph beside the allocation.
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            open
              ? 'border-[var(--foreground)]/30 bg-[var(--foreground)]/10 text-[var(--foreground)]'
              : 'border-transparent text-[var(--muted-foreground)] hover:border-[var(--border)] hover:text-[var(--foreground)]'
          }`}
        >
          <EllipsisVerticalIcon className="h-4 w-4" />
        </button>
      </Tooltip>
      {open && pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="glass-dropdown fixed z-[200] w-[244px] p-1"
              style={{ top: pos.top, left: pos.left }}
            >
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={item.on}
                  onClick={() => {
                    item.run();
                    setOpen(false);
                  }}
                  className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--muted)]"
                >
                  <item.Icon
                    className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                    style={{ color: item.on ? COLORS.lifetime : 'var(--muted-foreground)' }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-[var(--foreground)]">
                      {item.title}
                    </span>
                    <span className="block text-[10px] leading-snug text-[var(--muted-foreground)]">
                      {item.sub}
                    </span>
                  </span>
                  {item.on && (
                    <span className="text-[11px] leading-none text-[var(--primary)]">✓</span>
                  )}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** The sentence behind the pace badge. Says what the badge means and what it
 *  does NOT, since a single ratio invites over-reading. */
function paceHelp(line: AllocatorLine): string {
  if (line.paceRatio == null) {
    return 'No settled days in this campaign\u2019s flight yet, so there is nothing to compare against.';
  }
  const pct = Math.round(line.paceRatio * 100);
  const base = `Spent ${fmt(line.spentMTD)} against ${fmt(line.expectedToDate)} expected by now — ${pct}% of pace, ${line.paceDelta >= 0 ? 'ahead by' : 'behind by'} ${fmt(Math.abs(line.paceDelta))}. Expected is the target spread evenly across this campaign's own ${line.flight.total} flight days, not the month's.`;
  const band =
    ' On Track is within 12% either way: Google can spend up to 2× the daily on a busy day, so a tighter band would flip on any busy Saturday.';
  const caveat =
    line.paceStatus === 'under'
      ? ' Behind can mean two different things — open the row to see whether it is spending its full daily budget or cannot spend at all.'
      : '';
  return base + band + caveat;
}

/**
 * §A.2 — the row status line's two colors, which say two different things.
 *
 * The REASON carries Google's severity: amber for something holding delivery
 * back, red only for ads that cannot serve, plain gray for a state nobody needs
 * to act on. The WORD keeps its own indicator, so an enabled campaign that is
 * limited by its budget still reads as enabled — which it is, and which is fine.
 */
const REASON_TONE_COLOR: Record<StatusReasonTone, string> = {
  neutral: 'var(--muted-foreground)',
  warn: COLORS.warn,
  bad: COLORS.error,
};
const WORD_STATE_COLOR: Record<'on' | 'off' | 'fault', string> = {
  on: COLORS.success,
  off: 'var(--muted-foreground)',
  fault: COLORS.error,
};

/** Stop a control inside the row from also toggling the row (§2.3). Every
 *  interactive thing on a collapsed row needs this now that the row itself is
 *  the click target — a lock that also opened the delivery panel would make both
 *  actions feel accidental. */
const stopRowToggle = (e: React.MouseEvent) => e.stopPropagation();

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
  onPushDaily,
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
  /** §2.4 — write a typed daily to Google. `pushing` disables the batch path. */
  pushing: boolean;
  googleConnected: boolean;
  onPushDaily: (adId: string, amount: number) => Promise<{ ok: boolean; error?: string }>;
}) {
  // §2.4/§2.5 — the daily budget being TYPED in the edit box, with the
  // projection computed from it, lifted to the row because two things outside
  // the box read them: the recommended arrow beside it, and the money line in
  // the open delivery panel. The PROJECTION travels, not just the number, so the
  // box and the panel cannot render two different landings for one keystroke.
  // Null whenever nobody is typing, which puts both back on the daily that is
  // actually set.
  const [typedDaily, setTypedDaily] = useState<TypedDailyEdit | null>(null);

  /**
   * §2.5 — what this campaign has actually been delivering per day, as the row
   * can know it.
   *
   * NOT the delivery panel's recent-pace window, and it cannot be: the series on
   * the pacer payload is a rolling EIGHT-DAY slice pinned to today (see
   * fetchPeriodPlan), so a campaign whose sync is a few days behind carries no
   * points at all here, and a run rate computed from it would be null exactly
   * when the desk is looking at a stale account. The flight-to-date average is
   * always available, needs no request, and is the same basis Expected MTD uses,
   * so the two figures on the row agree with each other.
   *
   * Null below two elapsed days: with one day of delivery a single busy morning
   * would set the projection for the rest of the month, and a projection with
   * nothing behind it is worse than none.
   */
  const deliveryAvgDaily =
    line.flight.elapsed >= 2 && line.spentMTD > 0 ? line.spentMTD / line.flight.elapsed : null;

  // §13 — does the team's Ad Status contradict what Google reports? Display
  // only; it never rewrites either side.
  const mismatch = ad ? statusMismatch(ad) : null;
  // §2.1 — the platform's own words, as a quiet line under the name. The dot
  // this replaced sat beside the allocation color swatch and read as a second
  // identity color rather than a status.
  const statusWord = ad ? platformStatusWord(ad) : null;
  const statusReasons = parseStatusReasons(ad?.googlePrimaryStatusReasons);

  return (
    <>
    {/* §2.3 — the WHOLE row opens the delivery panel. It used to open only from
        the pace text, which made the one surface that answers "can this campaign
        absorb more money" a thing you had to know was there. Every control
        inside stops propagation, so operating one never also toggles the row. */}
    <tr
      onClick={onToggleDelivery}
      className="cursor-pointer border-b border-[var(--border)] transition-colors hover:bg-[var(--muted)]/30"
      // A protected line is tinted and carries a colored edge, so both states
      // are legible straight down the table. They used to be a pair of small
      // glyphs in the control column, which is the one place a scanning eye
      // never goes — and after the lock/reserve controls moved into a menu
      // there was nothing left on the row to show them at all.
      style={
        line.reserved
          ? { background: `${COLORS.lifetime}14`, boxShadow: `inset 3px 0 0 ${COLORS.lifetime}` }
          : line.locked
            ? {
                background: 'var(--muted)',
                boxShadow: 'inset 3px 0 0 var(--muted-foreground)',
              }
            : undefined
      }
    >
      {/* §10 Compare selection. It sits in its own column rather than beside the
          campaign name: the name cell carries the identity swatch, the channel
          type and any structural tags, and a checkbox in front of all that read
          as part of the name. The row-expander chevron that used to be here is
          gone — the whole row opens the panel (§2.3), so the chevron was a
          second way in taking a column to say so. */}
      <td className="px-2 py-2.5 align-middle" onClick={stopRowToggle}>
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
            className="loomi-checkbox h-3.5 w-3.5 flex-shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          />
        </Tooltip>
      </td>

      <td className="px-3 py-2.5 text-left align-middle">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="h-2 w-2 flex-shrink-0 rounded-sm"
            style={{ background: campaignColor(line.colorIndex) }}
          />
          <span className="text-sm font-semibold text-[var(--foreground)]">{line.name}</span>
          {/* §2.1 — the channel type sits with the NAME, because it is part of
              what the campaign is (a Search line reads differently from a PMax
              one). It used to live under the name, where the platform status now
              goes. */}
          {line.channelType && (
            <span className="whitespace-nowrap text-[11px] text-[var(--muted-foreground)]">
              {line.channelType}
            </span>
          )}
          {/* §2.1 — the plain status moved to text below; the MISMATCH stays a
              badge. A row Loomi paces as live that Google is not serving is an
              error to catch, not a status to note, and quiet text is exactly how
              it would be missed. */}
          {ad && mismatch && <PlatformStatusPill ad={ad} mismatch={mismatch} />}
          {!line.flight.fullMonth && (
            <Tooltip label="This campaign's flight window inside the month — it paces against these days, not the whole month.">
              <span className="whitespace-nowrap text-[10px] tabular-nums text-[var(--muted-foreground)]">
                day {line.flight.startDay}–{line.flight.endDay}
              </span>
            </Tooltip>
          )}
          {/* What survives here is budget STRUCTURE — how this campaign's daily
              can be controlled at all. Google's primary status never reports any
              of it, so nothing else on the row says it.

              "Capped · headroom" and "Ads disapproved" were removed: §2.1 gave
              the row a status line fed by Google's own primary_status_reasons,
              which already says "Limited by budget" and "Ads disapproved" in the
              same place, in Google's words. Two labels for one fact, one of them
              a shouty uppercase derivation of the other, is how the name column
              turned into a wall. The delivery panel still carries the full
              reasoning behind the cap read. */}
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
              tooltip="Runs on an ad schedule (restricted days/dayparts). Google concentrates the monthly budget into its active days, so calendar-day pacing reads it slightly low."
            />
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* §2.1 — Google's own reading of the campaign: switched on or off
              first, then why, if it says why. */}
          {statusWord && (
            <Tooltip
              label={`What Google reports for this campaign right now. Platform truth, read-only — it never changes the Ad Status the team sets.${
                statusReasons.length > 0
                  ? ` Amber is something holding delivery back; red is ads that cannot serve at all. The ${statusWord} indicator is separate — a campaign can be enabled and limited at the same time.`
                  : ''
              }`}
            >
              {/* §A.2 — the severity the retired status dot used to carry, moved
                  onto the words that name it. The Enabled/Paused indicator stays
                  its own thing: it answers "is the switch on", which stays true
                  whatever the reason beside it says. */}
              <span className="inline-flex cursor-help items-center gap-1 whitespace-nowrap text-[11px]">
                <span
                  className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                  style={{ background: WORD_STATE_COLOR[statusWordState(statusWord)] }}
                />
                <span className="font-semibold text-[var(--foreground)]">{statusWord}</span>
                {statusReasons.map((reason) => (
                  <span key={reason} style={{ color: REASON_TONE_COLOR[statusReasonTone(reason)] }}>
                    · {statusReasonLabel(reason)}
                  </span>
                ))}
              </span>
            </Tooltip>
          )}
          <span onClick={stopRowToggle}>
            <LabelChips
              tags={ad?.pacerTags}
              allLabels={allLabels}
              readOnly={readOnly}
              onChange={onTagsChange}
            />
          </span>
        </div>
      </td>

      {/* §3.1 — one cell, both units. The Target Spend column beside this one
          showed the same dollars twice in dollar mode, and in percent mode
          showed a percent and its own resolved dollars in two places. The active
          unit is the editable figure; the other rides underneath so the plan
          stays legible without switching the whole card. */}
      <td className="px-3 py-2.5 text-right align-middle" onClick={stopRowToggle}>
        {/* The budget menu sits with the number it governs. Lock and Reserve are
            both statements about THIS allocation — may it move, may it be paced —
            and in their own column at the far left of the row they were two
            columns away from the figure they act on. */}
        <div className="flex items-center justify-end gap-1.5">
          <AllocationCell
            line={line}
            mode={mode}
            payable={payable}
            readOnly={readOnly}
            onInput={onInput}
          />
          <RowActionsMenu
            line={line}
            readOnly={readOnly}
            onToggleLock={onToggleLock}
            onToggleReserved={onToggleReserved}
          />
        </div>
      </td>

      <td className="px-3 py-2.5 text-right align-middle text-sm tabular-nums text-[var(--muted-foreground)]">
        {fmt(line.spentMTD)}
      </td>
      <td className="px-3 py-2.5 text-right align-middle text-sm tabular-nums text-[var(--muted-foreground)]">
        {fmt(line.expectedToDate)}
      </td>

      {/* §2.2 — a filled pill, and display only. It stopped being the control
          that opens the delivery panel when the whole row became one. */}
      <td className="px-3 py-2.5 text-left align-middle">
        {line.reserved ? (
          /* §12 — a reserve is not underspending, it is money set aside for a
             campaign that cannot spend yet. Showing "0% of pace" here is a
             false alarm about a campaign doing exactly what was intended. */
          <Tooltip label="Reserved — budget committed to a campaign that cannot spend yet. It counts toward the account allocation but is out of Expected MTD, the account pace, the recommended daily and the push. Un-reserve it when the campaign launches; it will then pace its full target over the days that are left.">
            <span
              className="inline-flex cursor-help items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{ background: `${COLORS.lifetime}1f`, color: COLORS.lifetime }}
            >
              <ArchiveBoxIcon className="h-3 w-3" />
              Reserved
            </span>
          </Tooltip>
        ) : (
          <>
            {/* §A.3 — a step larger than the figures beneath it. The verdict is
                what a scan down the Pace column is FOR, and at the same size as
                its own footnote it was just another small gray line. */}
            <Tooltip label={paceHelp(line)}>
              <span
                className="inline-block cursor-help whitespace-nowrap rounded-md px-2.5 py-1 text-[13px] font-bold"
                style={{
                  background: `${PACE_COLORS[line.paceStatus]}1f`,
                  color: PACE_COLORS[line.paceStatus],
                }}
              >
                {PACE_LABELS[line.paceStatus]}
              </span>
            </Tooltip>
            {line.expectedToDate > 0 && (
              <div className="mt-0.5 whitespace-nowrap text-[10px] tabular-nums text-[var(--muted-foreground)]">
                {line.paceRatio != null && `${Math.round(line.paceRatio * 100)}% · `}
                <span style={{ color: line.paceDelta >= 0 ? COLORS.warn : COLORS.lifetime }}>
                  {line.paceDelta >= 0 ? '+' : '−'}
                  {fmt(Math.abs(line.paceDelta))}
                </span>{' '}
                vs expected
              </div>
            )}
          </>
        )}
      </td>

      {/* §2.4 — the daily budget, editable. The pencil sits beside the CURRENT
          daily because that is the value the box changes. */}
      <td className="px-3 py-2.5 text-right align-middle" onClick={stopRowToggle}>
        <DailyBudgetCell
          line={line}
          ad={ad}
          dataEdgeIso={dataEdgeIso}
          readOnly={readOnly}
          pushing={pushing}
          googleConnected={googleConnected}
          onPushDaily={onPushDaily}
          deliveryAvgDaily={deliveryAvgDaily}
          daysInMonth={daysInMonth}
          remainingCalendarDays={
            daysInMonth - (dataEdgeIso ? Number(dataEdgeIso.slice(8, 10)) : 0)
          }
          onTypedDailyChange={setTypedDaily}
        />
      </td>

      <td className="bg-[var(--muted)]/40 px-3 py-2.5 text-right align-middle">
        {line.dailyControllable ? (
          <RecommendedDaily line={line} typedDaily={typedDaily?.daily ?? null} />
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
        <td colSpan={8} className="p-0">
          <GoogleDeliveryExpander
            accountKey={accountKey}
            period={period}
            line={line}
            ad={ad}
            daysInMonth={daysInMonth}
            readOnly={readOnly}
            typedDaily={typedDaily?.daily ?? null}
            typedProjection={typedDaily?.projection ?? null}
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

/**
 * §3.1 — the allocation cell, both units at once.
 *
 * This replaced two columns that were saying one thing. In dollar mode the
 * Allocation input and the Target Spend column printed the same dollars twice;
 * in percent mode they printed a percent and, one column over, the dollars that
 * percent already resolved to. Neither pairing told anyone anything the other
 * did not. Now the ACTIVE unit is the editable figure and the other rides
 * underneath in muted text, so both are always readable and only one is
 * typeable — the unit toggle in the header picks which.
 */
function AllocationCell({
  line,
  mode,
  payable,
  readOnly,
  onInput,
}: {
  line: AllocatorLine;
  mode: AllocationMode;
  payable: number;
  readOnly: boolean;
  onInput: (value: number) => void;
}) {
  // §3.2 — a lock is supposed to mean the target does not move for anyone. It
  // already stopped Balance and Move; the manual input was the hole, disabled by
  // `readOnly` alone, so a locked line could still be retyped by hand. Locking
  // now closes that too.
  const disabled = readOnly || line.locked;
  const dollars = money2(line.target);
  const percent = payable > 0 ? `${line.percentOfPayable.toFixed(1)}% of budget` : '—';

  return (
    <div className="inline-flex flex-col items-end">
      <span className="inline-flex items-center gap-1">
        {line.locked && (
          <Tooltip label="Locked — Balance, Move and this box all leave the target where it is. Unlock it from the control beside the campaign name.">
            <LockClosedIcon className="h-3 w-3 flex-shrink-0 cursor-help text-[var(--muted-foreground)]" />
          </Tooltip>
        )}
        {/* Sized to the UNIT, not to the widest thing either unit could hold.
            A flat 86px fits "$1,694.00", but the card is in percent mode by
            default, where "13%" is half that — and because the figure is
            right-aligned inside the box, all the slack lands between the lock
            glyph and the number it is about. The glyph ended up further from its
            own value than from the next column. */}
        <span className={mode === 'pct' ? 'w-[54px]' : 'w-[84px]'}>
          <InlineMoneyCell
            value={formatInput(line.input, mode)}
            ariaLabel={`${mode === 'pct' ? 'Percent' : 'Dollar'} allocation for ${line.name}`}
            disabled={disabled}
            display={
              <span className="block text-right text-sm font-semibold tabular-nums text-[var(--foreground)]">
                {mode === 'pct' ? `${Number(line.input.toFixed(2))}%` : dollars}
              </span>
            }
            onCommit={(next) => {
              const parsed = Number(next);
              if (next == null || !Number.isFinite(parsed) || parsed < 0) return;
              if (Math.abs(parsed - line.input) > 0.0001) onInput(parsed);
            }}
          />
        </span>
      </span>
      {/* The other unit — always shown, never editable.

          §A.1 — a CAPTION, on one line. It inherited the table's own text size,
          which put it within a hair of the figure above it and wrapped
          "10.9% of budget" across two or three lines on a narrow allocation
          column; every row in the table paid for that in height. The active unit
          is the number; this rides quietly beneath it. */}
      <Tooltip
        label={
          mode === 'pct'
            ? 'The dollars this percent resolves to against the month’s actual spend. This is the figure the pace math uses.'
            : 'This amount as a share of the month’s actual spend.'
        }
      >
        <span className="cursor-help whitespace-nowrap text-[10px] leading-tight tabular-nums text-[var(--muted-foreground)]">
          {mode === 'pct' ? dollars : percent}
        </span>
      </Tooltip>
    </div>
  );
}

/**
 * §2.4/§2.5 — the current daily, with the pencil that edits it.
 *
 * The lightning "apply recommended" control this replaced could only ever write
 * one number. The desk's actual move is often a different one — meet the
 * recommendation halfway, hold a campaign that cannot absorb the raise, step a
 * budget up rather than jump it — and none of those were expressible without
 * leaving for Google Ads. The box is the Meta pacer's, mechanics and all, with
 * Google's projection rules (§2.5) instead of Meta's.
 */
/** What the row publishes upward while a daily budget is being typed: the value
 *  AND the projection computed from it, so every surface that reads it renders
 *  the same landing rather than recomputing one of its own. */
interface TypedDailyEdit {
  daily: number;
  projection: TypedDailyProjection;
}

function DailyBudgetCell({
  line,
  ad,
  dataEdgeIso,
  readOnly,
  pushing,
  googleConnected,
  onPushDaily,
  deliveryAvgDaily,
  daysInMonth,
  remainingCalendarDays,
  onTypedDailyChange,
}: {
  line: AllocatorLine;
  ad: PacerAd | undefined;
  dataEdgeIso: string | null;
  readOnly: boolean;
  pushing: boolean;
  googleConnected: boolean;
  onPushDaily: (adId: string, amount: number) => Promise<{ ok: boolean; error?: string }>;
  /** Flight-to-date delivery, or null when there is too little of it (§2.5). */
  deliveryAvgDaily: number | null;
  /** Month context for the billing ceiling's weighted average — a rate set today
   *  only buys the days that are left, not a whole 30.4-day month. */
  daysInMonth: number;
  /** Calendar days left in the MONTH at the data edge — what Google's monthly
   *  limit counts. Never the flight's remaining days. */
  remainingCalendarDays: number;
  onTypedDailyChange: (value: TypedDailyEdit | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  // Opens populated with the CURRENT daily, never the recommended one (§2.4) —
  // the box edits the current value, and pre-filling the recommendation would
  // make "Cancel" the only way to not accept it.
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const typed = Number(draft);
  const typedValid = draft.trim() !== '' && Number.isFinite(typed) && typed > 0;
  const changed = typedValid && !moneyEq(typed, line.currentDaily);

  const projection = useMemo(
    () =>
      projectAtTypedDaily({
        spentMTD: line.spentMTD,
        recentAvgDaily: deliveryAvgDaily,
        typedDaily: typedValid ? typed : line.currentDaily,
        remainingDays: line.flight.remaining,
        currentDaily: line.currentDaily,
        remainingCalendarDays,
      }),
    [
      line.spentMTD,
      line.currentDaily,
      line.flight.remaining,
      deliveryAvgDaily,
      remainingCalendarDays,
      daysInMonth,
      typed,
      typedValid,
    ],
  );

  // Publish the typed value and its projection up, so the recommended arrow
  // beside this cell — and the money line in the open delivery panel — follow
  // the number being typed rather than the daily that is still set (§2.4, §2.5).
  useEffect(() => {
    onTypedDailyChange(editing && typedValid ? { daily: typed, projection } : null);
  }, [editing, typedValid, typed, projection, onTypedDailyChange]);
  useEffect(() => () => onTypedDailyChange(null), [onTypedDailyChange]);

  // Is the value being typed a raise this campaign cannot act on? The same cap
  // read the row's "Capped · headroom" tag uses, so the box and the tag can
  // never contradict each other about whether the budget is the constraint.
  // Kept from the lightning control this box replaced: the warning was the one
  // thing that control did which a free-text field would otherwise lose.
  const futileRaise =
    typedValid &&
    isFutileRaise({
      currentDaily: line.currentDaily,
      recommendedDaily: typed,
      delivery: capDelivery({
        budgetConstrained: line.budgetLimited,
        channelType: line.channelType,
        budgetLostIsRaw: ad?.googleSearchBudgetLostIs ?? null,
        series: ad?.dailySpend,
        cap: line.currentDaily,
        dataEdgeIso,
      }),
    });

  const eligibility = applyEligibility(line, ad?.googleBudgetResourceName ?? null);
  const blocked = !eligibility.ok && eligibility.reason ? eligibility.reason : null;
  const pushedAt = ad?.googleDailyPushedAt ? new Date(ad.googleDailyPushedAt) : null;
  // Google re-paces over 24–48h, so a push inside that window is still settling
  // and the numbers on this row still describe the OLD rate.
  const settling =
    pushedAt != null && Date.now() - pushedAt.getTime() < GOOGLE_SETTLING_HOURS * 3600 * 1000;

  const begin = () => {
    setDraft(line.currentDaily > 0 ? line.currentDaily.toFixed(2) : '');
    setMsg(null);
    setEditing(true);
  };
  const cancel = () => {
    // Discards the entry without writing (§2.4) — the daily in Google is
    // untouched either way, so this only clears the box.
    setDraft('');
    setMsg(null);
    setEditing(false);
  };
  const push = async () => {
    if (!typedValid || busy) return;
    setBusy(true);
    setMsg(null);
    const result = await onPushDaily(line.id, Number(typed.toFixed(2)));
    setBusy(false);
    setMsg(
      result.ok
        ? { ok: true, text: `Pushed ${fmt(typed)}/day to Google` }
        : { ok: false, text: result.error ?? 'Could not push to Google' },
    );
  };

  if (!line.dailyControllable) {
    return (
      <Tooltip label="Google paces a total budget to its own end date — there's no daily rate to set.">
        <span className="text-xs text-[var(--muted-foreground)]">—</span>
      </Tooltip>
    );
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-end gap-1.5">
        <span className="text-sm tabular-nums text-[var(--foreground)]">
          {line.currentDaily > 0 ? (
            fmt(line.currentDaily)
          ) : (
            <Tooltip label="No daily budget synced from Google yet — import or sync this campaign.">
              <span className="text-[var(--muted-foreground)]">—</span>
            </Tooltip>
          )}
        </span>
        {settling && (
          <Tooltip
            label={`Applied ${fmtRelativeHours(pushedAt as Date)}. Google re-paces over 24–48 hours, so today's spend still reflects the old rate — you can change it again, but the numbers have not caught up yet.`}
          >
            <ClockIcon className="h-3 w-3" style={{ color: COLORS.daily }} />
          </Tooltip>
        )}
        <Tooltip
          label={
            blocked
              ? applyBlockedReason(blocked)
              : !googleConnected
                ? 'Connect Google Ads to change daily budgets from here.'
                : 'Edit daily budget'
          }
        >
          <button
            type="button"
            onClick={begin}
            disabled={readOnly || pushing || !googleConnected || blocked != null}
            aria-label={`Edit daily budget for ${line.name}`}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PencilSquareIcon className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="ml-auto w-[210px] space-y-1.5 text-left">
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)]">
          $
        </span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ''))}
          autoFocus
          inputMode="decimal"
          placeholder="0.00"
          aria-label={`Daily budget for ${line.name}`}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] py-1.5 pl-6 pr-10 text-sm tabular-nums text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[var(--muted-foreground)]">
          /day
        </span>
      </div>

      {/* §2.5 — the live projection, INSIDE the box so it is readable whether or
          not the row is expanded.

          It STATES ITS REASONING. The readout was two bare figures — "Projected
          $355.70 of $372.34 / billing ceiling $273.60" — and neither said where
          it came from, so a projection that refused to climb when the budget was
          raised read as a stuck number rather than as the finding it is. Each
          line now names what is binding it. */}
      <div className="space-y-1.5 rounded-lg bg-[var(--muted)]/50 px-2.5 py-2">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] text-[var(--muted-foreground)]">Monthly projection</span>
            <span className="text-sm font-bold tabular-nums text-[var(--foreground)]">
              {fmt(projection.projected)}
            </span>
          </div>
          <div className="text-[10px] leading-tight text-[var(--muted-foreground)]">
            {projection.boundBy === 'delivery' ? (
              <>
                unchanged — {fmt(typedValid ? typed : line.currentDaily)} is above the{' '}
                {fmt(deliveryAvgDaily ?? 0)}/day it is currently delivering, so raising will not
                lift spend
              </>
            ) : projection.boundBy === 'ceiling' ? (
              <>held at the billing ceiling — Google will not bill past it this month</>
            ) : deliveryAvgDaily == null ? (
              <>
                {fmt(line.spentMTD)} spent + {fmt(typedValid ? typed : line.currentDaily)}/day ×{' '}
                {line.flight.remaining}d — a ceiling, not a forecast: too little delivery yet to
                state a run rate
              </>
            ) : (
              <>
                {fmt(line.spentMTD)} spent + {fmt(typedValid ? typed : line.currentDaily)}/day ×{' '}
                {line.flight.remaining}d left — the budget is what caps it at this rate
              </>
            )}
          </div>
        </div>
        <div className="flex items-baseline justify-between gap-2 border-t border-[var(--border)] pt-1.5">
          <Tooltip label={`The most Google can charge this campaign for the month. Untouched, a daily budget limits the month to itself × 30.4. Change it mid-month and Google re-bases: what is already spent, plus the new daily × the ${remainingCalendarDays} calendar day${remainingCalendarDays === 1 ? '' : 's'} left. It is NOT the new daily × 30.4 — that would price a rate set today as though it had run all month.`}>
            <span className="cursor-help text-[10px] text-[var(--muted-foreground)]">
              Billing ceiling
            </span>
          </Tooltip>
          <span className="text-[11px] font-semibold tabular-nums text-[var(--foreground)]">
            {moneyEq(projection.billingCeiling, projection.billingCeilingBefore) ? (
              fmt(projection.billingCeiling)
            ) : (
              <>
                <span className="font-normal text-[var(--muted-foreground)]">
                  {fmt(projection.billingCeilingBefore)}
                </span>{' '}
                → {fmt(projection.billingCeiling)}
              </>
            )}
          </span>
        </div>
      </div>

      {futileRaise && changed && (
        <div className="text-[10px] leading-tight" style={{ color: COLORS.warn }}>
          It is not spending the daily it already has, so this raise is unlikely to move spend —
          this is budget worth moving instead.
        </div>
      )}

      {/* Appears the moment the typed value differs from what is set — nothing
          is written until it is pressed. */}
      {changed && (
        <button
          type="button"
          onClick={push}
          disabled={busy || pushing || readOnly}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-[11px] font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <ArrowPathIcon className="h-3 w-3 animate-spin" /> : <BoltIcon className="h-3 w-3" />}
          {busy ? 'Pushing…' : 'Push to Google'}
        </button>
      )}

      <div className="flex items-center justify-end gap-4 text-[11px]">
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setMsg(null);
          }}
          disabled={busy}
          className="font-semibold text-[var(--primary)] transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          Done
        </button>
      </div>
      {msg && (
        <div
          className="text-[10px] leading-tight"
          style={{ color: msg.ok ? COLORS.success : COLORS.error }}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}

/**
 * §2.4 — the recommended daily, with its arrow on the RIGHT of the number.
 *
 * The arrow describes the gap to the recommendation. At rest that is the
 * recommendation against the daily currently set; while someone is typing a new
 * daily it re-references live to what they are typing, so it always answers "is
 * the number I am about to set above or below the recommendation" and flips as
 * the typed value crosses it.
 */
function RecommendedDaily({
  line,
  typedDaily,
}: {
  line: AllocatorLine;
  typedDaily: number | null;
}) {
  const against = typedDaily ?? line.currentDaily;
  const live = typedDaily != null;
  const trend =
    against <= 0
      ? 'flat'
      : line.recommendedDaily > against * 1.02
        ? 'up'
        : line.recommendedDaily < against * 0.98
          ? 'down'
          : 'flat';
  return (
    <div className="flex items-center justify-end gap-1">
      <span className="text-sm font-bold tabular-nums text-[var(--foreground)]">
        {fmt(line.recommendedDaily)}
      </span>
      {trend !== 'flat' && (
        <Tooltip
          label={
            trend === 'up'
              ? live
                ? `Higher than the ${fmt(against)} you are typing — this campaign needs more than that to land on target.`
                : 'Higher than the daily currently set in Google — raise it to land on target.'
              : live
                ? `Lower than the ${fmt(against)} you are typing — that would put this campaign ahead of target.`
                : 'Lower than the daily currently set in Google — ease it off to land on target.'
          }
        >
          {trend === 'up' ? (
            <ArrowSmallUpIcon
              className="h-3.5 w-3.5 stroke-[2.5]"
              style={{ color: COLORS.lifetime }}
              aria-label="above the daily it is measured against"
            />
          ) : (
            <ArrowSmallDownIcon
              className="h-3.5 w-3.5 stroke-[2.5]"
              style={{ color: COLORS.warn }}
              aria-label="below the daily it is measured against"
            />
          )}
        </Tooltip>
      )}
    </div>
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
 * Plan total vs live total (§14, reworked by addendum §5). Two numbers that
 * answer different questions: what the plan wants set, and what is set. They
 * match when everything is applied and nothing has drifted; otherwise the gap IS
 * the state of the account, and a partial apply becomes visible and actionable
 * instead of a silent discrepancy.
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
  // The gap, stated from the PLAN's point of view — this sits under the plan
  // total, so "$56 under live" says what the number above it is, not what the
  // other column is. §5: the live dollar figure itself is deliberately absent;
  // the cell to the left already prints it.
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
            } Applying never changes the plan total — only the live one moves. A gap is a readout, not an error: applying the working raises and cuts and leaving demand-limited underspenders alone is a normal end state.`
      }
    >
      <span className="cursor-help text-[10px] tabular-nums text-[var(--muted-foreground)]">
        {inSync ? (
          <span style={{ color: COLORS.success }}>in sync</span>
        ) : (
          <span style={{ color: delta > 0 ? COLORS.warn : COLORS.daily }}>
            {fmt(Math.abs(delta))} {delta > 0 ? 'under' : 'over'} live
          </span>
        )}
      </span>
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

/**
 * Hold a typed amount at or below the movable cap (§9). The cap is the ONE hard
 * limit in the Move tool, so it is enforced at the keystroke rather than as a
 * validation message after the fact — a number that cannot be committed should
 * not be typeable.
 *
 * Partial input ("", "12.") passes through untouched; clamping mid-keystroke
 * would fight the person typing.
 */
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
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
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
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
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
