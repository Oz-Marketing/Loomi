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
  ArrowUturnLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  InformationCircleIcon,
  LockClosedIcon,
  LockOpenIcon,
  MinusSmallIcon,
  PlusSmallIcon,
} from '@heroicons/react/24/outline';
import { GoogleAdsBrandIcon } from '@/components/icons/platform-logos';
import { COLORS } from '@/lib/ad-pacer/constants';
import { fmt, fmtDate, num } from '@/lib/ad-pacer/helpers';
import { collectLabels, serializeTags } from '@/lib/ad-pacer/labels';
import {
  balance,
  buildAllocatorView,
  convertMode,
  planMove,
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
import { LabelChips, LabelFilterBar, Tooltip } from '@/app/app/tools/_shared';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { zonedTodayIso } from '@/lib/timezone';
import { toast } from '@/lib/toast';
import { GoogleDeliveryHealthModal } from './GoogleDeliveryHealthModal';
import { PACE_COLORS, PACE_LABELS, campaignColor } from './google-pacing-theme';

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
  onPushBudgets: () => void;
  pushing?: boolean;
  googleConnected: boolean;
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
}: GooglePacingCardProps) {
  const readOnly = frozen;
  const [mode, setMode] = useState<AllocationMode>(plan.allocationMode ?? 'pct');
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [eventBudgets, setEventBudgets] = useState<Record<string, number>>(
    plan.eventBudgets ?? {},
  );
  const [healthLineId, setHealthLineId] = useState<string | null>(null);
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

  const healthLine = healthLineId ? view.lines.find((l) => l.id === healthLineId) : null;

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
      {/* ── Account allocation panel ──
          Same shape as Meta's TotalAllocationHeader: title + a right-aligned
          stat cluster, then the allocation bar with a legend underneath. The
          allocator's extra numbers (payable, spend, pace) join that cluster
          rather than getting a strip of their own. */}
      <div className="glass-section-card rounded-xl px-5 py-4 mb-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-baseline gap-2.5">
            <span className="text-sm font-bold uppercase tracking-wider text-[var(--foreground)]">
              {view.activeLabel ?? 'Account'} Allocation
            </span>
            <span className="text-[10px] text-[var(--muted-foreground)]">
              {clock.dataEdgeIso ? (
                <>
                  data through {fmtDate(clock.dataEdgeIso)} · day{' '}
                  {clock.todayDay ?? clock.daysInMonth} of {clock.daysInMonth}
                </>
              ) : (
                <>no settled days yet · {clock.daysInMonth}-day month</>
              )}
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
          <div className="flex flex-wrap gap-3">
            {/* §9 required rescoping: in a label view the account's budget and
                payable are not this slice's numbers, so they're replaced by the
                denominator the slice is actually measured against. Leaving them
                up would be the worst case — account-wide figures sitting over a
                filtered table, looking authoritative. */}
            {view.activeLabel ? (
              <Stat
                label={view.denominatorKind === 'eventBudget' ? 'Event Budget' : 'Tagged Total'}
                value={fmt(view.totals.denominator)}
                tooltip={
                  view.denominatorKind === 'eventBudget'
                    ? 'The budget you intended for this label. The tagged allocation is checked against it.'
                    : 'No event budget set for this label, so the tagged campaigns are checked against their own total.'
                }
              />
            ) : (
              <>
                <Stat
                  label="Total Budget"
                  value={fmt(totalBudget)}
                  tooltip="The client's budget for the month, before the markup. Set it on the Planner tab."
                />
                <Stat
                  label="Adjusted Payable"
                  value={fmt(payable)}
                  color={carryoverNote !== 0 ? COLORS.warn : undefined}
                  tooltip={`Client budget × ${(markup * 100).toFixed(1)}% markup — the spend that actually reaches Google, and the denominator every allocation is measured against.${
                    carryoverNote !== 0
                      ? ` This month also carries a ${money2(carryoverNote)} reconciliation carryover, which is NOT included — apply it to the budget number if you want it paced.`
                      : ''
                  }`}
                />
              </>
            )}
            <Stat
              label="Spent MTD"
              value={fmt(view.totals.spent)}
              color={COLORS.daily}
              tooltip="Delivered so far this month, from Google. Served cost, not billed."
            />
            <Stat
              label="Expected MTD"
              value={fmt(view.totals.expected)}
              tooltip="What should have been spent by now, at an even pace across each campaign's own flight days."
            />
            <Stat
              label={view.activeLabel ? 'Label Pace' : 'Account Pace'}
              value={PACE_LABELS[view.totals.paceStatus]}
              color={PACE_COLORS[view.totals.paceStatus]}
              tooltip={
                view.totals.paceRatio != null
                  ? `Spent is ${Math.round(view.totals.paceRatio * 100)}% of expected. On track is within 12% either way — Google can spend up to 2× the daily on a busy day, so a tighter band would flip on any busy Saturday.`
                  : 'No settled days yet.'
              }
            />
          </div>
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
                label={`${l.name}: ${fmt(l.target)} (${l.percentOfPayable.toFixed(1)}% of payable)${l.locked ? ' · locked' : ''}`}
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
          <div className="text-[10px] text-[var(--muted-foreground)]">
            Allocated{' '}
            <span className="font-bold" style={{ color: allocColor }}>
              {fmt(view.totals.allocated)}
            </span>{' '}
            of {fmt(view.totals.denominator)} {denominatorNoun(view)}
          </div>
          {!view.totals.fullyAllocated && (
            <div className="text-[10px] font-bold" style={{ color: allocColor }}>
              {view.totals.unallocated > 0
                ? `${fmt(view.totals.unallocated)} unallocated`
                : `${fmt(-view.totals.unallocated)} over`}
            </div>
          )}
          {view.totals.lockedTarget > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]">
              <LockClosedIcon className="h-2.5 w-2.5" />
              {fmt(view.totals.lockedTarget)} locked
            </div>
          )}
          <div className="ml-auto text-[10px] text-[var(--muted-foreground)]">
            {fmt(Math.max(0, view.totals.denominator - view.totals.spent))} left to spend ·{' '}
            <span className="font-bold text-[var(--foreground)]">
              {fmt(view.totals.accountDaily)}/day
            </span>{' '}
            across campaigns
          </div>
        </div>
      </div>

      {/* ── Controls: allocation unit + label view ── */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Allocate by
          </span>
          {/* Same Loomi combobox as the Move source, minus the search — two
              options don't need filtering, but they should look like one control
              family. */}
          <div className="w-36">
            <SearchableSelect
              value={mode}
              onChange={(value) => switchMode(value as AllocationMode)}
              disabled={readOnly}
              searchable={false}
              options={[
                { value: 'amt', label: '$ amount' },
                { value: 'pct', label: '% of payable' },
              ]}
            />
          </div>
          <Tooltip
            label={
              mode === 'pct'
                ? 'Every line is a percent of the adjusted payable — they should total 100%. Percent is always percent of payable, never of "payable minus the locked lines".'
                : 'Every line is a fixed dollar amount — they should total the payable.'
            }
          >
            <InformationCircleIcon className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          </Tooltip>
        </div>
        <LabelFilterBar
          ads={ads}
          activeLabel={activeLabel}
          onChange={setActiveLabel}
          className="mb-0"
        />
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

      {/* ── The campaign table ── */}
      <div className="glass-table">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px]">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]">
                <th className="w-10 px-2 py-2" />
                <Th align="left">Campaign</Th>
                <Th className="w-[150px]">Allocation</Th>
                <Th>Monthly Target</Th>
                <Th>Spent MTD</Th>
                <Th tooltip="Target × (flight days elapsed ÷ total flight days) — what should have been spent by now at an even pace.">
                  Expected MTD
                </Th>
                <Th align="left">Pace</Th>
                <Th tooltip="Monthly target ÷ flight days. A steady reference — it ignores spend so far.">
                  Even Pace
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
                  onInput={(value) => applyInputs(new Map([[line.id, value]]))}
                  onToggleLock={() => updateAd(line.id, { pacerLocked: !line.locked })}
                  onTagsChange={(tags) => updateAd(line.id, { pacerTags: serializeTags(tags) })}
                  onOpenHealth={() => setHealthLineId(line.id)}
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
                  {view.activeLabel ? 'Label total' : 'Account total'}
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
                  {fmt(view.totals.evenDaily)}
                </td>
                <td className="bg-[var(--muted)]/40 px-3 py-3 text-right">
                  <span
                    className="text-sm font-bold tabular-nums"
                    style={{ color: 'var(--primary)' }}
                  >
                    {fmt(view.totals.accountDaily)}
                  </span>
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

      {/* ── Move / distribute (§8) ── */}
      <MovePanel
        view={view}
        mode={mode}
        payable={payable}
        readOnly={readOnly}
        onCommit={(inputs, summary) => {
          applyInputs(inputs);
          toast.success(summary);
        }}
      />

      {/* ── Actions ── */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Tooltip
          label={
            !googleConnected
              ? 'Connect Google Ads to push budgets'
              : 'Sets each campaign’s average daily budget in Google to its New Daily Budget. One batched update for the account; shared budgets are skipped, and only campaigns whose rate has drifted are touched.'
          }
        >
          <button
            type="button"
            onClick={onPushBudgets}
            disabled={readOnly || pushing || !googleConnected}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pushing ? (
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
            ) : (
              <GoogleAdsBrandIcon className="h-4 w-4" />
            )}
            Apply daily budgets
          </button>
        </Tooltip>
        <BalanceButton readOnly={readOnly} onBalance={doBalance} />
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

      {healthLine && (
        <GoogleDeliveryHealthModal
          accountKey={accountKey}
          period={period}
          line={healthLine}
          daysInMonth={clock.daysInMonth}
          readOnly={readOnly}
          onClose={() => setHealthLineId(null)}
          onFlightChange={(startDay, endDay) => {
            const pad = (n: number) => String(n).padStart(2, '0');
            updateAd(healthLine.id, {
              googleFlightStartOverride: `${period}-${pad(startDay)}`,
              googleFlightEndOverride: `${period}-${pad(endDay)}`,
            });
          }}
        />
      )}
    </div>
  );
}

function denominatorNoun(view: AllocatorView): string {
  return view.denominatorKind === 'payable'
    ? 'payable'
    : view.denominatorKind === 'eventBudget'
      ? 'event budget'
      : 'tagged total';
}

/** Right-aligned stat in the allocation panel's cluster — same chrome as Meta's
 *  Total Gross / Total Actual Spend / Allocated trio. */
function Stat({
  label,
  value,
  color,
  tooltip,
}: {
  label: string;
  value: string;
  color?: string;
  tooltip?: string;
}) {
  const body = (
    <div className="text-right">
      <div className="whitespace-nowrap text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </div>
      <div className="text-base font-bold" style={{ color: color ?? 'var(--foreground)' }}>
        {value}
      </div>
    </div>
  );
  return tooltip ? <Tooltip label={tooltip}>{body}</Tooltip> : body;
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
        label={`The budget you intended for “${label}” — e.g. the added sales-event dollars. The tagged allocation is checked against it. This never changes the account's payable.`}
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
  onInput,
  onToggleLock,
  onTagsChange,
  onOpenHealth,
}: {
  line: AllocatorLine;
  ad: PacerAd | undefined;
  mode: AllocationMode;
  payable: number;
  allLabels: readonly string[];
  readOnly: boolean;
  onInput: (value: number) => void;
  onToggleLock: () => void;
  onTagsChange: (tags: string[]) => void;
  onOpenHealth: () => void;
}) {
  const [draft, setDraft] = useState(formatInput(line.input, mode));
  // Follow the row when the value changes from anywhere else (balance, move,
  // undo, a mode switch) — but never while the field has focus, or a rebuild
  // would yank the cursor mid-type.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setDraft(formatInput(line.input, mode));
    }
  }, [line.input, mode]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(formatInput(line.input, mode));
      return;
    }
    if (Math.abs(parsed - line.input) > 0.0001) onInput(parsed);
  };

  // The recommended daily read against the even pace: up means it has to catch
  // up, down means it has to ease off. Purely directional — the number is the
  // instruction.
  const trend =
    line.recommendedDaily > line.evenDaily * 1.02
      ? 'up'
      : line.recommendedDaily < line.evenDaily * 0.98
        ? 'down'
        : 'flat';

  return (
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
      </td>

      <td className="px-3 py-2.5 text-left align-middle">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="h-2 w-2 flex-shrink-0 rounded-sm"
            style={{ background: campaignColor(line.colorIndex) }}
          />
          <span className="text-sm font-semibold text-[var(--foreground)]">{line.name}</span>
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
          {line.budgetLimited && (
            <Tag
              color={COLORS.success}
              label="Capped · headroom"
              tooltip="Limited by budget — it spends its full daily every day and could absorb more."
            />
          )}
        </div>
        <LabelChips
          tags={ad?.pacerTags}
          allLabels={allLabels}
          readOnly={readOnly}
          onChange={onTagsChange}
        />
      </td>

      <td className="px-3 py-2.5 text-right align-middle">
        <div className="inline-flex items-center justify-end gap-1.5">
          <div className="relative">
            {mode === 'amt' && (
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)]">
                $
              </span>
            )}
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              disabled={readOnly}
              inputMode="decimal"
              aria-label={`${mode === 'pct' ? 'Percent' : 'Dollar'} allocation for ${line.name}`}
              className={`w-[78px] rounded-lg border border-[var(--border)] bg-[var(--input)] py-1.5 pr-2 text-right text-sm tabular-nums text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none disabled:opacity-60 ${
                mode === 'amt' ? 'pl-5' : 'pl-2'
              }`}
            />
          </div>
          {mode === 'pct' ? (
            <span className="w-2 text-xs text-[var(--muted-foreground)]">%</span>
          ) : (
            // §3 companion readout: in dollar mode each line still shows its
            // share of payable, so the plan stays legible without switching unit.
            <Tooltip label="Share of the adjusted payable">
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
          <Tooltip label="Open delivery health — is it spending its full daily, and can it absorb more?">
            <button
              type="button"
              onClick={onOpenHealth}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)] transition-opacity hover:opacity-70"
            >
              <span
                className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{ background: PACE_COLORS[line.paceStatus] }}
              />
              <span style={{ color: PACE_COLORS[line.paceStatus] }}>
                {PACE_LABELS[line.paceStatus]}
              </span>
              <ChevronRightIcon className="h-3 w-3 text-[var(--muted-foreground)]" />
            </button>
          </Tooltip>
        </div>
        {line.expectedToDate > 0 && (
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
        {fmt(line.evenDaily)}
      </td>

      <td className="bg-[var(--muted)]/40 px-3 py-2.5 text-right align-middle">
        {line.dailyControllable ? (
          <div className="flex items-center justify-end gap-1">
            <span className="text-sm font-bold tabular-nums text-[var(--foreground)]">
              {fmt(line.recommendedDaily)}
            </span>
            {trend !== 'flat' && (
              <Tooltip
                label={
                  trend === 'up'
                    ? 'Above its even pace — it has ground to make up over the days left.'
                    : 'Below its even pace — it is ahead and should ease off to land on target.'
                }
              >
                {trend === 'up' ? (
                  <ChevronUpIcon
                    className="h-3.5 w-3.5 stroke-[2.5]"
                    style={{ color: COLORS.lifetime }}
                    aria-label="above even pace"
                  />
                ) : (
                  <ChevronDownIcon
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
      <Tooltip label="Scale the unlocked lines so the plan totals the payable, keeping their relative shape. Locked lines are never touched.">
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
      {open && (
        <div className="glass-modal absolute bottom-full left-0 z-40 mb-1.5 w-64 rounded-xl border border-[var(--border)] p-1">
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

function MovePanel({
  view,
  mode,
  payable,
  readOnly,
  onCommit,
}: {
  view: AllocatorView;
  mode: AllocationMode;
  payable: number;
  readOnly: boolean;
  onCommit: (inputs: Map<string, number>, summary: string) => void;
}) {
  const [sourceKey, setSourceKey] = useState<string>('');
  const [method, setMethod] = useState<MoveMethod>('even');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [evenTotal, setEvenTotal] = useState('');
  const [custom, setCustom] = useState<Record<string, string>>({});

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
    <div className="glass-section-card mt-4 rounded-xl px-5 py-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
        <span className="text-sm font-bold uppercase tracking-wider text-[var(--foreground)]">
          Move Budget
        </span>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          Pull from one source and spread it across the campaigns you pick — the{' '}
          {view.activeLabel ? 'label' : 'account'} total holds steady.
        </span>
      </div>

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
                label: `${o.name} (${fmt(o.target)})`,
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
              onChange={(e) => setEvenTotal(e.target.value)}
              disabled={readOnly}
              inputMode="decimal"
              placeholder="total to spread"
              aria-label="Total to spread"
              className="w-40 rounded-lg border border-[var(--border)] bg-[var(--input)] py-2 pl-6 pr-2.5 text-sm tabular-nums text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none disabled:opacity-60"
            />
          </div>
        )}
        {source && (
          <span className="text-[10px] tabular-nums text-[var(--muted-foreground)]">
            {fmt(available)} available
          </span>
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
                      onChange={(e) => setCustom((c) => ({ ...c, [o.id]: e.target.value }))}
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
        </div>
      )}

      <div className="mt-3.5 flex items-center gap-3">
        <button
          type="button"
          onClick={commit}
          disabled={readOnly || !plan?.ok}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Move
        </button>
        {plan?.ok && (
          <span className="text-[10px] tabular-nums text-[var(--muted-foreground)]">
            Moving {fmt(plan.total)} across {plan.allocations.length} campaign
            {plan.allocations.length === 1 ? '' : 's'}
          </span>
        )}
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
