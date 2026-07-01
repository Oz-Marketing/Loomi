'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  MinusCircleIcon,
  ExclamationTriangleIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import { BellIcon, BellOffIcon } from '@/components/icons/bell';
import type { PacerAd } from '@/lib/ad-pacer/types';
import { COLORS, AD_COLORS, AD_STATUS_COLORS } from '@/lib/ad-pacer/constants';
import {
  fmt,
  fmtDate,
  num,
  calcDays,
  budgetTypeColor,
  budgetTypeTint,
  sourceColor,
  sourceTint,
  sourceLabel,
  classifyPacerHealth,
  fmtSyncedAgo,
  fmtDaysNum,
  fmtDaysLeft,
  fmtDaysBasisPhrase,
} from '@/lib/ad-pacer/helpers';
import { fmtPeriodLong } from '@/lib/ad-pacer/period';
import { buildPacerCalc } from '@/lib/ad-pacer/pacer-calc';
import { buildGooglePacingCard } from '@/lib/ad-pacer/google-pacer-calc';
import {
  GooglePacingBadges,
  GoogleDailyMetricBoxes,
  GooglePacingInsight,
} from './google-pacer-card';
import { AdStatusBadge } from './AdStatusBadge';
import { SearchableSelect } from '@/components/flows/builder/SearchableSelect';
import { usePacerReadOnly } from './pacer-read-only';
import { Tooltip } from './Tooltip';
import { DollarInput, Field, readonlyClass, labelClass } from './inputs';
import { MetricBox } from './metrics';

// ─── PacerRow + PacerCompletedSummary (appended below) ─────────────────────
export function PacerRow({
  ad,
  index,
  timeZone,
  onActualChange,
  onDailyBudgetChange,
  expanded,
  onToggleExpanded,
  onMuteToggle,
  onPushDailyBudget,
  onResolveCrossMonth,
  prevMonthAds,
  siblings,
  synced,
  linkPicker,
  syncInfo,
  linkError,
  pushLabel = 'Push',
  pushIcon,
  statusMismatch,
}: {
  ad: PacerAd;
  index: number;
  timeZone: string;
  onActualChange: (v: string | null) => void;
  onDailyBudgetChange: (v: string | null) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  onMuteToggle: () => void;
  /** Push the row's current daily budget to its linked platform object. */
  onPushDailyBudget: (value: string) => Promise<{ ok: boolean; text: string }>;
  /** §2: resolve a cross-month straddler — count its full run in its own month
   *  (apply_full_run), set a lifetime planned split, link to a prior-month run
   *  (link), or clear. Persists server-side. */
  onResolveCrossMonth: (
    action: 'apply_full_run' | 'split' | 'clear' | 'link',
    splitMap?: Record<string, number>,
    linkedPrevAdId?: string,
  ) => void;
  /** Prior-period ads for the manual "continues a prior-month run" picker, each
   *  { id, name, period }. Shown only for an unsynced split run (synced runs
   *  auto-chain by ad-set id). Empty/undefined hides the picker. */
  prevMonthAds?: { id: string; name: string; period: string }[];
  /** #58: this ad's same-title sibling rows across months (period →
   *  {allocation, actual}), so the split reference shows each month's real plan
   *  + spend. null when the ad has no same-name rows in other periods. */
  siblings: Record<string, { allocation: number; actual: number }> | null;
  // ── Platform-integration slots ──────────────────────────────────────────
  // Meta passes its ad-set linking; Google passes its campaign linking. The row
  // stays platform-agnostic — it only knows "synced or not" + renders the slots.
  /** True once the row is linked + synced to its platform (platform owns spend). */
  synced: boolean;
  /** The platform link control (Meta: AdSetLinkPicker; Google: campaign picker). */
  linkPicker: ReactNode;
  /** Optional sync-window info tooltip rendered beside the link control. */
  syncInfo?: ReactNode;
  /** Optional link-load error shown below the connection card. */
  linkError?: string | null;
  /** Label for the "push daily budget" action (e.g. "Push to Meta"). */
  pushLabel?: string;
  /** Leading icon for the push action (platform brand mark). */
  pushIcon?: ReactNode;
  /** Optional platform status-mismatch warning rendered below the inputs. */
  statusMismatch?: ReactNode;
}) {
  const isLifetime = ad.budgetType === 'Lifetime';
  const typeColor = budgetTypeColor(ad.budgetType);
  // Once a row is linked + synced, the platform owns its actual spend
  // (read-only here) and its daily budget is edited-then-pushed, not free-typed.
  const syncedFromMeta = synced;
  // Daily-budget editor state: collapsed (read-only + pencil) until the user
  // opts in; once they change the value a "Push" action appears.
  const [dailyEditing, setDailyEditing] = useState(false);
  const [dailyStart, setDailyStart] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  // Full-run spend is opt-in per ad: a multi-month lifetime ad often only
  // needs its current-month figure, so we hide the full run behind a toggle and
  // show it only when the user asks for that ad.
  const dailyChanged =
    dailyEditing && (ad.pacerDailyBudget ?? '') !== (dailyStart ?? '');
  const beginDailyEdit = () => {
    setDailyStart(ad.pacerDailyBudget ?? '');
    setPushMsg(null);
    setDailyEditing(true);
  };
  const pushDaily = async () => {
    setPushing(true);
    setPushMsg(null);
    const res = await onPushDailyBudget(ad.pacerDailyBudget ?? '');
    setPushMsg(res);
    setPushing(false);
    if (res.ok) setDailyStart(ad.pacerDailyBudget ?? '');
  };
  // Discard edits — restore the value captured when editing began so a changed
  // mind (or an accidental clear) can't wipe the budget.
  const cancelDailyEdit = () => {
    onDailyBudgetChange(dailyStart);
    setPushMsg(null);
    setDailyEditing(false);
  };

  // "Now" = the current instant; the day boundary that bounds the recommended
  // daily is resolved in the account's timezone inside buildPacerCalc. Captured
  // per ad/timezone change so the row's numbers stay stable between renders.
  const calc = useMemo(
    () => buildPacerCalc(ad, Date.now(), timeZone),
    [ad, timeZone],
  );
  // §5 Google branch — the per-campaign ceiling card (monthly ceiling, rec daily
  // RATE, budget-limited vs disapproved). Only built for Google lines; Meta lines
  // render the existing remaining-budget framing untouched.
  const isGoogle = ad.platform === 'google';
  const gCard = useMemo(
    () => (isGoogle ? buildGooglePacingCard(ad, Date.now(), timeZone) : null),
    [isGoogle, ad, timeZone],
  );
  // The date being paced TO — the Meta/planned end clamped to the pacing
  // month (Change 4). Drives the "until …" labels and the completed banner.
  const effectiveEnd = calc.effectiveEnd;
  const readOnly = usePacerReadOnly();

  const isPastRun = calc.endsBeforeToday;
  const isMarkedCompleted = ad.adStatus === 'Completed Run';
  const isMarkedOff = ad.adStatus === 'Off';
  // Off / Completed Run freeze pacing math: spend is final, no further
  // projection or daily-adjustment makes sense. Past-flight ads without an
  // explicit status fall through to the "Mark as completed" prompt.
  const showCompletedSummary = isMarkedCompleted || isMarkedOff;
  // Live-pacing case = the projection grid + pacing insight + mute control show.
  // When the run is completed/past, those are hidden, but the cross-month toggle
  // stays available (the classification is still editable).
  const showsProjection = !showCompletedSummary && !isPastRun;

  // Color the recommended-vs-current daily comparison
  const dailyDelta = calc.recDaily - calc.dailyBudget;
  const isOnTrack = calc.budget > 0 && Math.abs(dailyDelta) < 0.5;
  const recColor = isOnTrack
    ? COLORS.success
    : calc.recDaily > calc.dailyBudget
      ? COLORS.warn
      : COLORS.lifetime;

  // Health-based accent colors the left stripe AND the compact pacing
  // badge in the summary row, so both UI elements agree on the bucket.
  const health = useMemo(() => classifyPacerHealth(ad, calc), [ad, calc]);

  // Resolved = the user billed the ad's full run in its own month
  // (fullRunAppliedToMonth). Cross-month accounting is a MANUAL choice via the
  // dropdown on the input row — nothing is auto-detected.
  const resolvedFullRun = ad.fullRunAppliedToMonth != null;

  // ── Cross-month accounting (derived once) — the selector lives on the input
  //    row; its Bill/Split detail renders just below the row. ──
  const cmMonths: string[] = (() => {
    const out: string[] = [];
    const rawStart = ad.flightStart ?? ad.metaStartDate ?? ad.liveDate;
    const rawEnd = ad.flightEnd ?? ad.metaEndDate;
    if (rawStart && rawEnd) {
      let y = Number(rawStart.slice(0, 4));
      let mo = Number(rawStart.slice(5, 7));
      const ey = Number(rawEnd.slice(0, 4));
      const em = Number(rawEnd.slice(5, 7));
      while ((y < ey || (y === ey && mo <= em)) && out.length < 25) {
        out.push(`${y}-${String(mo).padStart(2, '0')}`);
        mo += 1;
        if (mo > 12) {
          mo = 1;
          y += 1;
        }
      }
    }
    return out;
  })();
  let cmSplit: Record<string, number> | null = null;
  try {
    cmSplit = ad.lifetimeMonthSplit
      ? (JSON.parse(ad.lifetimeMonthSplit) as Record<string, number>)
      : null;
  } catch {
    cmSplit = null;
  }
  // Full run can't be below the in-month slice; fall back to the entered actual
  // when Meta run-spend isn't synced so the verdict isn't $0.
  const cmRun = Math.max(num(ad.pacerRunSpend) ?? 0, num(ad.pacerActual) ?? 0);
  const cmTarget = num(ad.allocation) ?? 0;
  const cmSiblingPeriods = siblings ? Object.keys(siblings).sort() : [];
  // #58: same-title rows in 2+ months drive the real per-month split reference.
  const cmHasSiblings = isLifetime && cmSiblingPeriods.length > 1;
  // 3-state classifier: '' (no choice) · 'split' · 'bill'. Selecting a value
  // persists it; the detail surfaces only once a real option is chosen.
  const cmSelValue: '' | 'split' | 'bill' = resolvedFullRun
    ? 'bill'
    : ad.lifetimeMonthSplit != null
      ? 'split'
      : '';
  // Cross-month accounting is opt-in per ad via a footer toggle — the dropdown
  // (and its detail) only appear when on. Defaults on for ads already
  // classified so an existing Bill/Split stays visible.
  const [showCrossMonth, setShowCrossMonth] = useState(cmSelValue !== '');

  // `linkPicker` + `syncInfo` arrive as props (built by the platform parent).

  // Status indicator color — pulled from the same map AdStatusPill uses
  // so the dot matches the status the user sees on the planner page.
  const statusColor = AD_STATUS_COLORS[ad.adStatus]?.[0] ?? 'var(--muted-foreground)';
  // Health icon picks the right semantic affordance per bucket — keeps
  // the loudest verdict (health pill) visually distinct from the
  // quieter status dot + budget-type suffix.
  const HealthIcon =
    health.state === 'on-track'
      ? CheckCircleIcon
      : health.state === 'stopped' || health.state === 'no-data'
        ? MinusCircleIcon
        : ExclamationTriangleIcon;
  const healthMuted = health.state === 'stopped' || health.state === 'no-data';

  // Compact one-line summary row. Four visual languages, one per signal:
  //   - identity:   colored ad-dot + name
  //   - status:     colored dot + plain text (workflow lifecycle)
  //   - values:     budget number + /day or total suffix (carries type)
  //   - verdict:    loud health pill with leading icon (the answer)
  const summaryRow = (
    // A div (not a button) so the inline Mute toggle can be a real nested
    // button. Row still expands on click / Enter / Space.
    <div
      role="button"
      tabIndex={0}
      onClick={onToggleExpanded}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggleExpanded();
        }
      }}
      aria-expanded={expanded}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--muted)]/30 transition-colors cursor-pointer"
    >
      {expanded ? (
        <ChevronDownIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] flex-shrink-0" />
      ) : (
        <ChevronRightIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)] flex-shrink-0" />
      )}
      {/* Identity zone — ad-dot + name + status all grouped on the left
          so the status reads as adjacent context to the ad, not as a
          separate column out near the metrics. */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div
          className="w-2 h-2 rounded-sm flex-shrink-0"
          style={{ background: AD_COLORS[index % AD_COLORS.length] }}
        />
        <span className="text-sm font-semibold text-[var(--foreground)] truncate min-w-0">
          {ad.name || 'Untitled Ad'}
        </span>
        {/* Status: dot + plain text, no pill chrome (workflow state, not
            a verdict — quieter than the health pill on the right). */}
        <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)] whitespace-nowrap flex-shrink-0">
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: statusColor }}
          />
          {ad.adStatus || 'No status'}
        </span>
        {/* Google channel-type (Search/Display/…) — the Meta equivalent has no
            channel, so this only shows for Google lines that carry one. */}
        {isGoogle && ad.googleChannelType && (
          <span className="hidden md:inline-flex items-center text-[11px] text-[var(--muted-foreground)] whitespace-nowrap flex-shrink-0 before:content-['·'] before:mr-1.5">
            {ad.googleChannelType}
          </span>
        )}
        {/* Cross-month treatment is indicated by a single pill inside the
            expanded card's pill row (next to Daily/Lifetime + Base/Added),
            not here in the collapsed header — keeps the row clean. */}
      </div>
      {/* Actual spend — labelled so the bare number isn't ambiguous. Fixed
          width + right-aligned so it forms a consistent column down the list. */}
      <span className="hidden sm:inline-flex items-baseline justify-end gap-1 text-[11px] tabular-nums whitespace-nowrap flex-shrink-0 w-[132px]">
        <span className="text-[var(--muted-foreground)]">Actual</span>
        <span className="text-[var(--foreground)] font-semibold">
          {calc.spent > 0 ? fmt(calc.spent) : '—'}
        </span>
      </span>
      {/* Budget — suffix `/day` or ` total` carries the lifetime/daily
          mode so the LIFETIME / DAILY pill is no longer needed. Fixed width +
          right-aligned to line up with the column above. */}
      <span
        className="hidden md:inline-flex items-baseline justify-end gap-1 text-[11px] tabular-nums whitespace-nowrap flex-shrink-0 font-semibold w-[108px]"
        style={{ color: typeColor }}
      >
        {isLifetime ? (
          calc.budget > 0 ? (
            <>
              {fmt(calc.budget)}
              <span className="text-[10px] font-normal text-[var(--muted-foreground)]">
                total
              </span>
            </>
          ) : (
            '—'
          )
        ) : calc.dailyBudget > 0 ? (
          <>
            {fmt(calc.dailyBudget)}
            <span className="text-[10px] font-normal text-[var(--muted-foreground)]">
              /day
            </span>
          </>
        ) : (
          '—'
        )}
      </span>
      {/* Verdict pill — the loudest signal in the row. Solid colored
          background + leading icon so the eye lands here first. */}
      <span
        className="inline-flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md flex-shrink-0 min-w-[92px]"
        style={{
          background: healthMuted ? 'rgba(255,255,255,0.06)' : `${health.color}26`,
          color: healthMuted ? 'var(--muted-foreground)' : health.color,
          border: `1px solid ${healthMuted ? 'transparent' : `${health.color}55`}`,
        }}
      >
        <HealthIcon className="w-3 h-3 flex-shrink-0" />
        {health.short}
      </span>
    </div>
  );

  return (
    <div className="glass-section-card pacer-ad-card relative rounded-xl mb-2.5 overflow-hidden">
      {/* Left-edge accent stripe colored by pacing health — visible on
          both summary and expanded states. */}
      <div
        className="absolute top-0 bottom-0 left-0 w-1"
        style={{ background: health.color }}
      />
      {summaryRow}
      {!expanded ? null : (
        <div className="border-t border-[var(--border)] px-5 py-4 pl-6">

      {/* Header row inside the expanded view — Target Spend (value +
          type + source/split breakdown) on the left, Flight window on
          the right. Replaces the old 5-column inputs grid Target Spend
          field so all of the read-only context lives together up top,
          and the inputs row below can focus on the two values reps
          actually edit. */}
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div className="flex-shrink-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Target Spend
          </div>
          {/* Value + source tag on one line — the source sits to the RIGHT of
              the target spend. Split ads also surface the Base / Added
              breakdown so the bucket allocation is visible right where the
              budget lives. */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-base font-bold tabular-nums"
                style={{ color: typeColor }}
              >
                {calc.budget > 0 ? fmt(calc.budget) : '—'}
              </span>
              <span className="text-[11px] text-[var(--muted-foreground)]">
                {isLifetime ? 'total' : '/day target'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              {/* Budget type — Daily (blue) vs Lifetime (purple), matching the
                  table-view tag — so the daily-rate vs fixed-total distinction
                  is explicit, not just implied by the "/day" vs "total" suffix.
                  Google lines show Daily/Total + the shared/delivery badges. */}
              {isGoogle && gCard ? (
                <GooglePacingBadges card={gCard} />
              ) : (
                <span
                  className="font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                  style={{
                    background: budgetTypeTint(ad.budgetType),
                    color: typeColor,
                  }}
                >
                  {ad.budgetType}
                </span>
              )}
              <span
                className="font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                style={{
                  background: sourceTint(ad.budgetSource),
                  color: sourceColor(ad.budgetSource),
                }}
              >
                {sourceLabel(ad.budgetSource)}
              </span>
              {(resolvedFullRun || ad.lifetimeMonthSplit != null) && (
                <Tooltip
                  label={
                    resolvedFullRun
                      ? "Cross-month: the full run is billed in this ad's month — the over/under compares the full run to the full target."
                      : 'Cross-month: lifetime ad with a planned per-month split (reference only — the variance books once on completion).'
                  }
                >
                <span
                  className="font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                  style={{ background: 'rgba(249,115,22,0.18)', color: '#f97316' }}
                >
                  Cross-month
                </span>
                </Tooltip>
              )}
              {ad.budgetSource === 'split' && (() => {
                const baseAmt = num(ad.splitBaseAmount) ?? 0;
                const addedAmt = Math.max(0, calc.budget - baseAmt);
                return (
                  <span className="text-[var(--muted-foreground)]">
                    Base {fmt(baseAmt)} / Added {fmt(addedAmt)}
                  </span>
                );
              })()}
            </div>
          </div>
        </div>
        {/* Right cluster: the read-only platform Ad Status (always shown so the
            real delivery state is visible at a glance) above the Flight window.
            Mute alerts lives in the expanded-card footer (bottom-right). */}
        <div className="flex flex-shrink-0 flex-col items-end gap-2 text-right">
          <AdStatusBadge ad={ad} label />
          {ad.flightStart && ad.flightEnd && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Flight
              </div>
              <div className="text-base font-bold text-[var(--foreground)] whitespace-nowrap">
                {fmtDate(ad.flightStart)} – {fmtDate(ad.flightEnd)}
              </div>
              <div className="text-[10px] text-[var(--muted-foreground)]">
                {calcDays(ad.flightStart, ad.flightEnd)} days
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Editable inputs row — just the two values reps actually edit.
          Today's date always uses the current date and end date uses
          the immutable flight end, so neither needs an input. */}
      <div className="mb-3.5 flex items-start justify-between gap-4 flex-wrap">
        {/* Actual + Daily + Link. When the ad is connected to a Meta ad set,
            these are contained in a card with a "from Meta" badge (Meta owns the
            spend); otherwise they sit plainly. */}
        <div
          className={`${
            syncedFromMeta
              ? 'w-full md:w-[calc(50%_-_4px)] rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 py-3'
              : 'w-fit'
          }`}
        >
          <div
            className={
              syncedFromMeta
                ? 'grid grid-cols-2 gap-2 [&>*]:px-3 [&_label]:mb-1'
                : 'grid grid-cols-1 md:grid-cols-[minmax(0,150px)_minmax(0,150px)_minmax(0,max-content)] gap-4'
            }
          >
        <Field
          label={
            // Prompt 3: when the full run is billed in one month, this input is
            // just THIS month's delivery slice (the full run shows in the
            // cross-month banner + the over/under). Relabel so it's never
            // mistaken for the figure variance is computed against.
            ad.fullRunAppliedToMonth
              ? `${fmtPeriodLong(ad.period).split(' ')[0]} delivery`
              : 'Actual Spend'
          }
        >
          {syncedFromMeta ? (
            // Meta owns the spend once synced — plain read-only value. The card's
            // "from Meta" badge labels the source, so no per-field tag here.
            <div className="flex items-center">
              <span className="text-xl font-bold tabular-nums text-[var(--foreground)]">
                {fmt(num(ad.pacerActual) ?? 0)}
              </span>
            </div>
          ) : (
            <DollarInput
              value={ad.pacerActual}
              onChange={onActualChange}
              placeholder="0.00"
            />
          )}
        </Field>
        <Field label="Daily Budget">
          {isLifetime ? (
            <Tooltip
              label="Lifetime ads use a fixed total budget, not a daily rate"
              className="w-full"
            >
            <div
              className={`${readonlyClass} italic`}
            >
              N/A — lifetime
            </div>
            </Tooltip>
          ) : !syncedFromMeta ? (
            // Manual / unlinked — free-typed as before.
            <DollarInput
              value={ad.pacerDailyBudget}
              onChange={onDailyBudgetChange}
              placeholder="0.00"
            />
          ) : !dailyEditing ? (
            // Synced — plain read-only value with a pencil to reveal the input.
            // Not a box that looks editable until you click the pencil.
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tabular-nums text-[var(--foreground)]">
                {ad.pacerDailyBudget != null && ad.pacerDailyBudget !== ''
                  ? fmt(num(ad.pacerDailyBudget) ?? 0)
                  : '—'}
              </span>
              <Tooltip label="Edit daily budget">
              <button
                type="button"
                onClick={beginDailyEdit}
                disabled={readOnly}
                aria-label="Edit daily budget"
                className="inline-flex items-center justify-center rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <PencilSquareIcon className="w-3.5 h-3.5" />
              </button>
              </Tooltip>
            </div>
          ) : (
            // Editing — the input, a full-width Push action shown only once the
            // value changes, and a tidy right-aligned Cancel / Done row.
            <div className="space-y-2">
              <DollarInput
                value={ad.pacerDailyBudget}
                onChange={onDailyBudgetChange}
                placeholder="0.00"
              />
              {dailyChanged && (
                <button
                  type="button"
                  onClick={pushDaily}
                  disabled={pushing || readOnly}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[var(--primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pushIcon}
                  {pushing ? 'Pushing…' : pushLabel}
                </button>
              )}
              <div className="flex items-center justify-end gap-4 text-[11px]">
                {/* Cancel restores the original value; Done keeps the edit. */}
                <button
                  type="button"
                  onClick={cancelDailyEdit}
                  disabled={pushing}
                  className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDailyEditing(false);
                    setPushMsg(null);
                  }}
                  disabled={pushing}
                  className="font-semibold text-[var(--primary)] hover:opacity-80 disabled:opacity-50"
                >
                  Done
                </button>
              </div>
              {pushMsg && (
                <div
                  className={`text-[10px] ${pushMsg.ok ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}
                >
                  {pushMsg.text}
                </div>
              )}
            </div>
          )}
        </Field>
        {!syncedFromMeta && (
          // Unsynced/manual: the link control is the third field. Once linked +
          // synced, the connection header above replaces this.
          <div>
            <span className={labelClass} aria-hidden="true">&nbsp;</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {linkPicker}
              {syncInfo}
            </div>
          </div>
        )}
          </div>
          {syncedFromMeta && (
            // Connection footer — ad-set link + sync status below the spend
            // metrics, instead of crammed in as a third field.
            <div className="mt-3 flex items-center justify-between gap-4 border-t border-[var(--border)] px-3 pt-2.5">
              {linkPicker}
              <div className="flex flex-shrink-0 items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]">
                {ad.pacerSyncedAt && (
                  <span className="whitespace-nowrap">
                    Synced {fmtSyncedAgo(ad.pacerSyncedAt)}
                  </span>
                )}
                {syncInfo}
              </div>
            </div>
          )}
          {linkError && (
            <div className="mt-2 text-[10px] text-[#ef4444]">{linkError}</div>
          )}
        </div>
        {/* Cross-month accounting — dropdown + its detail banner stacked into one
            tidy column to the right of the spend fields, so the banner reads as
            part of the chosen option. Shown only when the footer toggle is on. */}
        {showCrossMonth && (
          <div className="flex w-full flex-col gap-2 sm:w-[260px] flex-shrink-0">
            <select
              id={`cm-${ad.id}`}
              value={cmSelValue}
              disabled={readOnly}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'bill') {
                  onResolveCrossMonth('apply_full_run');
                } else if (v === 'split') {
                  // Seed an even-split map so the single-row reference has values;
                  // sibling rows override it when the ad spans months (#58).
                  const per =
                    cmMonths.length > 0
                      ? Math.round((cmTarget / cmMonths.length) * 100) / 100
                      : 0;
                  const map: Record<string, number> = {};
                  cmMonths.forEach((mm) => {
                    map[mm] = per;
                  });
                  onResolveCrossMonth('split', map);
                }
              }}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--input)] focus:outline-none focus:border-[var(--primary)] text-[var(--foreground)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="" disabled>
                Cross-Month Accounting
              </option>
              <option value="split">Split across months</option>
              <option value="bill">Bill in one month</option>
            </select>
            {cmSelValue === 'bill' && (
              <div
                className="rounded-md border px-2.5 py-2 text-[11px] leading-relaxed text-[var(--foreground)]"
                style={{ borderColor: 'rgba(249,115,22,0.3)', background: 'rgba(249,115,22,0.08)' }}
              >
                Full run <span className="font-semibold">{fmt(cmRun)}</span> vs target{' '}
                <span className="font-semibold">{fmt(cmTarget)}</span>
                {cmTarget > 0 &&
                  (() => {
                    // The full-run pacing verdict — the whole run can pace
                    // correctly even though the month's actual is just the slice.
                    const d = cmRun / cmTarget - 1;
                    const verdict =
                      Math.abs(d) <= 0.1
                        ? { t: '✓ on target', c: COLORS.success }
                        : d > 0
                          ? { t: `+${(d * 100).toFixed(0)}% over`, c: COLORS.error }
                          : { t: `${(d * 100).toFixed(0)}% under`, c: COLORS.warn };
                    return (
                      <>
                        {' — '}
                        <span className="font-semibold" style={{ color: verdict.c }}>
                          {verdict.t}
                        </span>
                      </>
                    );
                  })()}
                {' · counts in '}
                <span className="font-semibold" style={{ color: '#f97316' }}>
                  {fmtPeriodLong(ad.fullRunAppliedToMonth ?? ad.period)}
                </span>
                .
              </div>
            )}
            {cmSelValue === 'split' && (
              <div className="rounded-md border border-[var(--border)] bg-[var(--muted)]/30 px-2.5 py-2 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
                {isLifetime
                  ? 'Each month keeps its own spend; the full variance settles when the run completes.'
                  : "Each month keeps its own spend (the over/under uses this month's slice)."}
                {cmHasSiblings && (
                  <div className="mt-2 space-y-1.5 border-t border-[var(--border)] pt-2">
                    <div className="font-semibold" style={{ color: COLORS.lifetime }}>
                      Planned split (per month)
                    </div>
                    {cmSiblingPeriods.map((mm) => {
                      const s = siblings![mm];
                      const here = mm === ad.period;
                      // The current month's line reads the live (possibly unsaved)
                      // row values; other months come from the sibling rows.
                      const planned = here ? (num(ad.allocation) ?? 0) : s.allocation;
                      const actual = here ? (num(ad.pacerActual) ?? 0) : s.actual;
                      return (
                        <div key={mm} className="flex flex-col leading-tight">
                          <span className="text-[var(--foreground)]">
                            {fmtPeriodLong(mm)}
                            {here && (
                              <span className="text-[var(--muted-foreground)]">
                                {' · this month'}
                              </span>
                            )}
                          </span>
                          <span className="text-[var(--muted-foreground)]">
                            planned {fmt(planned)} · actual {fmt(actual)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {!cmHasSiblings && isLifetime && cmMonths.length > 1 && cmSplit != null && (
                  <div className="mt-2 space-y-1.5 border-t border-[var(--border)] pt-2">
                    <div className="font-semibold" style={{ color: COLORS.lifetime }}>
                      Planned split (reference only)
                    </div>
                    {cmMonths.map((mm) => (
                      <div key={mm} className="flex flex-col leading-tight">
                        <span className="text-[var(--foreground)]">
                          {fmtPeriodLong(mm)}
                        </span>
                        <span className="text-[var(--muted-foreground)]">
                          {mm === ad.period
                            ? `actual ${fmt(num(ad.pacerActual) ?? 0)} · `
                            : ''}
                          planned {fmt(cmSplit?.[mm] ?? 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Manual run linkage — only when unsynced (synced ad sets
                    auto-chain across months by ad-set id). Picks the prior-month
                    ad this instance continues; the run then settles once at
                    flight end. */}
                {isLifetime && !synced && (prevMonthAds?.length ?? 0) > 0 && (
                  <div className="mt-2 border-t border-[var(--border)] pt-2">
                    <div
                      className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: COLORS.lifetime }}
                    >
                      Continues a prior-month run
                    </div>
                    <SearchableSelect
                      value={ad.linkedPrevAdId ?? ''}
                      onChange={(v) => v && onResolveCrossMonth('link', undefined, v)}
                      options={(prevMonthAds ?? []).map((p) => ({
                        value: p.id,
                        label: `${p.name || 'Untitled'} · ${fmtPeriodLong(p.period)}`,
                      }))}
                      placeholder="Link to last month's ad…"
                    />
                    {ad.linkedPrevAdId && (
                      <div className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                        Linked — this run settles once at flight end.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>


      {/* Platform status-mismatch warning (Change 11): full-width below the
          inputs. Built by the platform parent (it knows the platform's
          effective-status semantics + the "mark off" action) and injected here. */}
      {statusMismatch}



      {/* Stopped / past-due states replace the projection grid. Off or
          Completed Run freezes the math at the entered actuals; past-flight
          ads without an explicit status get a banner prompting the user to
          mark the status. */}
      {showCompletedSummary ? (
        <PacerCompletedSummary
          ad={ad}
          calc={calc}
          isLifetime={isLifetime}
          effectiveEnd={effectiveEnd}
          variant={isMarkedOff ? 'off' : 'completed'}
        />
      ) : isPastRun ? (
        <div
          className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-4 flex items-center justify-between gap-3 flex-wrap"
          style={{ borderColor: COLORS.success }}
        >
          <div>
            <div
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: COLORS.success }}
            >
              Completed run
            </div>
            <div className="text-base font-bold text-[var(--foreground)] mt-0.5">
              Spent {fmt(calc.spent)}
              {calc.budget > 0 && (
                <span className="text-xs text-[var(--muted-foreground)] font-normal ml-2">
                  of {fmt(calc.budget)} target
                </span>
              )}
            </div>
          </div>
          <div className="text-[10px] text-[var(--muted-foreground)] max-w-[260px] text-right">
            Mark this ad as <span className="font-semibold">Completed Run</span>{' '}
            in the planner to lock in a final summary.
          </div>
        </div>
      ) : (
        <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {isLifetime ? (
          // Lifetime ads: Meta distributes the budget across the flight however
          // it wants, so there's nothing to pace day-to-day. Two scopes, switched
          // by the Cross-month toggle so a multi-month run doesn't drown out the
          // month a rep is actually looking at:
          //   • OFF (default): THIS month only — spend vs the month's allocation,
          //     matching the card header. What's wanted the vast majority of the
          //     time.
          //   • ON: the all-time RUN vs Meta's lifetime cap (the settlement view).
          //     The cap is only meaningful when Meta actually reports a lifetime
          //     budget on the ad set — never fall back to the month allocation
          //     (that mixed scopes: full-run spend vs one month's target → a bogus
          //     "264% / over by $X").
          showCrossMonth ? (
            (() => {
              const lifetimeBudget = num(ad.metaLifetimeBudget);
              const spentToDate = num(ad.pacerRunSpend) ?? calc.spent;
              const ratio =
                lifetimeBudget != null && lifetimeBudget > 0
                  ? spentToDate / lifetimeBudget
                  : null;
              const over = ratio != null && ratio > 1;
              return (
                <>
                  <MetricBox
                    label="Spent to date"
                    value={fmt(spentToDate)}
                    sub={
                      ratio != null
                        ? `${(ratio * 100).toFixed(0)}% of lifetime budget`
                        : 'all-time, every month'
                    }
                  />
                  <MetricBox
                    label="Lifetime budget"
                    value={
                      lifetimeBudget != null && lifetimeBudget > 0
                        ? fmt(lifetimeBudget)
                        : '—'
                    }
                    sub={
                      lifetimeBudget != null && lifetimeBudget > 0
                        ? 'Meta spend cap'
                        : 'not synced from Meta'
                    }
                  />
                  <MetricBox
                    label="Status"
                    value={
                      ratio == null
                        ? '—'
                        : over
                          ? `Over by ${fmt(spentToDate - (lifetimeBudget ?? 0))}`
                          : `${fmt((lifetimeBudget ?? 0) - spentToDate)} left`
                    }
                    sub={ratio == null ? 'needs a synced lifetime cap' : 'Meta controls delivery'}
                    color={
                      ratio == null ? undefined : over ? COLORS.error : COLORS.success
                    }
                  />
                </>
              );
            })()
          ) : (
            (() => {
              // Current-month scope — same numbers the card header shows
              // (effectiveActual / effectiveTarget), so header and grid agree.
              const periodLabel = fmtPeriodLong(ad.period).split(' ')[0];
              const monthSpent = calc.spent;
              const monthBudget = calc.budget;
              const ratio = monthBudget > 0 ? monthSpent / monthBudget : null;
              const over = ratio != null && ratio > 1;
              return (
                <>
                  <MetricBox
                    label="Spent this month"
                    value={fmt(monthSpent)}
                    sub={
                      ratio != null
                        ? `${(ratio * 100).toFixed(0)}% of ${periodLabel} target`
                        : 'no target set'
                    }
                  />
                  <MetricBox
                    label={`${periodLabel} target`}
                    value={monthBudget > 0 ? fmt(monthBudget) : '—'}
                    sub="this month's allocation"
                  />
                  <MetricBox
                    label="Status"
                    value={
                      monthBudget <= 0
                        ? '—'
                        : over
                          ? `Over by ${fmt(monthSpent - monthBudget)}`
                          : `${fmt(monthBudget - monthSpent)} left`
                    }
                    sub={monthBudget <= 0 ? 'set a target' : `vs ${periodLabel} target`}
                    color={
                      monthBudget <= 0 ? undefined : over ? COLORS.error : COLORS.success
                    }
                  />
                </>
              );
            })()
          )
        ) : (
          <MetricBox
            label="Projected Spend"
            value={
              calc.hasDates && !calc.endsBeforeToday
                ? fmt(calc.projected)
                : '—'
            }
            sub={
              !calc.hasDates
                ? 'set today + end dates'
                : calc.endsBeforeToday
                  ? 'end is before today'
                  : `spend + ${fmt(calc.dailyBudget)}/d × ${fmtDaysNum(calc.daysLeft)}d`
            }
          />
        )}
        {!isLifetime && (isGoogle && gCard ? (
          <GoogleDailyMetricBoxes
            card={gCard}
            hasDates={calc.hasDates && !calc.endsBeforeToday}
            effectiveEnd={effectiveEnd}
          />
        ) : (
        <>
        <MetricBox
          label="Days Remaining"
          value={
            calc.hasDates && !calc.endsBeforeToday
              ? fmtDaysLeft(calc.daysLeft)
              : '—'
          }
          sub={
            calc.endsBeforeToday
              ? 'window already closed'
              : calc.hasDates
                ? `until ${fmtDate(effectiveEnd)}`
                : 'set today + end dates'
          }
        />
        <MetricBox
          label="Remaining Budget"
          value={calc.budget > 0 ? fmt(calc.remaining) : '—'}
          sub={
            calc.budget > 0
              ? calc.spent > calc.budget
                ? `over by ${fmt(calc.spent - calc.budget)}`
                : `${fmt(calc.spent)} of ${fmt(calc.budget)} spent`
              : 'set Target Spend'
          }
          color={
            calc.budget > 0
              ? calc.spent > calc.budget
                ? COLORS.error
                : COLORS.success
              : undefined
          }
        />
        <MetricBox
          label="Rec. Daily Adjustment"
          value={
            calc.budget > 0 && calc.daysLeft > 0
              ? fmt(calc.recDaily)
              : '—'
          }
          // First line: the formula — remaining budget ÷ remaining days — since
          // that's exactly what the recommendation is (recDaily = remaining /
          // max(daysLeft, 1)). The divisor floors at 1 on the final day so the
          // tail can't blow up, labeled so the "1 day" is understood.
          sub={
            calc.budget <= 0
              ? 'set Target Spend'
              : calc.daysLeft <= 0
                ? 'no days remaining'
                : calc.daysLeft >= 1
                  ? `${fmt(calc.remaining)} remaining ÷ ${fmtDaysBasisPhrase(calc.daysLeft)} left`
                  : `${fmt(calc.remaining)} remaining ÷ 1 day (final day)`
          }
          // Second line (below the formula): the plain-language action — how
          // much to add to / cut from the current daily budget to hit the rec.
          detail={
            calc.budget > 0 && calc.daysLeft > 0
              ? isOnTrack
                ? 'On track — no change needed'
                : dailyDelta > 0
                  ? `Add ${fmt(Math.abs(dailyDelta))} to current Daily Budget`
                  : `Reduce current Daily Budget by ${fmt(Math.abs(dailyDelta))}`
              : undefined
          }
          color={recColor}
        />
        </>
        ))}
      </div>
        </>
      )}

      {/* Footer — the cross-month toggle stays available even on completed /
          past runs (its classification is still editable); the pacing insight
          and mute control show only while the ad is actively pacing. */}
      <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          {showsProjection &&
            (() => {
        if (calc.budget <= 0) return null;
        if (!calc.hasDates) return null;
        // §5 Google insight owns all cases (budget-limited / disapproved / over
        // ceiling / short of target / on-track) — opposite remedies, wide band.
        if (isGoogle && gCard) {
          return <GooglePacingInsight card={gCard} effectiveEnd={effectiveEnd} />;
        }
        if (calc.spent >= calc.budget) {
          return (
            <p
              className="m-0 text-[11px] leading-relaxed"
              style={{ color: COLORS.error }}
            >
              Budget already fully spent
              {calc.spent > calc.budget
                ? ` (over by ${fmt(calc.spent - calc.budget)})`
                : ''}
              . Consider pausing the ad or increasing the target spend.
            </p>
          );
        }
        if (isLifetime) {
          return (
            <p className="m-0 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
              Meta controls how this lifetime budget is delivered across the
              flight — there&apos;s no daily rate to steer. The full variance
              settles when the run completes.
            </p>
          );
        }
        const overspendThreshold = calc.budget * 1.05;
        const underspendThreshold = calc.budget * 0.95;
        if (calc.projected > overspendThreshold) {
          return (
            <p
              className="m-0 text-[11px] leading-relaxed"
              style={{ color: COLORS.warn }}
            >
              At your current rate of {fmt(calc.dailyBudget)}/day you&apos;re
              projected to overspend by{' '}
              {fmt(calc.projected - calc.budget)} by{' '}
              {fmtDate(effectiveEnd)}. Lower the daily budget to{' '}
              {fmt(calc.recDaily)} to stay on target.
            </p>
          );
        }
        if (calc.projected < underspendThreshold) {
          return (
            <p
              className="m-0 text-[11px] leading-relaxed"
              style={{ color: COLORS.lifetime }}
            >
              At your current rate you&apos;ll underspend by{' '}
              {fmt(calc.budget - calc.projected)} — bumping the daily budget
              to {fmt(calc.recDaily)} will use the full target by{' '}
              {fmtDate(effectiveEnd)}.
            </p>
          );
        }
        return (
          <p
            className="m-0 text-[11px] leading-relaxed"
            style={{ color: COLORS.success }}
          >
            Pacing well — a small adjustment keeps you on track for{' '}
            {fmtDate(effectiveEnd)}.
          </p>
        );
      })()}
        </div>
        {/* Footer controls — cross-month toggle + icon-only mute. */}
        <div className="flex flex-shrink-0 items-center gap-3">
          {/* Cross-month accounting toggle — reveals the dropdown on the input
              row; turning it off clears any Bill/Split classification. Orange =
              on (matches the cross-month theme). */}
          <Tooltip label="Cross-month accounting for this ad">
          <button
            type="button"
            role="switch"
            aria-checked={showCrossMonth}
            onClick={() => {
              if (showCrossMonth) {
                setShowCrossMonth(false);
                if (cmSelValue !== '') onResolveCrossMonth('clear');
              } else {
                setShowCrossMonth(true);
              }
            }}
            disabled={readOnly}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span
              className="relative inline-flex h-4 w-7 items-center rounded-full transition-colors"
              style={{ background: showCrossMonth ? '#f97316' : 'var(--border)' }}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                  showCrossMonth ? 'translate-x-3.5' : 'translate-x-0.5'
                }`}
              />
            </span>
            Cross-month
          </button>
          </Tooltip>
          {/* Mute alerts — icon only; hidden on completed / past runs (pacing
              alerts no longer apply there). */}
          {showsProjection && (
            <Tooltip
              label={
                ad.alertsMuted
                  ? 'Alerts muted for this ad — click to unmute'
                  : 'Mute pacing / dark / flight alerts for this ad'
              }
              className="flex-shrink-0"
            >
            <button
              type="button"
              onClick={onMuteToggle}
              disabled={readOnly}
              aria-label={
                ad.alertsMuted
                  ? 'Alerts muted for this ad — click to unmute'
                  : 'Mute pacing / dark / flight alerts for this ad'
              }
              className={`inline-flex items-center justify-center rounded-md border p-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                ad.alertsMuted
                  ? 'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.12)] text-[#f59e0b]'
                  : 'border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              {ad.alertsMuted ? (
                <BellOffIcon className="w-3.5 h-3.5" />
              ) : (
                <BellIcon className="w-3.5 h-3.5" />
              )}
            </button>
            </Tooltip>
          )}
        </div>
      </div>
        </div>
      )}
    </div>
  );
}

/**
 * Read-only completion summary for ads marked `Completed Run` whose end date
 * is behind the effective today cursor. Mirrors the live pacer metric grid
 * but locks the values to what was spent vs. what was targeted.
 */
export function PacerCompletedSummary({
  ad,
  calc,
  isLifetime,
  effectiveEnd,
  variant = 'completed',
}: {
  ad: PacerAd;
  calc: ReturnType<typeof buildPacerCalc>;
  isLifetime: boolean;
  effectiveEnd: string | null;
  variant?: 'completed' | 'off';
}) {
  const variance = calc.budget > 0 ? calc.spent - calc.budget : null;
  const variancePct =
    calc.budget > 0 ? ((calc.spent - calc.budget) / calc.budget) * 100 : null;
  const start = ad.liveDate || ad.flightStart;
  const daysRun = start && effectiveEnd ? calcDays(start, effectiveEnd) : 0;
  const varianceColor =
    variance == null
      ? undefined
      : Math.abs(variance) < 0.005
        ? COLORS.success
        : variance > 0
          ? COLORS.error
          : COLORS.warn;
  const isOff = variant === 'off';
  const headerColor = isOff ? COLORS.warn : COLORS.success;
  const headerBg = isOff ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.08)';
  const headerLabel = isOff ? 'Ad turned off' : 'Run complete';
  const dateLabel = isOff
    ? effectiveEnd
      ? `Was scheduled through ${fmtDate(effectiveEnd)}`
      : null
    : effectiveEnd
      ? `Ran through ${fmtDate(effectiveEnd)}`
      : null;
  return (
    <div>
      <div
        className="rounded-lg border px-4 py-3 mb-3 flex items-center justify-between gap-3 flex-wrap"
        style={{ borderColor: headerColor, background: headerBg }}
      >
        <div>
          <div
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: headerColor }}
          >
            {headerLabel}
          </div>
          <div className="text-base font-bold text-[var(--foreground)] mt-0.5">
            Final spend {fmt(calc.spent)}
          </div>
        </div>
        {dateLabel && (
          <div className="text-[10px] text-[var(--muted-foreground)] text-right">
            {dateLabel}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MetricBox
          label="Actual Spend"
          value={fmt(calc.spent)}
          sub="entered in pacer"
        />
        <MetricBox
          label="Target Spend"
          value={calc.budget > 0 ? fmt(calc.budget) : '—'}
          sub={calc.budget > 0 ? 'allocation' : 'no allocation set'}
        />
        <MetricBox
          label={isLifetime ? 'Implied Daily' : 'Daily Budget'}
          value={
            isLifetime
              ? daysRun > 0
                ? fmt(calc.spent / daysRun)
                : '—'
              : calc.dailyBudget > 0
                ? fmt(calc.dailyBudget)
                : '—'
          }
          sub={
            isLifetime
              ? daysRun > 0
                ? `over ${daysRun} day${daysRun === 1 ? '' : 's'}`
                : 'set start + end'
              : 'as last entered'
          }
        />
        <MetricBox
          label="Variance"
          value={
            variance != null
              ? `${variance >= 0 ? '+' : '-'}${fmt(Math.abs(variance))}`
              : '—'
          }
          sub={
            variancePct != null
              ? `${variancePct >= 0 ? '+' : ''}${variancePct.toFixed(1)}% vs target`
              : 'set Target Spend'
          }
          color={varianceColor}
        />
      </div>
    </div>
  );
}
