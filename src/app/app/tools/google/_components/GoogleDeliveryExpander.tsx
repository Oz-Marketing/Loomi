'use client';

/**
 * Delivery detail for one Google campaign, as an inline row expander
 * (delivery/reallocation spec §1). Replaces the delivery-health modal.
 *
 * WHY THIS EXISTS: the pace badge cannot tell the two underspending cases apart.
 * "Behind but delivering its full daily" and "spending half its cap" look
 * identical there and need OPPOSITE actions — raise the cap on the first, move
 * the money away from the second. Distinguishing them is the entire value of
 * this panel, so the verdict is the loudest thing in it.
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
 * COST: opening a row costs no Google request. The chart reads the already
 * synced daily-spend series, and the tiles read columns the account sync wrote
 * (§4) — which is what makes multi-open safe. Nothing here may reintroduce a
 * per-open live API read.
 */

import { useMemo } from 'react';
import useSWR from 'swr';
import { ArrowPathIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { COLORS, GOOGLE_CONVERSION_FLOOR } from '@/lib/ad-pacer/constants';
import { fmt, fmtDate } from '@/lib/ad-pacer/helpers';
import {
  deliveryVerdict,
  projectAtDaily,
  recentPace,
  type AllocatorLine,
  type DeliveryVerdictKind,
} from '@/lib/ad-pacer/google-allocator';
import {
  campaignMetrics,
  impressionShareText,
  type ImpressionShareState,
} from '@/lib/ad-pacer/google-metrics';
import {
  normalizeAdStatus,
  parseStatusReasons,
  statusMismatch,
  statusReasonText,
} from '@/lib/ad-pacer/platform-status';
import type { PacerAd } from '@/lib/ad-pacer/types';
import { Tooltip } from '@/app/app/tools/_shared';
import { DatePicker, type DateRange } from '@/components/ui/date-picker';
import { monthBoundsIso } from '@/lib/timezone';
import { CAMPAIGN_COLORS } from './google-pacing-theme';

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
 * The four verdicts (§7). Each one is an OBSERVATION about delivery — is this
 * campaign filling its cap — and nothing more.
 *
 * They deliberately do not say "raise it" or "cut it". Delivery is one axis;
 * whether the campaign is ahead or behind on the month is a different one, and
 * only the pace badge and recommended daily know both. Mixing them here is what
 * produced the contradiction this replaced: the popup told the desk to feed a
 * campaign ("room to spend, a modest increase should get absorbed") that the
 * target math was simultaneously, and correctly, trying to trim. Direction
 * belongs to the surfaces that can see both axes — the pace badge, the
 * recommended daily, and the capped/headroom tooltip.
 */
const VERDICTS: Record<
  DeliveryVerdictKind,
  { title: string; body: string; tone: 'over' | 'under' | 'on' }
> = {
  at_cap_ahead: {
    title: 'Spending to cap',
    body: 'It is using its full daily budget, and it is running ahead of target for the month.',
    tone: 'over',
  },
  at_cap: {
    title: 'Delivering to cap',
    body: 'It is spending its full daily budget — the cap is what limits it, not demand.',
    tone: 'on',
  },
  room: {
    title: 'Room to spend',
    body: 'It is delivering most of its daily budget, but not all of it.',
    tone: 'on',
  },
  underdelivering: {
    title: 'Underdelivering',
    body: 'It is spending well under its cap: it is not filling the budget it already has. Search volume, bids, ad rank and the schedule are the usual causes.',
    tone: 'under',
  },
};

const toneColor = (tone: 'over' | 'under' | 'on') =>
  tone === 'over' ? COLORS.warn : tone === 'under' ? COLORS.lifetime : COLORS.success;

export function GoogleDeliveryExpander({
  accountKey,
  period,
  line,
  ad,
  daysInMonth,
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
  // The cap the campaign is measured against: its live daily budget. Falls back
  // to the row's own figure so the dashed line still has a place to sit while
  // the fetch is in flight.
  const cap = data?.cap ?? line.currentDaily;
  const verdict = useMemo(
    // Every shown day counts toward the verdict — no trailing slice, because the
    // series IS the window now.
    () => deliveryVerdict(series, cap, series.length || 1, line.paceStatus),
    [series, cap, line.paceStatus],
  );
  // Today's partial (§3). Present only when the sync has run today, which also
  // means the finalized series is complete through yesterday — so the live total
  // below is a real cross-check rather than a figure with a hole in it.
  const todaySpend = data?.todaySpend ?? null;
  const liveTotal = todaySpend != null ? line.spentMTD + todaySpend : null;

  // The two projections (§5). They will often disagree, and the disagreement is
  // the signal: recent-pace far below at-current-daily means the campaign has
  // budget room it isn't using.
  const pace = useMemo(() => recentPace(series), [series]);
  const projectedRecent = projectAtDaily(line.spentMTD, pace.avgDaily, line.flight.remaining);
  // At-current-daily is already on the line, and is null when no daily has
  // synced — a projection off a zero rate would read as "will spend nothing"
  // when the truth is "we don't know the rate".
  const projectedAtCap = line.projectedSpend;

  // §13 platform truth, for the reason panel above the chart.
  const platformStatus = ad ? normalizeAdStatus(ad) : 'Unknown';
  const statusReasons = parseStatusReasons(ad?.googlePrimaryStatusReasons);
  const mismatch = ad ? statusMismatch(ad) : null;
  const v = VERDICTS[verdict.kind];
  const color = CAMPAIGN_COLORS[line.colorIndex % CAMPAIGN_COLORS.length];
  // Month-to-date, from the sync's columns — NOT a live read. Scoped to the
  // month, unlike the chart window above it, so the tiles say so on the label.
  const metrics = useMemo(() => campaignMetrics(ad, line.spentMTD), [ad, line.spentMTD]);

  // Feasibility, not a recommendation: with Google's ~2×-daily single-day
  // ceiling, is the remaining budget even billable in the days left? Only shown
  // when the answer is no, and only when there IS a rate to reason about.
  const shortfall = useMemo(() => {
    const remaining = Math.max(0, line.target - line.spentMTD);
    const daysLeft = line.flight.remaining;
    if (cap <= 0 || daysLeft <= 0 || remaining <= 0) return null;
    const maxBillable = cap * 2 * daysLeft;
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
  }, [line.target, line.spentMTD, line.flight.remaining, line.flight.endDay, cap, period]);

  // Chart scale: the taller of the cap and the biggest day, with headroom, so
  // the dashed cap line is always on screen even when nothing came close to it.
  const maxSpend = series.reduce((m, p) => Math.max(m, p.spend), 0);
  const scale = Math.max(cap, maxSpend) * 1.12 || 1;
  const loadError = error || data?.error;

  return (
    <div className="border-t border-[var(--border)] bg-[var(--muted)]/20 px-4 py-4 sm:px-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ background: color }} />
        <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--foreground)]">
          Delivery
        </span>
        {data?.until && (
          <span className="text-[11px] text-[var(--muted-foreground)]">
            data through {fmtDate(data.until)}
          </span>
        )}
        {/* Everything in this panel is as fresh as the last sync, so the way to
            make it fresher lives next to the stamp that admits it. One shared
            account sync, not a per-campaign read: ten open panels must not fire
            ten requests, which is the whole reason the metrics moved onto the
            sync in the first place. */}
        {onSyncFromGoogle && (
          <Tooltip label="Re-pull spend and metrics for every campaign on this account from Google.">
            <button
              type="button"
              onClick={onSyncFromGoogle}
              disabled={syncing}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[10px] font-semibold text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowPathIcon className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing…' : 'Refresh from Google'}
            </button>
          </Tooltip>
        )}
      </div>

      {/* §13 — the full "why it isn't serving" reason set. The row carries the
          status dot and, on a contradiction, the warning; this is where the
          detail behind it lives, because it is a paragraph and the row is not. */}
      {ad && (statusReasons.length > 0 || mismatch) && (
        <div
          className="mb-3 rounded-lg px-3 py-2 text-[11px] leading-relaxed"
          style={{
            background: mismatch ? `${COLORS.error}14` : 'var(--muted)',
            color: 'var(--foreground)',
          }}
        >
          {mismatch && (
            <div className="mb-0.5 font-bold" style={{ color: COLORS.error }}>
              {mismatch.kind === 'not_serving'
                ? `Not serving — Loomi has this as “${ad.adStatus}”, Google reports it ${platformStatus.toLowerCase()}`
                : `Running in Google — Loomi has this as “${ad.adStatus}”`}
            </div>
          )}
          {statusReasons.length > 0 ? (
            <>
              Google status: <strong>{ad.googlePrimaryStatus ?? platformStatus}</strong> —{' '}
              {statusReasons.map(statusReasonText).join('; ')}.
            </>
          ) : (
            <>
              Google reports this campaign <strong>{platformStatus.toLowerCase()}</strong>.
            </>
          )}
          {mismatch?.kind === 'not_serving' && (
            <>
              {' '}
              Until that is resolved, its recommended daily is a number for a campaign that is not
              running.
            </>
          )}
        </div>
      )}

      {/* §6 flight window — editable, because the funding window sometimes
          differs from Google's literal campaign dates. */}
      <FlightEditor
        line={line}
        period={period}
        daysInMonth={daysInMonth}
        readOnly={readOnly || !onFlightChange}
        onChange={onFlightChange}
      />

      <div className="mt-4" />

      {isLoading ? (
        <div className="flex h-32 items-center justify-center gap-2 text-xs text-[var(--muted-foreground)]">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          Loading delivery history…
        </div>
      ) : loadError ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
          {typeof loadError === 'string' ? loadError : 'Could not load delivery history.'}
        </div>
      ) : series.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
          No synced daily spend yet for this campaign. Sync from Google to build the delivery
          series.
        </div>
      ) : (
        <>
          {/* Bars = actual daily spend; dashed line = the daily cap. A day over
              the cap is normal on Google (up to 2×), so it is tinted rather
              than flagged. */}
          <div className="relative flex h-28 items-end gap-[3px]">
            {series.map((p) => (
              <Tooltip
                key={p.date}
                label={`${fmtDate(p.date)} · ${fmt(p.spend)}`}
                // h-full matters: the bar's height is a PERCENTAGE, so the
                // tooltip wrapper it sits in has to be a full-height box or the
                // percentage resolves against auto and the bar vanishes.
                className="h-full min-w-0 flex-1 items-end"
              >
                <span
                  className="block w-full self-end rounded-t-sm"
                  style={{
                    height: `${Math.max(2, (p.spend / scale) * 100)}%`,
                    background: p.spend > cap && cap > 0 ? COLORS.warn : color,
                    opacity: 0.9,
                  }}
                />
              </Tooltip>
            ))}
            {cap > 0 && (
              <span
                className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-[var(--foreground)]/60"
                style={{ bottom: `${Math.min(100, (cap / scale) * 100)}%` }}
              >
                <span className="absolute right-0 -translate-y-full bg-[var(--card)] px-1 text-[9px] font-medium tabular-nums text-[var(--muted-foreground)]">
                  cap {fmt(cap)}/day
                </span>
              </span>
            )}
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-[var(--muted-foreground)]">
            <span>{fmtDate(series[0]?.date ?? flightStartIso)}</span>
            <span className="tabular-nums">
              avg {fmt(verdict.avgDaily)}/day across {series.length} finalized day
              {series.length === 1 ? '' : 's'}
            </span>
            <span>{data?.until ? fmtDate(data.until) : ''}</span>
          </div>

          {/* Today so far (§3). Hatched and set apart from the bars on purpose:
              it is a PARTIAL day, it is not compared to the cap, and it feeds no
              average, verdict, projection or total above. Absent in a closed
              month and before the day's first sync — a zero here would read as
              "spent nothing today". */}
          {todaySpend != null && data && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed border-[var(--border)] px-3 py-2">
              <span
                className="h-3 w-6 flex-shrink-0 rounded-sm opacity-60"
                style={{
                  backgroundImage: `repeating-linear-gradient(45deg, ${color} 0 3px, transparent 3px 6px)`,
                }}
              />
              <span className="text-[11px] text-[var(--muted-foreground)]">
                {fmtDate(data.todayIso)} so far
              </span>
              <span className="text-[11px] font-bold tabular-nums text-[var(--foreground)]">
                {fmt(todaySpend)}
              </span>
              <span className="text-[10px] text-[var(--muted-foreground)]">
                partial day — not in the average, the verdict, or any figure above
              </span>
            </div>
          )}

          {/* Live-total cross-check (§3). "~", never "=": today keeps accruing
              after the sync that produced it. This is the number someone sees in
              the Google Ads account, so it exists to make the finalized figures
              above trustworthy rather than look stale. */}
          {liveTotal != null && (
            <div className="mt-1.5 mb-4 text-[10px] text-[var(--muted-foreground)]">
              live total ~
              <span className="font-semibold tabular-nums text-[var(--foreground)]">
                {fmt(liveTotal)}
              </span>{' '}
              ({fmt(line.spentMTD)} through {data?.until ? fmtDate(data.until) : 'the data edge'} +{' '}
              {fmt(todaySpend ?? 0)} today) — approximate, for cross-checking against Google Ads
            </div>
          )}
          {liveTotal == null && <div className="mb-4" />}

          <div
            className="mb-4 rounded-lg px-3.5 py-3 text-[11px] leading-relaxed"
            style={{ background: `${toneColor(v.tone)}14`, color: 'var(--foreground)' }}
          >
            <div className="mb-1 text-[12px] font-bold" style={{ color: toneColor(v.tone) }}>
              {v.title}
              {verdict.ratio != null && (
                <span className="ml-1.5 font-medium tabular-nums opacity-80">
                  {Math.round(verdict.ratio * 100)}% of cap
                </span>
              )}
            </div>
            {v.body}
          </div>

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
              {fmt(cap)} daily — short about {fmt(shortfall.gap)}. Move it to a campaign that can
              absorb it, or accept the miss.
            </div>
          )}

          {/* Where the month lands, two ways (§5). Both are straight-line
              what-ifs and are labelled as such: Google treats the daily as an
              average it paces to its own monthly limit and will spend up to 2× of
              it on a strong day, so neither predicts its actual behaviour. */}
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Where the month lands
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Metric
              label="At recent pace"
              value={projectedRecent != null ? fmt(projectedRecent) : '—'}
              sub={
                pace.avgDaily != null
                  ? `${fmt(pace.avgDaily)}/day × ${line.flight.remaining}d left`
                  : 'not enough delivery yet'
              }
              hint={
                pace.avgDaily == null
                  ? 'Too few days with spend to state a run rate — one busy day would set the projection for the rest of the month. This is what a brand-new or not-yet-launched campaign shows.'
                  : `Where it lands if it keeps behaving as it has: the last ${pace.days} finalized day${pace.days === 1 ? '' : 's'}${pace.rampDaysSkipped > 0 ? `, ignoring ${pace.rampDaysSkipped} day${pace.rampDaysSkipped === 1 ? '' : 's'} of launch ramp` : ''}. A straight line, not a forecast of Google's day-to-day behaviour.`
              }
            />
            <Metric
              label="At current daily"
              value={projectedAtCap != null ? fmt(projectedAtCap) : '—'}
              sub={
                projectedAtCap != null
                  ? `ceiling · ${fmt(line.currentDaily)}/day × ${line.flight.remaining}d`
                  : 'no daily synced'
              }
              hint="A CEILING, not a prediction: what the daily you have set could deliver if the campaign filled it every day. When this sits well above the recent-pace figure, the campaign has budget room it is not using — that is a reallocation question, not a daily-budget one."
            />
            <Metric
              label="Remaining budget"
              value={fmt(line.remainingBudget)}
              sub={`of ${fmt(line.target)} target`}
              hint="Target minus spent. This is also exactly what Move can take out of this campaign — money already spent cannot be given away."
            />
          </div>

          {/* Month-to-date, not the chart window above — the two answer
              different questions and the labels have to say which is which. */}
          <div className="mt-4 mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Month to date
            </span>
            {metrics.asOf && (
              <span className="text-[10px] text-[var(--muted-foreground)]">
                through {fmtDate(metrics.asOf)}
              </span>
            )}
          </div>
          {metrics.neverSynced ? (
            <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-[11px] text-[var(--muted-foreground)]">
              No metrics synced for this campaign yet. Sync from Google to fill these in.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Metric
                label="Conv rate"
                value={metrics.convRate != null ? `${(metrics.convRate * 100).toFixed(2)}%` : '—'}
                sub={
                  metrics.conversions != null
                    ? `${Math.round(metrics.conversions)} conv`
                    : undefined
                }
                hint={
                  metrics.convRate == null
                    ? `Too few conversions this month to state a rate — below ${GOOGLE_CONVERSION_FLOOR}, one more lead swings it wildly. Read it in Google Ads.`
                    : undefined
                }
              />
              <Metric
                label="Cost / conv"
                value={metrics.costPerConversion != null ? fmt(metrics.costPerConversion) : '—'}
                hint={
                  metrics.costPerConversion == null
                    ? `Too few conversions this month to state a cost per conversion — below ${GOOGLE_CONVERSION_FLOOR}, one more lead would move it by hundreds of dollars. Read it in Google Ads.`
                    : undefined
                }
              />
              <Metric
                label="Avg CPC"
                value={metrics.avgCpc != null ? fmt(metrics.avgCpc) : '—'}
                sub={metrics.clicks != null ? `${metrics.clicks} clicks` : undefined}
              />
              <Metric
                label="CTR"
                value={metrics.ctr != null ? `${(metrics.ctr * 100).toFixed(2)}%` : '—'}
                sub={
                  metrics.impressions != null
                    ? `${metrics.impressions.toLocaleString()} impr`
                    : undefined
                }
              />
              <ImpressionShareMetric
                label="Lost IS (budget)"
                state={metrics.budgetLostIs}
                hint="Share of impressions lost because the budget ran out. HIGH means real demand is going unserved — this campaign will absorb more money. Near zero means it is not budget-limited, so raising its daily will not increase spend."
              />
              <ImpressionShareMetric
                label="Lost IS (rank)"
                state={metrics.rankLostIs}
                hint="Share of impressions lost to ad rank. HIGH means bid or Quality Score is the constraint, not budget — more money will just sit unspent. It answers whether budget will help, yes or no; it does NOT tell you whether to fix the bid or the Quality Score."
              />
            </div>
          )}
          <p className="mt-2.5 text-[10px] leading-relaxed text-[var(--muted-foreground)]">
            Reference only. Conversion figures depend on this account’s tracking setup — verify in
            Google Ads before acting on efficiency.
          </p>
        </>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  hint,
  muted = false,
}: {
  label: string;
  value: string;
  sub?: string;
  hint?: string;
  /** Render the value quietly — for "not available", which is a state, not a
   *  figure, and must not sit at the same weight as a real number. */
  muted?: boolean;
}) {
  const body = (
    <div className="h-full rounded-lg bg-[var(--muted)]/40 px-3 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </div>
      <div
        className={
          muted
            ? 'mt-0.5 text-[11px] font-medium leading-tight text-[var(--muted-foreground)]'
            : 'mt-0.5 text-sm font-bold tabular-nums'
        }
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">{sub}</div>}
    </div>
  );
  // A dash with no explanation reads as a bug. When we are deliberately
  // withholding a figure, say why on hover rather than leaving it blank.
  return hint ? (
    <Tooltip label={hint} className="w-full">
      <div className="w-full cursor-help">{body}</div>
    </Tooltip>
  ) : (
    body
  );
}

/**
 * An impression-share tile (§4). Three outcomes, three different sentences —
 * collapsing any of them into "0%" inverts the move decision, because 0% lost to
 * budget means "this campaign cannot absorb more money" while no reading at all
 * means "look at the bars instead".
 */
function ImpressionShareMetric({
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
      <Metric
        label={label}
        value="Not available"
        sub="Search & Shopping only"
        muted
        hint={`${hint}\n\nGoogle does not report search impression share for this campaign type. For Performance Max and Demand Gen, read delivery off the daily bars above instead.`}
      />
    );
  }
  if (state.kind === 'no_data') {
    return (
      <Metric
        label={label}
        value="No data"
        sub="below Google's reporting threshold"
        muted
        hint={`${hint}\n\nGoogle returned no figure this month — usually too little volume to report on yet. This is not the same as zero.`}
      />
    );
  }
  return <Metric label={label} value={impressionShareText(state).text} hint={hint} />;
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
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)]/60 px-3 py-2.5">
      <Tooltip label="The days this campaign is funded for THIS month. Auto-derived from its Google dates — override it when the funding window differs (e.g. the campaign existed on the 1st but wasn't funded until mid-month).">
        <span className="cursor-help text-[11px] font-semibold text-[var(--foreground)]">
          Flight this month
        </span>
      </Tooltip>
      <span className="text-sm font-bold tabular-nums text-[var(--foreground)]">
        {fmtDate(range.start ?? '')} – {fmtDate(range.end ?? '')}
      </span>
      {!readOnly && onChange && (
        <DatePicker
          mode="range"
          value={range}
          onChange={commit}
          // The trigger's default styling is a full bordered input. Our
          // triggerContent is already a bordered icon button, so leaving it on
          // draws a box around a box — pass a bare class to strip it.
          className="inline-flex rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
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
      <span className="ml-auto text-[11px] tabular-nums text-[var(--muted-foreground)]">
        {line.flight.elapsed} of {line.flight.total} flight days in · {line.flight.remaining} left
      </span>
    </div>
  );
}
