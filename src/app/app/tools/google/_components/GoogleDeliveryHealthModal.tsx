'use client';

/**
 * Delivery health for one Google campaign (google-pacing-card spec §7).
 *
 * WHY THIS EXISTS: the pace badge cannot tell the two underspending cases apart.
 * "Behind but delivering its full daily" and "spending half its cap" look
 * identical there and need OPPOSITE actions — raise the cap on the first, move the
 * money away from the second. Distinguishing them is the entire value of this
 * popup, so the verdict is the loudest thing in it.
 *
 * What it deliberately does NOT do: render a performance verdict. Conversion
 * tracking quality varies far too much across these accounts to trust a
 * good/bad call on the card (do-not-change #7), so the metrics are labeled
 * reference and point back to the platform.
 */

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { ArrowPathIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { COLORS } from '@/lib/ad-pacer/constants';
import { fmt, fmtDate } from '@/lib/ad-pacer/helpers';
import {
  deliveryVerdict,
  type AllocatorLine,
  type DeliveryVerdictKind,
} from '@/lib/ad-pacer/google-allocator';
import { Tooltip } from '@/app/app/tools/_shared';
import { CAMPAIGN_COLORS } from './google-pacing-theme';

interface HealthPayload {
  adId: string;
  name: string;
  days: number;
  since: string;
  until: string;
  cap: number;
  series: { date: string; spend: number; dailyBudget: number | null }[];
  metrics: {
    spend: number;
    conversions: number;
    costPerConversion: number | null;
    ctr: number | null;
    clicks: number;
    impressions: number;
  } | null;
  metricsError: string | null;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** The four §7 verdicts, each with the action it implies. Wording matters here:
 *  every one of them has to make the next move obvious without a second read. */
const VERDICTS: Record<
  DeliveryVerdictKind,
  { title: string; body: string; tone: 'over' | 'under' | 'on' }
> = {
  at_cap_ahead: {
    title: 'Spending to cap, ahead of pace',
    body: 'It is using its full daily and running ahead of target, so the recommended daily lowers it to avoid overshooting. If it is performing well, raise its monthly target instead of throttling it back.',
    tone: 'over',
  },
  at_cap: {
    title: 'Delivering to cap',
    body: 'It is spending its full daily budget. If it is behind on the month, that is because the cap is set low — a higher daily will catch it up.',
    tone: 'on',
  },
  room: {
    title: 'Room to spend',
    body: 'It is delivering most of its daily but not all. A modest increase should get absorbed.',
    tone: 'on',
  },
  underdelivering: {
    title: 'Underdelivering',
    body: 'It is spending well under its cap, so it cannot absorb more budget right now — raising its daily will not help. If you need the spend, move it to a campaign that can use it. Check search volume, bids, ad rank and the schedule.',
    tone: 'under',
  },
};

const toneColor = (tone: 'over' | 'under' | 'on') =>
  tone === 'over' ? COLORS.warn : tone === 'under' ? COLORS.lifetime : COLORS.success;

export function GoogleDeliveryHealthModal({
  accountKey,
  period,
  line,
  daysInMonth,
  onClose,
  onFlightChange,
  readOnly = false,
}: {
  accountKey: string;
  period: string;
  line: AllocatorLine;
  daysInMonth: number;
  onClose: () => void;
  /** Manual flight override (§6) — day-of-month bounds within the month in view. */
  onFlightChange?: (startDay: number, endDay: number) => void;
  readOnly?: boolean;
}) {
  const [days, setDays] = useState<7 | 14 | 30>(7);
  const { data, isLoading, error } = useSWR<HealthPayload & { error?: string }>(
    `/api/google-ads-pacer/${encodeURIComponent(accountKey)}/campaign-health?period=${period}&adId=${encodeURIComponent(line.id)}&days=${days}`,
    fetcher,
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const series = data?.series ?? [];
  // The cap the campaign is measured against: its live daily budget. Falls back
  // to the row's own figure so the dashed line still has a place to sit while the
  // fetch is in flight.
  const cap = data?.cap ?? line.currentDaily;
  const verdict = useMemo(
    () => deliveryVerdict(series, cap, days, line.paceStatus),
    [series, cap, days, line.paceStatus],
  );
  const v = VERDICTS[verdict.kind];
  const color = CAMPAIGN_COLORS[line.colorIndex % CAMPAIGN_COLORS.length];

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

  // Chart scale: the taller of the cap and the biggest day, with headroom, so the
  // dashed cap line is always on screen even when nothing came close to it.
  const maxSpend = series.reduce((m, p) => Math.max(m, p.spend), 0);
  const scale = Math.max(cap, maxSpend) * 1.12 || 1;
  const loadError = error || data?.error;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-start justify-center bg-black/50 p-4 backdrop-blur-sm sm:pt-16"
      onClick={onClose}
    >
      <div
        className="glass-modal flex max-h-[88vh] w-full max-w-xl flex-col rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2.5 border-b border-[var(--border)] px-5 py-4">
          <span
            className="mt-1 h-3 w-3 flex-shrink-0 rounded-sm"
            style={{ background: color }}
          />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-bold text-[var(--foreground)]">{line.name}</h3>
            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
              Delivery health
              {data?.until ? ` · data through ${fmtDate(data.until)}` : ''}
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
          {/* §6 flight window — editable, because the funding window sometimes
              differs from Google's literal campaign dates. */}
          <FlightEditor
            line={line}
            daysInMonth={daysInMonth}
            readOnly={readOnly || !onFlightChange}
            onChange={onFlightChange}
          />

          <div className="mt-4 mb-3 inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5">
            {([7, 14, 30] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setDays(n)}
                aria-pressed={days === n}
                className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-colors ${
                  days === n
                    ? 'bg-[var(--primary)] text-white'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {n} days
              </button>
            ))}
          </div>

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
              No synced daily spend yet for this campaign. Sync from Google to build the
              delivery series.
            </div>
          ) : (
            <>
              {/* Bars = actual daily spend; dashed line = the daily cap. A day
                  over the cap is normal on Google (up to 2×), so it is tinted
                  rather than flagged. */}
              <div className="relative flex h-28 items-end gap-[3px]">
                {series.map((p) => (
                  <Tooltip
                    key={p.date}
                    label={`${fmtDate(p.date)} · ${fmt(p.spend)}`}
                    // h-full matters: the bar's height is a PERCENTAGE, so the
                    // tooltip wrapper it sits in has to be a full-height box or
                    // the percentage resolves against auto and the bar vanishes.
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
              <div className="mt-1.5 mb-4 flex justify-between text-[10px] text-[var(--muted-foreground)]">
                <span>{series.length} day{series.length === 1 ? '' : 's'} of data</span>
                <span className="tabular-nums">avg {fmt(verdict.avgDaily)}/day</span>
                <span>{data?.until ? fmtDate(data.until) : 'today'}</span>
              </div>

              <div
                className="mb-4 rounded-lg px-3.5 py-3 text-[11px] leading-relaxed"
                style={{
                  background: `${toneColor(v.tone)}14`,
                  color: 'var(--foreground)',
                }}
              >
                <div
                  className="mb-1 text-[12px] font-bold"
                  style={{ color: toneColor(v.tone) }}
                >
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
                  longer carries (spec do-not-change #6): whether the remaining
                  budget can PHYSICALLY still bill. Google will spend at most ~2×
                  the daily on any one day, so past a point the catch-up rate is
                  arithmetically correct and operationally impossible — that
                  belongs here, next to the delivery picture, not in the number. */}
              {shortfall != null && (
                <div
                  className="mb-4 rounded-lg px-3.5 py-3 text-[11px] leading-relaxed"
                  style={{ background: `${COLORS.error}14`, color: 'var(--foreground)' }}
                >
                  <div className="mb-1 text-[12px] font-bold" style={{ color: COLORS.error }}>
                    Can’t fully recover by {fmtDate(shortfall.endIso)}
                  </div>
                  {fmt(shortfall.remaining)} remains but at most ~{fmt(shortfall.maxBillable)} can
                  still bill over {shortfall.daysLeft} day{shortfall.daysLeft === 1 ? '' : 's'} at 2×
                  the {fmt(cap)} daily — short about {fmt(shortfall.gap)}. Move it to a campaign that
                  can absorb it, or accept the miss.
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="Spend" value={fmt(data?.metrics?.spend ?? verdict.windowSpend)} />
                <Metric
                  label="Conversions"
                  value={
                    data?.metrics ? String(Math.round(data.metrics.conversions)) : '—'
                  }
                />
                <Metric
                  label="Cost / conv"
                  value={
                    data?.metrics?.costPerConversion != null
                      ? fmt(data.metrics.costPerConversion)
                      : '—'
                  }
                />
                <Metric
                  label="CTR"
                  value={data?.metrics?.ctr != null ? `${data.metrics.ctr.toFixed(2)}%` : '—'}
                />
              </div>
              <p className="mt-2.5 text-[10px] leading-relaxed text-[var(--muted-foreground)]">
                {data?.metricsError
                  ? `${data.metricsError} — spend above is from the synced series.`
                  : 'Reference only. Conversion figures depend on this account’s tracking setup — verify in Google Ads before acting on efficiency.'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--muted)]/40 px-3 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}

/**
 * The flight window for the month in view, as day-of-month bounds (§6). Editing
 * writes an OVERRIDE — it never rewrites the Ad Planner's flight dates, which
 * are a different statement (what we planned, vs. what the money actually funds).
 */
function FlightEditor({
  line,
  daysInMonth,
  readOnly,
  onChange,
}: {
  line: AllocatorLine;
  daysInMonth: number;
  readOnly: boolean;
  onChange?: (startDay: number, endDay: number) => void;
}) {
  const [start, setStart] = useState(String(line.flight.startDay));
  const [end, setEnd] = useState(String(line.flight.endDay));

  // Follow the row when it changes underneath (a sync, an undo).
  useEffect(() => {
    setStart(String(line.flight.startDay));
    setEnd(String(line.flight.endDay));
  }, [line.flight.startDay, line.flight.endDay]);

  const commit = () => {
    if (!onChange) return;
    const s = Math.min(Math.max(Number(start) || 1, 1), daysInMonth);
    const e = Math.min(Math.max(Number(end) || daysInMonth, s), daysInMonth);
    setStart(String(s));
    setEnd(String(e));
    if (s !== line.flight.startDay || e !== line.flight.endDay) onChange(s, e);
  };

  const inputClass =
    'w-12 rounded border border-[var(--border)] bg-[var(--input)] px-1 py-1 text-center text-xs font-semibold tabular-nums text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none disabled:opacity-60';

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2.5">
      <Tooltip label="The days this campaign is funded for THIS month. Auto-derived from the campaign's Google dates — override it when the funding window differs (e.g. the campaign existed on the 1st but wasn't funded until mid-month).">
        <span className="text-[11px] font-semibold text-[var(--foreground)]">
          Flight this month
        </span>
      </Tooltip>
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
        <span>day</span>
        <input
          value={start}
          onChange={(e) => setStart(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          disabled={readOnly}
          inputMode="numeric"
          aria-label="Flight start day of month"
          className={inputClass}
        />
        <span>–</span>
        <input
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          disabled={readOnly}
          inputMode="numeric"
          aria-label="Flight end day of month"
          className={inputClass}
        />
      </div>
      <span className="ml-auto text-[10px] tabular-nums text-[var(--muted-foreground)]">
        {line.flight.elapsed} of {line.flight.total} flight days in · {line.flight.remaining} left
      </span>
    </div>
  );
}
