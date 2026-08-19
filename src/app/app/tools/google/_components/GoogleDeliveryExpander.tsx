'use client';

/**
 * Delivery detail for one Google campaign, as an inline row expander
 * (delivery/reallocation spec §1), plus the Google-native budget report the
 * budget-report addendum §4 adds to it.
 *
 * WHY THIS EXISTS: the pace badge cannot tell the two underspending cases apart.
 * "Behind but delivering its full daily budget" and "spending half of it" look
 * identical there and need OPPOSITE actions — raise the budget on the first,
 * move the money away from the second. Distinguishing them is the entire value
 * of this panel, so the verdict is the loudest thing in it.
 *
 * WHY A PANEL AND NOT A MODAL: the decision this feeds is comparative — who
 * gives budget and who gets it — and a modal can only ever show one campaign
 * while hiding the rest of the table behind it. Any number of rows can be open
 * at once, so two campaigns can be read side by side without either one being
 * remembered rather than seen.
 *
 * What it deliberately does NOT do: render a performance verdict. Conversion
 * tracking quality varies far too much across these accounts to trust a
 * good/bad call on the card (invariant 9), so the metrics are labelled
 * reference and point back to the platform.
 *
 * COST: opening a row costs no Google request. The charts read the already
 * synced daily-spend series, and the tiles read columns the account sync wrote
 * (§4) — which is what makes multi-open safe. Nothing here may reintroduce a
 * per-open live API read.
 *
 * NO "CAP" ANYWHERE (addendum §0). The line the bars are measured against is the
 * DAILY BUDGET. "Cap" collided with the monthly spending limit, which is a
 * genuine hard ceiling and a different number — that one keeps its own name, the
 * billing ceiling (daily budget × 30.4).
 */

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  ArrowPathIcon,
  ChevronDownIcon,
  InformationCircleIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import {
  COLORS,
  GOOGLE_CONVERSION_FLOOR,
  MONTH_DAYS_MULTIPLIER,
} from '@/lib/ad-pacer/constants';
import { fmt, fmtDate } from '@/lib/ad-pacer/helpers';
import {
  deliveryVerdict,
  monthlyLimitAfterChange,
  projectMonthly,
  projectionBasis,
  type AllocatorLine,
  type DeliveryVerdictKind,
  type TypedDailyProjection,
} from '@/lib/ad-pacer/google-allocator';
import {
  buildBudgetReport,
  isoRange,
  lastSeriesBudgetChange,
  type BudgetReport,
} from '@/lib/ad-pacer/google-budget-report';
import {
  campaignMetrics,
  impressionShareText,
  type ImpressionShareState,
} from '@/lib/ad-pacer/google-metrics';
import type { PacerAd } from '@/lib/ad-pacer/types';
import { MetricBox, Tooltip } from '@/app/app/tools/_shared';
import { DatePicker, type DateRange } from '@/components/ui/date-picker';
import { monthBoundsIso } from '@/lib/timezone';

interface HealthPayload {
  adId: string;
  name: string;
  since: string;
  /** Last day with data — what the panel stamps as "through". */
  until: string;
  /** Last whole day the month can have data for (yesterday / month end). */
  dataEdge: string;
  todayIso: string;
  /** Today's partial spend, or null in a closed month / before today's sync. */
  todaySpend: number | null;
  cap: number;
  series: { date: string; spend: number; dailyBudget: number | null }[];
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * The four delivery reads (§7, reworded by addendum §4.4). Each one is an
 * OBSERVATION about delivery — is this campaign spending its daily budget — and
 * nothing more.
 *
 * They deliberately do not say "raise it" or "cut it". Delivery is one axis;
 * whether the campaign is ahead or behind on the month is a different one, and
 * only the pace badge and recommended daily know both. Mixing them here is what
 * produced the contradiction this replaced: the popup told the desk to feed a
 * campaign ("room to spend, a modest increase should get absorbed") that the
 * target math was simultaneously, and correctly, trying to trim. Direction
 * belongs to the surfaces that can see both axes — the pace badge, the
 * recommended daily, and the headroom tag.
 */
const VERDICTS: Record<
  DeliveryVerdictKind,
  { title: string; body: string; tone: 'over' | 'under' | 'on' }
> = {
  at_cap_ahead: {
    title: 'Spending its full daily budget',
    body: 'It is using all of its daily budget, and it is running ahead of target for the month.',
    tone: 'over',
  },
  at_cap: {
    title: 'Spending its full daily budget',
    body: 'It is using all of its daily budget — the budget is what limits it, not demand.',
    tone: 'on',
  },
  room: {
    title: 'Spending below its daily budget',
    body: 'It is delivering most of its daily budget, but not all of it.',
    tone: 'on',
  },
  underdelivering: {
    title: 'Spending well below its daily budget',
    body: 'It is not filling the daily budget it already has. Search volume, bids, ad rank and the schedule are the usual causes.',
    tone: 'under',
  },
};

/**
 * The charts draw in the system accent, not in the campaign's identity color.
 *
 * The identity colors exist to tie a row to its slice of the allocation bar —
 * they answer "which campaign is this". Inside a panel that is already about one
 * campaign there is nothing to disambiguate, so the color stopped carrying
 * meaning and started carrying only variance: the same chart rendered pink on
 * one row and green on the next, and two panels open side by side looked like
 * two different instruments. The swatch beside the panel title keeps the
 * identity color; the data uses one color everywhere.
 */
const CHART_COLOR = 'var(--primary)';

const toneColor = (tone: 'over' | 'under' | 'on') =>
  tone === 'over' ? COLORS.warn : tone === 'under' ? COLORS.lifetime : COLORS.success;

export function GoogleDeliveryExpander({
  accountKey,
  period,
  line,
  ad,
  daysInMonth,
  typedDaily = null,
  typedProjection = null,
  onFlightChange,
  onSyncFromGoogle,
  syncing = false,
  readOnly = false,
}: {
  accountKey: string;
  period: string;
  line: AllocatorLine;
  /** The row behind the line — carries the sync's metric columns (§4). */
  ad: PacerAd | undefined;
  daysInMonth: number;
  /**
   * §2.5 — the daily budget being typed in the row's edit box, or null when
   * nobody is typing. The money line mirrors the box's live projection so an
   * open panel and the box above it never state two different landings for the
   * same keystroke.
   */
  typedDaily?: number | null;
  /**
   * The projection the edit box computed for that typed daily. Handed down
   * rather than recomputed here: the row and this panel have DIFFERENT views of
   * how the campaign has been delivering — the row's series is a rolling
   * eight-day slice, this panel's is the whole flight — so recomputing would put
   * two different landings for one keystroke on screen at once.
   */
  typedProjection?: TypedDailyProjection | null;
  /** Manual flight override (§6) — day-of-month bounds within the month in view. */
  onFlightChange?: (startDay: number, endDay: number) => void;
  /** Re-run the account sync. Undefined when Google isn't connected. */
  onSyncFromGoogle?: () => void;
  syncing?: boolean;
  readOnly?: boolean;
}) {
  const { data, isLoading, error } = useSWR<HealthPayload & { error?: string }>(
    `/api/google-ads-pacer/${encodeURIComponent(accountKey)}/campaign-health?period=${period}&adId=${encodeURIComponent(line.id)}`,
    fetcher,
    { revalidateOnFocus: false },
  );
  /** §4.1 — the full two-chart view. Collapsed by default so the panel stays
   *  scannable when several rows are open at once, which is the whole point of
   *  it being a panel and not a modal. */
  const [reportOpen, setReportOpen] = useState(false);

  // Every finalized day of the FLIGHT, not a rolling window (§2). The rolling
  // 7/14/30 view answered a different question every day you opened it, and on
  // the 3rd of a month its 30-day setting was mostly last month's campaign. The
  // route hands back the whole month; the slice to the flight happens here
  // because the flight — overrides and all — is already resolved on the line,
  // and resolving it twice is how a chart and a day count drift apart.
  const pad = (n: number) => String(n).padStart(2, '0');
  const flightStartIso = `${period}-${pad(line.flight.startDay)}`;
  const flightEndIso = `${period}-${pad(line.flight.endDay)}`;
  const series = useMemo(
    () =>
      (data?.series ?? []).filter((p) => p.date >= flightStartIso && p.date <= flightEndIso),
    [data?.series, flightStartIso, flightEndIso],
  );
  // The daily budget the campaign is measured against. Falls back to the row's
  // own figure so the reference line still has a place to sit while the fetch is
  // in flight.
  const dailyBudget = data?.cap ?? line.currentDaily;
  // Today's partial (§3). Present only when the sync has run today, which also
  // means the finalized series is complete through yesterday — so the live total
  // below is a real cross-check rather than a figure with a hole in it.
  const todaySpend = data?.todaySpend ?? null;
  const liveTotal = todaySpend != null ? line.spentMTD + todaySpend : null;

  /**
   * §D — the CORRECTED change date, and it feeds two different numbers: the
   * billing ceiling re-bases at it, and the projection's rate is measured from
   * it. A wrong date poisons both, from the same input.
   *
   * Two records, and the exact one wins. A push made HERE is stamped to the
   * second (`googleDailyPushedAt`), so its own calendar day is the truth. A
   * change made in Google is only visible as the first day the sync saw the new
   * rate, which can be a day late — safe, because a late date shortens the rate
   * window instead of letting an old-rate day into it. The later of the two is
   * the last change, whichever record it came from.
   *
   * The push date is read from the row's own field rather than refetched, so the
   * settling state (§B) appears the instant a push confirms; it is clamped to the
   * account's own "today" from this route, which bounds any browser-timezone skew
   * to the safe side.
   */
  const seriesChange = useMemo(() => lastSeriesBudgetChange(series), [series]);
  const pushedChangeDate = useMemo(() => {
    const raw = ad?.googleDailyPushedAt ?? null;
    if (!raw) return null;
    const ts = new Date(raw);
    if (Number.isNaN(ts.getTime())) return null;
    const local = `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())}`;
    const capped = data?.todayIso && local > data.todayIso ? data.todayIso : local;
    // A push from another month, or from after this flight ended, is not this
    // window's last change.
    if (capped < flightStartIso || capped > flightEndIso) return null;
    return capped;
  }, [ad?.googleDailyPushedAt, data?.todayIso, flightStartIso, flightEndIso]);
  const changeDate = useMemo(() => {
    const fromSeries = seriesChange?.date ?? null;
    if (fromSeries == null) return pushedChangeDate;
    if (pushedChangeDate == null) return fromSeries;
    return pushedChangeDate > fromSeries ? pushedChangeDate : fromSeries;
  }, [seriesChange, pushedChangeDate]);

  /**
   * §B/§D — the rate the month is projected on: delivery over the complete days
   * SINCE that change, never straddling it. Empty window (a push that just
   * landed) puts the projection into its settling state instead of recomputing
   * off the pushed number.
   */
  const basis = useMemo(
    () => projectionBasis({ series, changeDate }),
    [series, changeDate],
  );

  /**
   * §B — the delivery verdict runs on the same window for the same reason. Raise
   * a budget and the flight-to-date average divided by the NEW daily reads
   * "spending well below its daily budget" within a second of the push, which is
   * an observation about a rate the campaign has not run at yet.
   */
  const verdictSeries = useMemo(() => {
    if (changeDate == null) return series;
    const since = series.filter((p) => p.date > changeDate);
    // An empty window means the change landed today: the read is settling anyway,
    // and the average printed under the chart still has to describe the bars that
    // are drawn rather than nothing.
    return since.length > 0 ? since : series;
  }, [series, changeDate]);
  const verdict = useMemo(
    // Every day in the window counts — no trailing slice, because the window IS
    // the question: what has it delivered under the budget it has now.
    () => deliveryVerdict(verdictSeries, dailyBudget, verdictSeries.length || 1, line.paceStatus),
    [verdictSeries, dailyBudget, line.paceStatus],
  );

  // At-current-daily is already on the line, and is null when no daily has
  // synced — a projection off a zero rate would read as "will spend nothing"
  // when the truth is "we don't know the rate".
  const projectedAtDailyBudget = line.projectedSpend;

  // §4.1 — the report's geometry. Built over the whole FLIGHT, not just the days
  // with data: the cumulative chart's job is the gap between where the month is
  // and where it is going, and a window that stops at the last synced day cannot
  // draw the second half of that.
  const report = useMemo<BudgetReport>(
    () =>
      buildBudgetReport({
        series,
        window: isoRange(flightStartIso, flightEndIso),
        target: line.target,
        currentDaily: dailyBudget,
        // Null while settling, which drops the forecast line and its band off the
        // chart rather than drawing a straight line out of a rate nobody has
        // measured yet.
        recentAvgDaily: basis.rate,
        daysInMonth,
      }),
    [
      series,
      flightStartIso,
      flightEndIso,
      line.target,
      dailyBudget,
      basis.rate,
      daysInMonth,
    ],
  );
  /**
   * Google's monthly charging limit. At rest this is the last day of the
   * report's own ceiling series, which re-bases at each change the SERIES knows
   * about — not the current daily × 30.4, which is only the same number in a
   * month where nothing changed. While a daily is being typed it follows the
   * box, so the two never state different limits.
   */
  const restingCeiling =
    report.days.length > 0
      ? report.days[report.days.length - 1].billingCeiling
      : dailyBudget * MONTH_DAYS_MULTIPLIER;
  /**
   * §B — a push just made is NOT in the series yet (the next sync writes it), so
   * the report's ceiling still describes the old rate. The ceiling is pure
   * arithmetic on the pushed number, though, and §B is explicit that it must
   * move at once: spend so far plus the new daily across the calendar days that
   * are left. Only the projection settles.
   */
  const ceilingRebasedOnPush = useMemo(() => {
    if (pushedChangeDate == null) return null;
    if (seriesChange != null && seriesChange.date >= pushedChangeDate) return null;
    const dayOfMonth = Number(pushedChangeDate.slice(8, 10)) || 1;
    return monthlyLimitAfterChange({
      spentToDate: report.costToDate,
      newDaily: dailyBudget,
      remainingCalendarDays: Math.max(0, daysInMonth - dayOfMonth + 1),
    });
  }, [pushedChangeDate, seriesChange, report.costToDate, dailyBudget, daysInMonth]);
  const billingCeiling = typedProjection
    ? typedProjection.billingCeiling
    : (ceilingRebasedOnPush ?? restingCeiling);
  // Has the limit been re-based by a mid-month change, or is it still the plain
  // rate × 30.4? Decides which of two genuinely different sentences to print.
  const ceilingIsFlat =
    Math.abs(billingCeiling - dailyBudget * MONTH_DAYS_MULTIPLIER) < 0.5 && !typedProjection;

  /**
   * §C/§D — where the month lands, held under the ceiling. `atCeiling` is why
   * the projection can equal the ceiling exactly; it is a reason, not an alarm.
   *
   * §2.5 mirrored: while a daily is being typed upstairs, the forward-looking
   * figures follow the box exactly — the same object it rendered, never a second
   * computation of the same thing.
   */
  const projection = useMemo(
    () =>
      projectMonthly({
        basis,
        spentMTD: line.spentMTD,
        remainingDays: line.flight.remaining,
        billingCeiling,
      }),
    [basis, line.spentMTD, line.flight.remaining, billingCeiling],
  );
  const monthlyProjection = typedProjection ? typedProjection.projected : projection.projected;
  /** Settling only at rest — the edit popup is deliberately live as you type
   *  (§B), and its what-if is the one place a pushed number may drive a
   *  projection. */
  const settling = typedProjection == null && projection.settling;
  /** §C — the projection is over the CLIENT TARGET, which is the axis that
   *  decides whether to act. Never colored off the ceiling. */
  const overTarget =
    monthlyProjection != null && line.target > 0 && monthlyProjection > line.target + 0.5;

  /**
   * §D — the projection, explained in TWO PIECES. It is arithmetically
   * `spend to date + rate × days left`, but that framing hides which half is a
   * measurement: the days before the budget change are literal dollars that
   * already happened, and only the rate is carried forward. Same number, and the
   * two-piece form is the one that can be checked.
   */
  const projectionSub = settling
    ? 'budget changed — rebuilds as delivery comes in'
    : typedProjection != null
      ? `at the ${fmt(typedDaily ?? 0)}/day being typed`
      : projection.atCeiling
        ? // §C — the FLAG, and deliberately in the muted sub line rather than in
          // a color: it says why the projection equals the ceiling. Hitting the
          // ceiling is often healthy, so red stays reserved for "can't serve".
          'projected to hit its monthly ceiling'
        : projection.rate == null
          ? 'not enough delivery yet'
          : projection.changeDate != null
            ? `at ${fmt(projection.rate)}/day since the ${fmtDate(projection.changeDate)} change`
            : `at ${fmt(projection.rate)}/day recent pace`;
  const projectionTooltip = settling
    ? `The daily budget changed on ${projection.changeDate ? fmtDate(projection.changeDate) : 'the last change'}, so no full day of delivery has run under the new rate yet. A projection now would describe a budget this campaign has not run under — and for one that was not filling its old budget, there is no way to know whether the raise took until delivery arrives. The billing ceiling and the recommended daily already reflect the change; this rebuilds after a day or two of finalized delivery.`
    : projection.rate == null
      ? 'Too few days with spend to state a run rate — one busy day would set the projection for the rest of the month. This is what a brand-new or not-yet-launched campaign shows.'
      : `${
          projection.changeDate != null
            ? `${fmt(projection.spentBeforeChange)} actual through the ${fmtDate(projection.changeDate)} budget change, plus ${fmt(projection.spentSinceChange)} actual over the ${projection.daysSinceChange} finalized day${projection.daysSinceChange === 1 ? '' : 's'} since it, plus ${fmt(projection.rate)}/day × ${line.flight.remaining} day${line.flight.remaining === 1 ? '' : 's'} left${projection.rateDays < projection.daysSinceChange ? ` — the rate is the last ${projection.rateDays} of those days, so it stays a recent rate` : ''}. Only the last piece is a forecast: the dollars before it already happened, and the rate is measured only on days that ran under the budget it has now.`
            : `${fmt(line.spentMTD)} actual to date, plus ${fmt(projection.rate)}/day × ${line.flight.remaining} day${line.flight.remaining === 1 ? '' : 's'} left — the rate is the last ${projection.rateDays} finalized day${projection.rateDays === 1 ? '' : 's'}${projection.rampDaysSkipped > 0 ? `, ignoring ${projection.rampDaysSkipped} day${projection.rampDaysSkipped === 1 ? '' : 's'} of launch ramp` : ''}.`
        } Its daily budget could deliver up to ${projectedAtDailyBudget != null ? fmt(projectedAtDailyBudget) : '—'} over the same days; the gap between the two is budget room this campaign is not using, which is a reallocation question rather than a daily-budget one.${
          typedDaily != null
            ? ` Following the ${fmt(typedDaily)}/day being typed above — ${typedProjection?.boundBy === 'delivery' ? 'held at recent delivery, so a bigger budget moves the ceiling and not this number' : 'the budget is the binding constraint at that rate'}.`
            : projection.atCeiling
              ? ` At that rate it would reach ${fmt(projection.raw ?? 0)}, above the ${fmt(billingCeiling)} billing ceiling — Google settles spend back to the limit, so the ceiling is where the month lands and the projection shows it. That is not itself a problem: pinned to the ceiling and under the ${fmt(line.target)} target is a campaign spending full-out with room to spare. What to act on is the projection against the target.`
              : ''
        }${
          overTarget
            ? ` This lands over the ${fmt(line.target)} monthly target — the axis worth acting on.`
            : ''
        }`;

  /** §4.5 — when the daily budget in effect was last changed. The series' own
   *  transitions are the permanent record (Google's change_event only retains 30
   *  days), corrected by an exact push timestamp where Loomi made the change. */
  const lastChange = useMemo(() => {
    if (pushedChangeDate != null && (seriesChange == null || pushedChangeDate > seriesChange.date)) {
      return { date: pushedChangeDate, from: null as number | null, to: dailyBudget };
    }
    return seriesChange
      ? { date: seriesChange.date, from: seriesChange.from as number | null, to: seriesChange.to }
      : null;
  }, [pushedChangeDate, seriesChange, dailyBudget]);

  // §13 platform truth lives entirely on the ROW now — the status word and its
  // reason sit under the campaign name, and a contradiction is a badge there.
  // The panel used to repeat all of it as a paragraph, which meant reading the
  // same sentence twice on every open row.
  const v = VERDICTS[verdict.kind];
  // Month-to-date, from the sync's columns — NOT a live read. Scoped to the
  // month, unlike the chart window above it, so the tiles say so on the label.
  const metrics = useMemo(() => campaignMetrics(ad, line.spentMTD), [ad, line.spentMTD]);

  // Feasibility, not a recommendation: with Google's ~2×-daily single-day
  // ceiling, is the remaining budget even billable in the days left? Only shown
  // when the answer is no, and only when there IS a rate to reason about.
  const shortfall = useMemo(() => {
    const remaining = Math.max(0, line.target - line.spentMTD);
    const daysLeft = line.flight.remaining;
    if (dailyBudget <= 0 || daysLeft <= 0 || remaining <= 0) return null;
    const maxBillable = dailyBudget * 2 * daysLeft;
    const gap = remaining - maxBillable;
    // A whisker over is rounding, not a shortfall — only flag a real gap.
    if (gap <= Math.max(1, remaining * 0.02)) return null;
    return {
      remaining,
      maxBillable,
      gap,
      daysLeft,
      endIso: `${period}-${String(line.flight.endDay).padStart(2, '0')}`,
    };
  }, [line.target, line.spentMTD, line.flight.remaining, line.flight.endDay, dailyBudget, period]);

  const loadError = error || data?.error;

  return (
    // A RECESSED well, not a continuation of the row. At `bg-[var(--muted)]/20`
    // the panel and the row above it were within a hair of each other, so an
    // open row read as one very tall row and the eye had to hunt for where the
    // campaign ended and its detail began. A deeper fill, a rule top and bottom,
    // and a soft inner shadow under the top edge make it read as something that
    // opened out of the row rather than more of it.
    <div className="border-y border-[var(--border)] bg-[var(--muted)]/60 px-4 py-4 shadow-[inset_0_8px_12px_-10px_rgb(0_0_0_/_0.65)] sm:px-5">
      {/* Panel head, in the Meta pacer card's shape: what this is on the left,
          the flight window as a right-aligned label/value/sub block on the
          right. The flight used to sit in a bordered bar of its own below the
          head, which made the panel open with two stacked headers. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {/* Title over its own timestamp, mirroring the FLIGHT block opposite.
            The stamp used to run inline after the title, which made a
            three-fragment sentence of "PACING SUMMARY data through Aug 16 · set
            on Aug 11" and left the title no more weight than the caveats
            trailing it.

            No identity swatch, either: it repeated the one on the row directly
            above, and now that the charts draw in the system accent it was the
            only campaign color left in the panel — one stray dot with nothing to
            distinguish it from. */}
        <div>
          <span className="text-sm font-bold uppercase tracking-wider text-[var(--foreground)]">
            Pacing Summary
          </span>
          <div className="text-[11px] text-[var(--muted-foreground)]">
            {data?.until ? `data through ${fmtDate(data.until)}` : 'no settled days yet'}
            {/* §4.5 — the budget-change record, at its most useful size: when
                the rate the bars are measured against last moved. The full
                history is the markers on the chart below. */}
            {lastChange && (
              <Tooltip
                label={
                  lastChange.from != null
                    ? `The daily budget changed from ${fmt(lastChange.from)} to ${fmt(lastChange.to)} on ${fmtDate(lastChange.date)}. Read off this campaign's own daily-budget history, so it records changes made in Google as well as pushes made here.`
                    : `${fmt(lastChange.to)}/day was pushed from here on ${fmtDate(lastChange.date)} — exact to the second, which is why it dates the change rather than the synced series (the series only learns the new rate on its next run).`
                }
              >
                <span className="cursor-help"> · set on {fmtDate(lastChange.date)}</span>
              </Tooltip>
            )}
          </div>
        </div>
        {/* Everything in this panel is as fresh as the last sync, so the way to
            make it fresher lives next to the stamp that admits it. One shared
            account sync, not a per-campaign read: ten open panels must not fire
            ten requests, which is the whole reason the metrics moved onto the
            sync in the first place. */}
        {onSyncFromGoogle && (
            <button
              type="button"
              onClick={onSyncFromGoogle}
              disabled={syncing}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[10px] font-semibold text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowPathIcon className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing…' : 'Refresh from Google'}
            </button>
        )}
      </div>

        {/* §6 flight window — editable, because the funding window sometimes
            differs from Google's literal campaign dates. */}
        <FlightEditor
          line={line}
          period={period}
          daysInMonth={daysInMonth}
          readOnly={readOnly || !onFlightChange}
          onChange={onFlightChange}
        />
      </div>

      {/* §4.2 — the money line, above the charts. The two "where it stands now"
          figures sit together before the two forward-looking ones, so the line
          reads left to right as the month does. It replaced a "Where the month
          lands" block that printed the projection and the remaining budget a
          second time; the projection appears once now. */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <MetricBox
          label="Monthly target"
          value={fmt(line.target)}
          sub={`${line.flight.total}-day flight`}
        />
        <MetricBox
          label="Spend to Date"
          value={fmt(line.spentMTD)}
          sub={data?.until ? `through ${fmtDate(data.until)}` : 'to the data edge'}
          color={COLORS.daily}
        />
        <MetricBox
          label="Remaining Spend"
          value={fmt(line.remainingBudget)}
          sub={`${line.flight.remaining} day${line.flight.remaining === 1 ? '' : 's'} left`}
        />
        {/* §B/§C — the one box on this line that is allowed to say "not yet".
            While a change is settling it holds instead of recomputing off the
            pushed number, and when the cap bites it shows the CEILING with a flag
            saying so. Any warning color belongs to the target axis (over target),
            never to the ceiling — a budget-limited campaign pinned to its ceiling
            under target is spending full-out. */}
        <MetricBox
          label="Monthly projection"
          value={
            settling ? 'Settling' : monthlyProjection != null ? fmt(monthlyProjection) : '—'
          }
          sub={projectionSub}
          color={
            typedProjection != null
              ? 'var(--primary)'
              : settling
                ? 'var(--muted-foreground)'
                : overTarget
                  ? COLORS.warn
                  : undefined
          }
          tooltip={projectionTooltip}
        />
        <MetricBox
          label="Billing ceiling"
          value={fmt(billingCeiling)}
          sub={
            typedProjection &&
            Math.abs(typedProjection.billingCeiling - typedProjection.billingCeilingBefore) >= 0.5
              ? `was ${fmt(typedProjection.billingCeilingBefore)}`
              : ceilingRebasedOnPush != null
                ? `re-based at today's ${fmt(dailyBudget)}/day push`
                : ceilingIsFlat
                  ? `${fmt(dailyBudget)}/day × 30.4`
                  : 're-based at the last budget change'
          }
          tooltip={`The most Google can bill this month — a LIMIT, and Google's, where the monthly target is ours.${
            ceilingIsFlat
              ? ` One rate all month, so it is the plain form: ${fmt(dailyBudget)}/day × 30.4.`
              : " The budget changed mid-month, so this is NOT the current daily × 30.4. Google re-bases the limit at a change: what the month had already spent, plus the new daily × the calendar days left in the month."
          }`}
        />
      </div>

      {isLoading ? (
        <div className="mt-4 flex h-32 items-center justify-center gap-2 text-xs text-[var(--muted-foreground)]">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          Loading delivery history…
        </div>
      ) : loadError ? (
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
          {typeof loadError === 'string' ? loadError : 'Could not load delivery history.'}
        </div>
      ) : series.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
          No synced daily spend yet for this campaign. Sync from Google to build the delivery
          series.
        </div>
      ) : (
        <>
          {/* §4.1 — the budget report. The daily bars are always on, because they
              are what the delivery read below is computed from; the cumulative
              chart is behind the disclosure, because it answers the slower
              question ("where does the month land") and stacking two charts on
              every open row makes the table unscannable. */}
          <div className="mt-4 mb-1.5 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Daily delivery
            </span>
            <Tooltip label="Blue is what the campaign spent that day. The gray behind it is Google's single-day spending limit — 2× that day's daily budget — so a day over the daily budget is normal, and a day at the gray is the most it could possibly have spent.">
              <span className="cursor-help text-[10px] text-[var(--muted-foreground)]">
                vs the 2× single-day limit
              </span>
            </Tooltip>
            <button
              type="button"
              onClick={() => setReportOpen((o) => !o)}
              aria-expanded={reportOpen}
              className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            >
              {reportOpen ? 'Hide budget report' : 'Budget report'}
              <ChevronDownIcon
                className={`h-3 w-3 transition-transform ${reportOpen ? 'rotate-180' : ''}`}
              />
            </button>
          </div>

          {reportOpen && (
            <CumulativeChart
              report={report}
              color={CHART_COLOR}
              target={line.target}
              todayIso={data?.todayIso ?? null}
            />
          )}

          <DailyBars
            report={report}
            color={CHART_COLOR}
            compact={!reportOpen}
            todayIso={data?.todayIso ?? null}
            todaySpend={todaySpend}
            hasAdSchedule={line.hasAdSchedule}
          />

          {/* The axis spans the charted WINDOW — the whole flight — not the days
              with data in it. It used to end at the data edge, which was right
              when the chart stopped there; now that the bars run to the end of
              the flight, an axis ending on the last synced day would label the
              wrong bar. How current the data is is the "data through" stamp at
              the top of the panel and the finalized-day count in the middle
              here, both of which say it in words. */}
          <div className="mt-1.5 flex justify-between text-[10px] text-[var(--muted-foreground)]">
            <span>{fmtDate(flightStartIso)}</span>
            {/* The average the delivery read below is computed from, over the
                window it actually used — the days since the budget last changed
                when there was one (§B), because an average that straddles a
                change measures two budgets at once. */}
            <span className="tabular-nums">
              avg {fmt(verdict.avgDaily)}/day across {verdictSeries.length} finalized day
              {verdictSeries.length === 1 ? '' : 's'}
              {changeDate != null && verdictSeries.length < series.length
                ? ' since the change'
                : ''}
            </span>
            <span>{fmtDate(flightEndIso)}</span>
          </div>

          {/* Live-total cross-check (§3). "~", never "=": today keeps accruing
              after the sync that produced it. This is the number someone sees in
              the Google Ads account, so it exists to make the finalized figures
              above trustworthy rather than look stale. */}
          {liveTotal != null && (
            <Tooltip
              className="mt-1.5 mb-4 block"
              label={`Approximate, and for cross-checking against the Google Ads account: ${fmt(line.spentMTD)} finalized through ${data?.until ? fmtDate(data.until) : 'the data edge'} plus ${fmt(todaySpend ?? 0)} so far today. "~" because today keeps accruing after the sync that produced it.`}
            >
              <div className="cursor-help">
                <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                  live total ~
                </span>{' '}
                <span className="text-base font-bold tabular-nums text-[var(--foreground)]">
                  {fmt(liveTotal)}
                </span>{' '}
                <span className="text-[10px] tabular-nums text-[var(--muted-foreground)]">
                  ({fmt(line.spentMTD)} through{' '}
                  {data?.until ? fmtDate(data.until) : 'the data edge'} + {fmt(todaySpend ?? 0)}{' '}
                  today)
                </span>
              </div>
            </Tooltip>
          )}
          {liveTotal == null && <div className="mb-4" />}

          {/* §4.4 — the plain delivery read. Neutral and descriptive: whether to
              spend more is carried by the recommended daily, not by this.

              §B — and it settles with the projection, on the same window and for
              the same reason. The instant a budget is raised, yesterday's
              delivery divided by the new daily reads "spending well below its
              daily budget" — a fault verdict about a rate the campaign has not
              run at for one full day. Holding says so instead of inventing a
              fill number. */}
          {settling ? (
            <div className="mb-4 rounded-lg bg-[var(--muted)] px-3.5 py-3 text-[11px] leading-relaxed text-[var(--foreground)]">
              <div className="mb-1 text-[12px] font-bold text-[var(--muted-foreground)]">
                Delivery read rebuilding
              </div>
              The daily budget changed
              {projection.changeDate ? ` on ${fmtDate(projection.changeDate)}` : ''}, so there is no
              full day of delivery under {fmt(dailyBudget)}/day yet. This fills back in as
              finalized days arrive — usually a day or two.
            </div>
          ) : (
            <div
              className="mb-4 rounded-lg px-3.5 py-3 text-[11px] leading-relaxed"
              style={{ background: `${toneColor(v.tone)}14`, color: 'var(--foreground)' }}
            >
              <div className="mb-1 text-[12px] font-bold" style={{ color: toneColor(v.tone) }}>
                {v.title}
                {verdict.ratio != null && (
                  <span className="ml-1.5 font-medium tabular-nums opacity-80">
                    {Math.round(verdict.ratio * 100)}% of daily budget
                  </span>
                )}
              </div>
              {v.body}
            </div>
          )}

          {/* The one piece of reasoning the recommendation deliberately no
              longer carries: whether the remaining budget can PHYSICALLY still
              bill. Google will spend at most ~2× the daily on any one day, so
              past a point the catch-up rate is arithmetically correct and
              operationally impossible — that belongs here, next to the delivery
              picture, not in the number. */}
          {shortfall != null && (
            <div
              className="mb-4 rounded-lg px-3.5 py-3 text-[11px] leading-relaxed"
              style={{ background: `${COLORS.error}14`, color: 'var(--foreground)' }}
            >
              <div className="mb-1 text-[12px] font-bold" style={{ color: COLORS.error }}>
                Can’t fully recover by {fmtDate(shortfall.endIso)}
              </div>
              {fmt(shortfall.remaining)} remains but at most ~{fmt(shortfall.maxBillable)} can still
              bill over {shortfall.daysLeft} day{shortfall.daysLeft === 1 ? '' : 's'} at 2× the{' '}
              {fmt(dailyBudget)} daily budget — short about {fmt(shortfall.gap)}. Move it to a
              campaign that can absorb it, or accept the miss.
            </div>
          )}

          {/* §4.3 — one reference line, one neutral weight. These are soft
              figures whose quality varies by account, so they deliberately do
              NOT sit at equal weight with the firm dollars above the chart, and
              nothing here is colored as a verdict. */}
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-[var(--border)] pt-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Quick campaign insights
            </span>
            {metrics.asOf && (
              <span className="text-[10px] text-[var(--muted-foreground)]">
                reference · through {fmtDate(metrics.asOf)}
              </span>
            )}
          </div>
          {metrics.neverSynced ? (
            <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-[11px] text-[var(--muted-foreground)]">
              No metrics synced for this campaign yet. Sync from Google to fill these in.
            </div>
          ) : (
            <div className="flex flex-wrap items-end">
              <InsightStat
                label="Conv rate"
                value={metrics.convRate != null ? `${(metrics.convRate * 100).toFixed(1)}%` : '—'}
                hint={
                  metrics.convRate == null
                    ? `Too few conversions this month to state a rate — below ${GOOGLE_CONVERSION_FLOOR}, one more lead swings it wildly. Read it in Google Ads.`
                    : `${Math.round(metrics.conversions ?? 0)} conversions this month, month to date.`
                }
              />
              <InsightStat
                label="Cost / conv"
                value={metrics.costPerConversion != null ? whole(metrics.costPerConversion) : '—'}
                hint={
                  metrics.costPerConversion == null
                    ? `Too few conversions this month to state a cost per conversion — below ${GOOGLE_CONVERSION_FLOOR}, one more lead would move it by hundreds of dollars. Read it in Google Ads.`
                    : `${fmt(line.spentMTD)} spent ÷ ${Math.round(metrics.conversions ?? 0)} conversions.`
                }
              />
              <InsightStat
                label="Avg CPC"
                value={metrics.avgCpc != null ? fmt(metrics.avgCpc) : '—'}
                hint={
                  metrics.clicks != null
                    ? `${fmt(line.spentMTD)} spent ÷ ${metrics.clicks.toLocaleString()} clicks.`
                    : undefined
                }
              />
              <InsightStat
                label="CTR"
                value={metrics.ctr != null ? `${(metrics.ctr * 100).toFixed(1)}%` : '—'}
                hint={
                  metrics.impressions != null && metrics.clicks != null
                    ? `${metrics.clicks.toLocaleString()} clicks ÷ ${metrics.impressions.toLocaleString()} impressions.`
                    : undefined
                }
              />
              <ImpressionShareInsight
                label="Lost IS budget"
                state={metrics.budgetLostIs}
                hint="Share of impressions lost because the budget ran out. HIGH means real demand is going unserved — this campaign will absorb more money. Near zero means it is not budget-limited, so raising its daily will not increase spend."
              />
              <ImpressionShareInsight
                label="Lost IS rank"
                state={metrics.rankLostIs}
                hint="Share of impressions lost to ad rank. HIGH means bid or Quality Score is the constraint, not budget — more money will just sit unspent. It answers whether budget will help, yes or no; it does NOT tell you whether to fix the bid or the Quality Score."
              />
            </div>
          )}
          <p className="mt-2 text-[10px] leading-relaxed text-[var(--muted-foreground)]">
            Reference only. Conversion figures depend on this account’s tracking setup — verify in
            Google Ads before acting on efficiency.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * §4.1 — the cumulative chart, modeled on Google's own budget report.
 *
 * Four series, and the two reference lines are the ones that get confused, so
 * both carry a hover tooltip saying whose number they are:
 *
 *  - **Target pace** (primary) is OURS. The even-spend line to the monthly
 *    target — what the pace badge grades against.
 *  - **Billing ceiling** (secondary) is GOOGLE'S, and it is a limit rather than a
 *    plan. It steps wherever the daily budget changed.
 *  - **Cost to date** is what actually happened, and it stops at the data edge.
 *    Today is never folded into it: it is a partial day, and a half-day of spend
 *    at the end of a solid line reads as a collapse.
 *  - **Loomi projection** is the only line that can be wrong, so it is dotted and
 *    carries a band — the room between recent delivery and what the current
 *    daily could deliver.
 *
 * Hand-rolled SVG rather than the unused Google Charts wrapper: four series with
 * one step function and one band is less code than the adapter would be, and it
 * inherits the theme's colors for free.
 */
function CumulativeChart({
  report,
  color,
  target,
  todayIso,
}: {
  report: BudgetReport;
  color: string;
  target: number;
  todayIso: string | null;
}) {
  const { days, cumulativeScale, projection, edgeIndex } = report;
  if (days.length === 0) return null;
  const n = days.length;
  // A viewBox in DAY units, so every x is just an index. Strokes are pinned with
  // vector-effect so the non-uniform scale can't render a 1px line as a wedge.
  const x = (i: number) => i + 0.5;
  const y = (value: number) => 100 - (value / cumulativeScale) * 100;

  // Both cumulative lines start at ZERO on the left edge. They used to begin at
  // day one's value, which floats the whole chart off its own baseline and makes
  // a campaign that spent $30 on the 1st look like it started the month $30 in
  // the air with no origin to read it against.
  const origin = `0,${y(0)}`;
  const targetLine = [origin, ...days.map((d) => `${x(d.index)},${y(d.targetPace)}`)].join(' ');
  // Stepped: the ceiling holds its value until the day it changes.
  const ceilingLine = days
    .flatMap((d, i) =>
      i === 0
        ? [`${x(0)},${y(d.billingCeiling)}`]
        : [`${x(i)},${y(days[i - 1].billingCeiling)}`, `${x(i)},${y(d.billingCeiling)}`],
    )
    .join(' ');
  const costPoints = days.filter((d) => d.cumulative != null);
  const costLine =
    costPoints.length > 0
      ? [origin, ...costPoints.map((d) => `${x(d.index)},${y(d.cumulative as number)}`)].join(' ')
      : '';
  const paceLine = projection.map((p) => `${x(p.index)},${y(p.pace)}`).join(' ');
  const band =
    projection.length > 1
      ? [
          ...projection.map((p) => `${x(p.index)},${y(p.high)}`),
          ...[...projection].reverse().map((p) => `${x(p.index)},${y(p.low)}`),
        ].join(' ')
      : '';

  const todayIndex = todayIso ? days.findIndex((d) => d.date === todayIso) : -1;

  return (
    <div className="mb-3">
      <svg
        viewBox={`0 0 ${n} 100`}
        preserveAspectRatio="none"
        className="h-36 w-full"
        role="img"
        aria-label="Cumulative spend against target pace and the billing ceiling"
      >
        {/* A baseline, so the lines have a floor to be read against. */}
        <line
          x1={0}
          x2={n}
          y1={100}
          y2={100}
          stroke="var(--border)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {/* The projection band, first so every line draws over it. It fans out
            from the data edge: closed where the last real day is, widening with
            every day of forecast, and flattened wherever the billing ceiling
            caps it. */}
        {band && <polygon points={band} fill={color} opacity={0.18} />}
        {/* §4.5 — a divider wherever the daily budget changed. The steps in the
            ceiling line are the same event; the divider is what makes them
            legible as a deliberate change rather than a kink in the data. */}
        {days
          .filter((d) => d.budgetChange)
          .map((d) => (
            <line
              key={d.date}
              x1={x(d.index)}
              x2={x(d.index)}
              y1={0}
              y2={100}
              stroke="var(--muted-foreground)"
              strokeWidth={1}
              strokeDasharray="2 3"
              opacity={0.4}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        <polyline
          points={ceilingLine}
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={1}
          strokeDasharray="4 3"
          opacity={0.7}
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={targetLine}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={1.5}
          opacity={0.55}
          vectorEffect="non-scaling-stroke"
        />
        {paceLine && (
          <polyline
            points={paceLine}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {costLine && (
          <polyline
            points={costLine}
            fill="none"
            stroke={color}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {/* Today, at the edge — a marker, never part of the solid line. */}
        {todayIndex >= 0 && (
          <line
            x1={x(todayIndex)}
            x2={x(todayIndex)}
            y1={0}
            y2={100}
            stroke={color}
            strokeWidth={1}
            strokeDasharray="1 2"
            opacity={0.8}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {/* Where the real data stops. A TICK, not a dot: this viewBox is one
            unit per day stretched across the panel's full width, so x is scaled
            roughly thirty times more than y and any circle drawn in it comes out
            as a wide lens lying across the chart — which is exactly what it did.
            Anything marking a point in here has to be a stroked line with a
            non-scaling stroke, which is measured in screen pixels and cannot be
            distorted by the viewBox at all. */}
        {edgeIndex != null && (
          <line
            x1={x(edgeIndex)}
            x2={x(edgeIndex)}
            y1={y(report.costToDate) - 4}
            y2={y(report.costToDate) + 4}
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[var(--muted-foreground)]">
        <Tooltip label="What this campaign is graded against: its monthly target spread evenly across its flight days. Ours, not Google's — Google has never heard of it.">
          <span className="flex cursor-help items-center gap-1.5">
            <span className="h-0 w-4 border-t-2 border-[var(--foreground)] opacity-55" />
            Target pace · {fmt(target)}
          </span>
        </Tooltip>
        <Tooltip label="The most Google can bill this month at the daily budgets actually in effect: their calendar-day-weighted average × 30.4. A hard limit set by Google, and a different number from the target — it steps wherever the budget changed.">
          <span className="flex cursor-help items-center gap-1.5">
            <span className="h-0 w-4 border-t border-dashed border-[var(--muted-foreground)]" />
            Billing ceiling
          </span>
        </Tooltip>
        {/* No dollar figure here on purpose. The authoritative cost to date is
            the account sync's month-to-date spend, printed on the money line a
            few inches above; this line is drawn from the daily series, which can
            legitimately sit lower when the sync is behind on a day or the flight
            window clips one. Two figures under one name would read as a bug
            whichever way they disagreed. */}
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2" style={{ borderColor: color }} />
          Cost to date
        </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0 w-4 border-t border-dashed" style={{ borderColor: color }} />
            Projection
          </span>
      </div>
    </div>
  );
}

/**
 * §4.1 — the daily bars: what the campaign spent each day against what Google
 * would have let it spend.
 *
 * The gray bar behind each blue one is that day's SINGLE-DAY spending limit —
 * 2× that day's daily budget — not the daily budget itself. Google will spend up
 * to double on a strong day and settle the average over the month, so a bar over
 * the daily budget is ordinary and a bar at the gray is genuinely everything
 * that day could hold. Because `dailyBudget` is frozen per day by the sync, the
 * gray steps at each budget change on its own.
 */
function DailyBars({
  report,
  color,
  compact,
  todayIso,
  todaySpend,
  hasAdSchedule,
}: {
  report: BudgetReport;
  color: string;
  compact: boolean;
  todayIso: string | null;
  todaySpend: number | null;
  hasAdSchedule: boolean;
}) {
  const scale = report.dailyScale;
  return (
    <>
      <div className={`relative flex ${compact ? 'h-20' : 'h-32'} items-end gap-[3px]`}>
        {report.days.map((d) => {
          const isToday = todayIso != null && d.date === todayIso;
          const spend = isToday ? (todaySpend ?? 0) : (d.spend ?? 0);
          const limitPct = Math.min(100, (d.dailyLimit / scale) * 100);
          const budgetPct = Math.min(100, (d.dailyBudget / scale) * 100);
          const spendPct = Math.max(spend > 0 ? 2 : 0, (spend / scale) * 100);
          return (
            <Tooltip
              key={d.date}
              label={
                isToday
                  ? `${fmtDate(d.date)} · ${fmt(spend)} so far — a partial day. It is in no average, verdict or total on this panel.`
                  : d.future
                    ? `${fmtDate(d.date)} · not yet — at ${fmt(d.dailyBudget)}/day Google could bill up to ${fmt(d.dailyLimit)} that day.`
                    : `${fmtDate(d.date)} · ${fmt(spend)} of a ${fmt(d.dailyLimit)} single-day limit (${fmt(d.dailyBudget)}/day budget)${d.budgetChange ? ' · budget changed this day' : ''}`
              }
              // h-full matters: the bar's height is a PERCENTAGE, so the tooltip
              // wrapper it sits in has to be a full-height box or the percentage
              // resolves against auto and the bar vanishes.
              className="h-full min-w-0 flex-1 items-end"
            >
              <span className="relative block h-full w-full">
                {/* Google's single-day limit — a BACKDROP, not a bar. It is 2×
                    the daily budget, so at any healthy delivery it is twice the
                    height of the blue beside it: drawn at full strength it made
                    the chart a wall of gray blocks with the actual data buried at
                    half height inside them. It is a reference, so it is drawn
                    like one. */}
                <span
                  className="absolute bottom-0 left-0 w-full rounded-t-sm bg-[var(--muted)]"
                  style={{ height: `${limitPct}%`, opacity: d.future && !isToday ? 0.25 : 0.5 }}
                />
                {/* The daily budget itself (1×) — the line the delivery read
                    below is measured against, and the one number this chart is
                    really about. Without it "spending its full daily budget"
                    has nothing on the chart to point at. */}
                <span
                  className="absolute left-0 w-full border-t border-dashed border-[var(--muted-foreground)]"
                  style={{ bottom: `${budgetPct}%`, opacity: d.future && !isToday ? 0.3 : 0.6 }}
                />
                <span
                  className="absolute bottom-0 left-0 w-full rounded-t-sm"
                  style={{
                    height: `${spendPct}%`,
                    // Today is hatched, never solid (§3): it is a partial day and
                    // a short solid bar beside full ones reads as a collapse.
                    background: isToday ? 'transparent' : color,
                    backgroundImage: isToday
                      ? `repeating-linear-gradient(45deg, ${color} 0 3px, transparent 3px 6px)`
                      : undefined,
                    opacity: 0.9,
                  }}
                />
                {/* §4.5 — the budget-change divider. */}
                {d.budgetChange && (
                  <span className="absolute bottom-0 left-0 h-full w-px bg-[var(--muted-foreground)] opacity-50" />
                )}
              </span>
            </Tooltip>
          );
        })}
      </div>
      {hasAdSchedule && (
        <Tooltip label="This campaign runs on an ad schedule, so Google concentrates its monthly budget into the days it is actually on. The gray limits above assume every day — on a scheduled campaign they read low on active days and high on inactive ones. Badged, not modeled.">
          <div
            className="mt-1.5 cursor-help text-[10px]"
            style={{ color: COLORS.warn }}
          >
            Ad schedule — the single-day limits above assume every day is active.
          </div>
        </Tooltip>
      )}
    </>
  );
}

/** Whole dollars. A cost-per-conversion is never accurate to the cent — it moves
 *  by dollars every time one more lead lands — so printing two decimals claims a
 *  precision the figure does not have. */
function whole(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/**
 * §4.3 — one figure on the reference line: an evenly-spaced column with a thin
 * left rule, label above value.
 *
 * Deliberately lighter than the money cards above the chart. These are soft
 * figures whose quality varies by account — conversion tracking especially —
 * and giving them equal weight with the firm dollars is how an account with a
 * broken conversion tag ends up driving a budget decision. The supporting counts
 * (clicks, impressions, conversions) moved into the hover: they are the working,
 * not the reading.
 */
function InsightStat({
  label,
  value,
  hint,
  muted = false,
}: {
  label: string;
  value: string;
  hint?: string;
  muted?: boolean;
}) {
  const outer =
    'min-w-0 flex-1 border-l border-[var(--border)] pl-4 first:border-l-0 first:pl-0';
  const body = (
    <>
      <div className="inline-flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
        {label}
        {hint && <InformationCircleIcon className="h-3 w-3 flex-shrink-0 opacity-60" />}
      </div>
      <div
        className={
          muted
            ? 'text-[11px] font-medium leading-tight text-[var(--muted-foreground)]'
            : 'text-base font-semibold tabular-nums leading-tight text-[var(--foreground)]'
        }
      >
        {value}
      </div>
    </>
  );
  // A dash with no explanation reads as a bug. When we are deliberately
  // withholding a figure, say why on hover rather than leaving it blank.
  return hint ? (
    <Tooltip label={hint} className={`${outer} cursor-help`}>
      <div className="w-full">{body}</div>
    </Tooltip>
  ) : (
    <div className={outer}>{body}</div>
  );
}

/**
 * An impression-share figure (§4). Three outcomes, three different sentences —
 * collapsing any of them into "0%" inverts the move decision, because 0% lost to
 * budget means "this campaign cannot absorb more money" while no reading at all
 * means "look at the bars instead".
 */
function ImpressionShareInsight({
  label,
  state,
  hint,
}: {
  label: string;
  state: ImpressionShareState;
  hint: string;
}) {
  if (state.kind === 'unsupported') {
    return (
      <InsightStat
        label={label}
        value="Not available"
        muted
        hint={`${hint}\n\nSearch and Shopping only — Google does not report search impression share for this campaign type. For Performance Max and Demand Gen, read delivery off the daily bars above instead.`}
      />
    );
  }
  if (state.kind === 'no_data') {
    return (
      <InsightStat
        label={label}
        value="No data"
        muted
        hint={`${hint}\n\nBelow Google's reporting threshold: it returned no figure this month, usually too little volume to report on yet. This is not the same as zero.`}
      />
    );
  }
  return <InsightStat label={label} value={impressionShareText(state).text} hint={hint} />;
}

/**
 * The flight window for the month in view, as day-of-month bounds (§6). Editing
 * writes an OVERRIDE — it never rewrites the Ad Planner's flight dates, which
 * are a different statement (what we planned, vs. what the money actually funds).
 */
function FlightEditor({
  line,
  period,
  daysInMonth,
  readOnly,
  onChange,
}: {
  line: AllocatorLine;
  period: string;
  daysInMonth: number;
  readOnly: boolean;
  onChange?: (startDay: number, endDay: number) => void;
}) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const bounds = monthBoundsIso(period);
  const range: DateRange = {
    start: `${period}-${pad(line.flight.startDay)}`,
    end: `${period}-${pad(line.flight.endDay)}`,
  };

  /** Calendar dates back to day-of-month, clamped to the month in view — the
   *  flight is a within-month window, so a date outside it cannot be meant. */
  const commit = (next: DateRange) => {
    if (!onChange || !next.start) return;
    const dayOf = (iso: string) => Number(iso.slice(8, 10));
    const inMonth = (iso: string) => bounds != null && iso >= bounds.start && iso <= bounds.end;
    const s = inMonth(next.start) ? dayOf(next.start) : 1;
    const e = next.end && inMonth(next.end) ? dayOf(next.end) : daysInMonth;
    onChange(Math.min(s, e), Math.max(s, e));
  };

  return (
    // Meta's card-head shape: tiny uppercase label, the value at size, the
    // supporting count underneath, right-aligned. It reads as part of the panel
    // head rather than as a control panel of its own.
    <div className="flex flex-shrink-0 items-start gap-1.5 text-right">
      <div>
        <Tooltip label="The days this campaign is funded for THIS month. Auto-derived from its Google dates — override it when the funding window differs (e.g. the campaign existed on the 1st but wasn't funded until mid-month).">
          <span className="cursor-help text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Flight
          </span>
        </Tooltip>
        <div className="whitespace-nowrap text-base font-bold tabular-nums text-[var(--foreground)]">
          {fmtDate(range.start ?? '')} – {fmtDate(range.end ?? '')}
        </div>
        <div className="text-[10px] tabular-nums text-[var(--muted-foreground)]">
          {line.flight.elapsed} of {line.flight.total} days in · {line.flight.remaining} left
        </div>
      </div>
      {!readOnly && onChange && (
        <DatePicker
          mode="range"
          value={range}
          onChange={commit}
          // The trigger's default styling is a full bordered input. Our
          // triggerContent is already a bordered icon button, so leaving it on
          // draws a box around a box — pass a bare class to strip it.
          className="mt-3 inline-flex rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          triggerContent={
            <Tooltip label="Adjust flight">
              <span
                aria-label="Adjust flight"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
              >
                <PencilSquareIcon className="h-3 w-3" />
              </span>
            </Tooltip>
          }
        />
      )}
    </div>
  );
}
