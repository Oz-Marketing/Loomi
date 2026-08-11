'use client';

/**
 * Card view of one allocator line — the alternative to the table, mirroring
 * Meta's PacerRow: a collapsed header you can scan down, and an expanded card
 * with the working numbers.
 *
 * The two views render the SAME `AllocatorLine`, so nothing is recomputed here
 * and the two can't disagree. This file is layout only.
 */

import { useEffect, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  LockClosedIcon,
  LockOpenIcon,
} from '@heroicons/react/24/outline';
import { COLORS } from '@/lib/ad-pacer/constants';
import { fmt } from '@/lib/ad-pacer/helpers';
import type { AllocationMode, AllocatorLine } from '@/lib/ad-pacer/google-allocator';
import type { PacerAd } from '@/lib/ad-pacer/types';
import { InlineMoneyCell, LabelChips, MetricBox, Tooltip } from '@/app/app/tools/_shared';
import { PACE_COLORS, PACE_LABELS, campaignColor } from './google-pacing-theme';

/** The pacing-health sentence behind the verdict's tooltip. Says what the badge
 *  means and what it does NOT mean, since a single ratio invites over-reading. */
function paceHelp(line: AllocatorLine): string {
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
      {/* ── Collapsed header: name, spent, current daily, pace ── */}
      <div className="flex w-full items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {expanded ? (
            <ChevronDownIcon className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />
          ) : (
            <ChevronRightIcon className="h-4 w-4 flex-shrink-0 text-[var(--muted-foreground)]" />
          )}
          <span
            className="h-2.5 w-2.5 flex-shrink-0 rounded-sm"
            style={{ background: color }}
          />
          <span className="min-w-0 truncate text-sm font-semibold text-[var(--foreground)]">
            {line.name}
          </span>
          {!line.flight.fullMonth && (
            <span className="hidden flex-shrink-0 text-[10px] tabular-nums text-[var(--muted-foreground)] sm:inline">
              day {line.flight.startDay}–{line.flight.endDay}
            </span>
          )}
        </button>

        <div className="hidden flex-shrink-0 items-center gap-6 sm:flex">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              Spent MTD
            </div>
            <div className="text-sm font-bold tabular-nums" style={{ color: COLORS.daily }}>
              {fmt(line.spentMTD)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              Current Daily
            </div>
            <div className="text-sm font-bold tabular-nums text-[var(--foreground)]">
              {line.currentDaily > 0 ? fmt(line.currentDaily) : '—'}
            </div>
          </div>
        </div>

        <Tooltip label={paceHelp(line)} placement="bottom">
          <button
            type="button"
            onClick={onOpenHealth}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-opacity hover:opacity-80"
            style={{ background: `${paceColor}1f`, color: paceColor }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: paceColor }} />
            {PACE_LABELS[line.paceStatus]}
          </button>
        </Tooltip>
      </div>

      {/* ── Expanded body ── */}
      {expanded && (
        <div className="border-t border-[var(--border)] px-4 py-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
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
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    line.locked
                      ? 'border-[var(--foreground)]/30 bg-[var(--foreground)]/10 text-[var(--foreground)]'
                      : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  {line.locked ? (
                    <LockClosedIcon className="h-3 w-3" />
                  ) : (
                    <LockOpenIcon className="h-3 w-3" />
                  )}
                </button>
              </Tooltip>
              <LabelChips
                tags={ad?.pacerTags}
                allLabels={allLabels}
                readOnly={readOnly}
                onChange={onTagsChange}
              />
            </div>

            {/* Flight window, top right and editable — the funding window is a
                per-campaign fact and this is the card that owns the campaign. */}
            <FlightInline
              line={line}
              daysInMonth={daysInMonth}
              readOnly={readOnly}
              onChange={onFlightChange}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <div className="metric-box w-full rounded-lg bg-[var(--muted)]/40 px-3 py-2.5">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Allocation
              </div>
              <InlineMoneyCell
                value={mode === 'pct' ? String(Number(line.input.toFixed(2))) : line.input.toFixed(2)}
                ariaLabel={`${mode === 'pct' ? 'Percent' : 'Dollar'} allocation for ${line.name}`}
                disabled={readOnly}
                display={
                  <span className="block text-lg font-bold leading-tight text-[var(--foreground)]">
                    {mode === 'pct'
                      ? `${Number(line.input.toFixed(2))}%`
                      : fmt(line.input)}
                  </span>
                }
                onCommit={(next) => {
                  const parsed = Number(next);
                  if (next == null || !Number.isFinite(parsed) || parsed < 0) return;
                  if (Math.abs(parsed - line.input) > 0.0001) onInput(parsed);
                }}
              />
              <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                {payable > 0 ? `${line.percentOfPayable.toFixed(1)}% of actual spend` : '—'}
              </div>
            </div>

            <MetricBox
              label="Target Spend"
              value={fmt(line.target)}
              sub={`over ${line.flight.total} flight day${line.flight.total === 1 ? '' : 's'}`}
            />
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
              tooltip={paceHelp(line)}
            />
            <MetricBox
              label="Rec. Daily Budget"
              value={line.dailyControllable ? fmt(line.recommendedDaily) : '—'}
              sub={
                line.dailyControllable
                  ? `${fmt(Math.max(0, line.target - line.spentMTD))} left ÷ ${line.flight.remaining}d`
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

          {/* The verdict in words, with the health detail on hover. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Tooltip label={paceHelp(line)}>
              <span
                className="cursor-help text-[11px] font-semibold"
                style={{ color: paceColor }}
              >
                {PACE_LABELS[line.paceStatus]}
                {line.paceRatio != null && ` · ${Math.round(line.paceRatio * 100)}% of pace`}
              </span>
            </Tooltip>
            <button
              type="button"
              onClick={onOpenHealth}
              className="text-[11px] font-medium text-[var(--primary)] transition-opacity hover:opacity-80"
            >
              Delivery health →
            </button>
            {line.shared && (
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: COLORS.daily }}>
                Shared budget — push skips it
              </span>
            )}
            {line.disapproved && (
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: COLORS.error }}>
                Ads disapproved — budget is not the problem
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Day-of-month flight bounds, inline. Writes an override; the auto-derived
 *  window comes from the campaign's own Google dates. */
function FlightInline({
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
  const [start, setStart] = useState(String(line.flight.startDay));
  const [end, setEnd] = useState(String(line.flight.endDay));

  useEffect(() => {
    setStart(String(line.flight.startDay));
    setEnd(String(line.flight.endDay));
  }, [line.flight.startDay, line.flight.endDay]);

  const commit = () => {
    const s = Math.min(Math.max(Number(start) || 1, 1), daysInMonth);
    const e = Math.min(Math.max(Number(end) || daysInMonth, s), daysInMonth);
    setStart(String(s));
    setEnd(String(e));
    if (s !== line.flight.startDay || e !== line.flight.endDay) onChange(s, e);
  };

  const inputClass =
    'w-10 rounded border border-[var(--border)] bg-[var(--input)] px-1 py-0.5 text-center text-xs font-semibold tabular-nums text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none disabled:opacity-60';

  return (
    <div className="text-right">
      <Tooltip label="The days this campaign is funded for THIS month. Auto-derived from its Google dates — override it when the funding window differs.">
        <span className="cursor-help text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Flight this month
        </span>
      </Tooltip>
      <div className="mt-1 flex items-center justify-end gap-1.5 text-xs text-[var(--muted-foreground)]">
        <span>day</span>
        <input
          value={start}
          onChange={(e) => setStart(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          disabled={readOnly}
          inputMode="numeric"
          aria-label={`Flight start day for ${line.name}`}
          className={inputClass}
        />
        <span>–</span>
        <input
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          disabled={readOnly}
          inputMode="numeric"
          aria-label={`Flight end day for ${line.name}`}
          className={inputClass}
        />
      </div>
      <div className="mt-0.5 text-[10px] tabular-nums text-[var(--muted-foreground)]">
        {line.flight.remaining} day{line.flight.remaining === 1 ? '' : 's'} left
      </div>
    </div>
  );
}
