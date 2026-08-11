'use client';

/**
 * Card view of one allocator line — the alternative to the table, following
 * Meta's PacerRow: a collapsed header you can scan straight down, expanding to
 * a card whose top row is target spend (left) and flight (right).
 *
 * The two views render the SAME `AllocatorLine`, so nothing is recomputed here
 * and they cannot disagree. This file is layout only.
 *
 * COLUMN WIDTHS ARE SHARED with the totals line below the list (see COL) — the
 * header only reads as a table if every row and the total use one set of widths.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  LockClosedIcon,
  LockOpenIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import { COLORS } from '@/lib/ad-pacer/constants';
import { fmt } from '@/lib/ad-pacer/helpers';
import type { AllocationMode, AllocatorLine } from '@/lib/ad-pacer/google-allocator';
import type { PacerAd } from '@/lib/ad-pacer/types';
import { InlineMoneyCell, LabelChips, MetricBox, Tooltip } from '@/app/app/tools/_shared';
import { PACE_COLORS, PACE_LABELS, campaignColor } from './google-pacing-theme';

/** One set of column widths for the header rows AND the totals line. */
export const COL = {
  allocation: 'w-24',
  spent: 'w-28',
  daily: 'w-28',
  pace: 'w-36',
};

/** The pacing-health sentence behind the verdict. Says what the badge means and
 *  what it does NOT, since a single ratio invites over-reading. */
export function paceHelp(line: AllocatorLine): string {
  if (line.paceRatio == null) {
    return 'No settled days in this campaign’s flight yet, so there is nothing to compare against.';
  }
  const pct = Math.round(line.paceRatio * 100);
  const base = `Spent ${fmt(line.spentMTD)} against ${fmt(line.expectedToDate)} expected by now — ${pct}% of pace, ${line.paceDelta >= 0 ? 'ahead by' : 'behind by'} ${fmt(Math.abs(line.paceDelta))}. Expected is the target spread evenly across this campaign's own ${line.flight.total} flight days, not the month's.`;
  const band =
    ' On track is within 12% either way: Google can spend up to 2× the daily on a busy day, so a tighter band would flip on any busy Saturday.';
  const caveat =
    line.paceStatus === 'under'
      ? ' Behind can mean two different things — open delivery health to see whether it is spending its full daily or cannot spend at all.'
      : '';
  return base + band + caveat;
}

export function GoogleCampaignCard({
  line,
  ad,
  mode,
  payable,
  daysInMonth,
  allLabels,
  readOnly,
  expanded,
  onToggleExpanded,
  onInput,
  onToggleLock,
  onTagsChange,
  onOpenHealth,
  onFlightChange,
}: {
  line: AllocatorLine;
  ad: PacerAd | undefined;
  mode: AllocationMode;
  payable: number;
  daysInMonth: number;
  allLabels: readonly string[];
  readOnly: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onInput: (value: number) => void;
  onToggleLock: () => void;
  onTagsChange: (tags: string[]) => void;
  onOpenHealth: () => void;
  onFlightChange: (startDay: number, endDay: number) => void;
}) {
  const color = campaignColor(line.colorIndex);
  const paceColor = PACE_COLORS[line.paceStatus];

  return (
    <div className="glass-section-card mb-2 rounded-xl">
      {/* ── Collapsed header, columns aligned with the totals line ── */}
      <div className="flex w-full items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          {expanded ? (
            <ChevronDownIcon className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />
          ) : (
            <ChevronRightIcon className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />
          )}
          <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ background: color }} />
          <span className="min-w-0 truncate text-sm font-semibold text-[var(--foreground)]">
            {line.name}
          </span>
          {line.channelType && (
            <span className="hidden flex-shrink-0 text-[11px] text-[var(--muted-foreground)] sm:inline">
              {line.channelType}
            </span>
          )}
          {line.locked && (
            <LockClosedIcon className="h-3 w-3 flex-shrink-0 text-[var(--muted-foreground)]" />
          )}
        </button>

        {/* Allocation is editable right here — it is the number you come to change. */}
        <div className={`${COL.allocation} flex-shrink-0 text-right`}>
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
            Allocation
          </div>
          <InlineMoneyCell
            value={mode === 'pct' ? String(Number(line.input.toFixed(2))) : line.input.toFixed(2)}
            ariaLabel={`${mode === 'pct' ? 'Percent' : 'Dollar'} allocation for ${line.name}`}
            disabled={readOnly}
            display={
              <span className="block text-right text-sm font-bold tabular-nums text-[var(--foreground)]">
                {mode === 'pct' ? `${Number(line.input.toFixed(2))}%` : fmt(line.input)}
              </span>
            }
            onCommit={(next) => {
              const parsed = Number(next);
              if (next == null || !Number.isFinite(parsed) || parsed < 0) return;
              if (Math.abs(parsed - line.input) > 0.0001) onInput(parsed);
            }}
          />
        </div>

        <div className={`${COL.spent} hidden flex-shrink-0 text-right sm:block`}>
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
            Spent MTD
          </div>
          <div className="text-sm font-bold tabular-nums" style={{ color: COLORS.daily }}>
            {fmt(line.spentMTD)}
          </div>
        </div>

        <div className={`${COL.daily} hidden flex-shrink-0 text-right sm:block`}>
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
            Current Daily
          </div>
          <div className="text-sm font-bold tabular-nums text-[var(--foreground)]">
            {line.currentDaily > 0 ? fmt(line.currentDaily) : '—'}
          </div>
        </div>

        <div className={`${COL.pace} flex flex-shrink-0 justify-end`}>
          <Tooltip label={paceHelp(line)} placement="bottom">
            <button
              type="button"
              onClick={onOpenHealth}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-opacity hover:opacity-80"
              style={{ background: `${paceColor}1f`, color: paceColor }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: paceColor }} />
              {PACE_LABELS[line.paceStatus]}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* ── Expanded body ── */}
      {expanded && (
        <div className="border-t border-[var(--border)] px-4 py-4">
          {/* Meta's shape: the money on the left, the window on the right. */}
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Target Spend
              </div>
              <div className="mt-0.5 text-2xl font-bold tabular-nums leading-tight text-[var(--foreground)]">
                {fmt(line.target)}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-[var(--muted-foreground)]">
                  {payable > 0 ? `${line.percentOfPayable.toFixed(1)}% of actual spend` : '—'}
                </span>
                <Tooltip
                  label={
                    line.locked
                      ? 'Locked — protected from Balance and from Move.'
                      : 'Lock this budget — a fixed carve-out Balance and Move leave alone.'
                  }
                >
                  <button
                    type="button"
                    onClick={onToggleLock}
                    disabled={readOnly}
                    aria-pressed={line.locked}
                    aria-label={line.locked ? `Unlock ${line.name}` : `Lock ${line.name}`}
                    className={`inline-flex h-5 w-5 items-center justify-center rounded border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      line.locked
                        ? 'border-[var(--foreground)]/30 bg-[var(--foreground)]/10 text-[var(--foreground)]'
                        : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    {line.locked ? (
                      <LockClosedIcon className="h-2.5 w-2.5" />
                    ) : (
                      <LockOpenIcon className="h-2.5 w-2.5" />
                    )}
                  </button>
                </Tooltip>
              </div>
            </div>

            <FlightBlock
              line={line}
              daysInMonth={daysInMonth}
              readOnly={readOnly}
              onChange={onFlightChange}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            <MetricBox
              label="Spent MTD"
              value={fmt(line.spentMTD)}
              sub={`${line.flight.elapsed} of ${line.flight.total} days in`}
              color={COLORS.daily}
            />
            <MetricBox
              label="Expected MTD"
              value={fmt(line.expectedToDate)}
              sub={
                line.expectedToDate > 0
                  ? `${line.paceDelta >= 0 ? '+' : '−'}${fmt(Math.abs(line.paceDelta))} vs actual`
                  : 'nothing expected yet'
              }
            />
            {/* Verdict lives in the box row, and opens the full health report. */}
            <Tooltip label={paceHelp(line)} className="w-full">
              <button
                type="button"
                onClick={onOpenHealth}
                className="metric-box w-full rounded-lg bg-[var(--muted)]/40 px-3 py-2.5 text-left transition-colors hover:bg-[var(--muted)]/70"
              >
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Pacing
                </div>
                <div className="text-lg font-bold leading-tight" style={{ color: paceColor }}>
                  {PACE_LABELS[line.paceStatus]}
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                  {line.paceRatio != null
                    ? `${Math.round(line.paceRatio * 100)}% of pace · delivery health →`
                    : 'delivery health →'}
                </div>
              </button>
            </Tooltip>
            <MetricBox
              label="Spend Remaining"
              value={fmt(line.remainingBudget)}
              sub={`of ${fmt(line.target)} target`}
              tooltip="Target spend minus what has been spent so far — the money this campaign still has to deliver this month."
            />
            <MetricBox
              label="Projected Spend"
              value={line.projectedSpend != null ? fmt(line.projectedSpend) : '—'}
              sub={
                line.projectedSpend != null
                  ? `${line.projectedSpend >= line.target ? '+' : '−'}${fmt(Math.abs(line.projectedSpend - line.target))} vs target`
                  : 'no daily synced'
              }
              color={
                line.projectedSpend == null
                  ? undefined
                  : Math.abs(line.projectedSpend - line.target) <= line.target * 0.05
                    ? COLORS.success
                    : line.projectedSpend > line.target
                      ? COLORS.warn
                      : COLORS.lifetime
              }
              tooltip="Where this campaign lands if the daily budget is left exactly as it is: spent so far + current daily × remaining flight days. A forecast of the CURRENT setting — its job is to show what happens if nobody acts."
            />
            <MetricBox
              label="Rec. Daily Budget"
              value={line.dailyControllable ? fmt(line.recommendedDaily) : '—'}
              sub={
                line.dailyControllable
                  ? `${fmt(line.remainingBudget)} left ÷ ${line.flight.remaining}d`
                  : 'total budget — no daily lever'
              }
              detail={
                line.dailyControllable && line.currentDaily > 0
                  ? `now ${fmt(line.currentDaily)}/day`
                  : undefined
              }
              color={line.dailyControllable ? 'var(--primary)' : undefined}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <LabelChips
              tags={ad?.pacerTags}
              allLabels={allLabels}
              readOnly={readOnly}
              onChange={onTagsChange}
            />
            {line.shared && (
              <span
                className="text-[10px] font-bold uppercase tracking-wider"
                style={{ color: COLORS.daily }}
              >
                Shared budget — push skips it
              </span>
            )}
            {line.disapproved && (
              <span
                className="text-[10px] font-bold uppercase tracking-wider"
                style={{ color: COLORS.error }}
              >
                Ads disapproved — budget is not the problem
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Flight window, read-only until you ask to change it. The inline number boxes
 * were permanent form furniture for something adjusted once a month, so the
 * window now just reads as text with an Adjust button beside it.
 */
function FlightBlock({
  line,
  daysInMonth,
  readOnly,
  onChange,
}: {
  line: AllocatorLine;
  daysInMonth: number;
  readOnly: boolean;
  onChange: (startDay: number, endDay: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(String(line.flight.startDay));
  const [end, setEnd] = useState(String(line.flight.endDay));
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStart(String(line.flight.startDay));
    setEnd(String(line.flight.endDay));
  }, [line.flight.startDay, line.flight.endDay]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const commit = () => {
    const s = Math.min(Math.max(Number(start) || 1, 1), daysInMonth);
    const e = Math.min(Math.max(Number(end) || daysInMonth, s), daysInMonth);
    setStart(String(s));
    setEnd(String(e));
    if (s !== line.flight.startDay || e !== line.flight.endDay) onChange(s, e);
    setOpen(false);
  };

  const inputClass =
    'w-12 rounded border border-[var(--border)] bg-[var(--input)] px-1 py-1 text-center text-xs font-semibold tabular-nums text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none';

  return (
    <div ref={wrapRef} className="relative text-right">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        Flight this month
      </div>
      <div className="mt-0.5 text-lg font-bold tabular-nums leading-tight text-[var(--foreground)]">
        Day {line.flight.startDay}–{line.flight.endDay}
      </div>
      <div className="mt-1 flex items-center justify-end gap-2">
        <span className="text-[11px] tabular-nums text-[var(--muted-foreground)]">
          {line.flight.remaining} day{line.flight.remaining === 1 ? '' : 's'} left
        </span>
        {!readOnly && (
          <Tooltip label="Adjust flight">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label="Adjust flight"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
            >
              <PencilSquareIcon className="h-3 w-3" />
            </button>
          </Tooltip>
        )}
      </div>

      {open && (
        <div className="animate-dropdown-in absolute right-0 top-full z-40 mt-1.5 w-56 rounded-lg border border-[var(--border)] bg-[var(--card-strong)] p-3 text-left shadow-xl backdrop-blur-2xl backdrop-saturate-150">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Flight this month
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <span>day</span>
            <input
              value={start}
              onChange={(e) => setStart(e.target.value)}
              inputMode="numeric"
              aria-label={`Flight start day for ${line.name}`}
              className={inputClass}
            />
            <span>–</span>
            <input
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
              inputMode="numeric"
              aria-label={`Flight end day for ${line.name}`}
              className={inputClass}
            />
          </div>
          <div className="mt-2.5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commit}
              className="rounded-md bg-[var(--primary)] px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
