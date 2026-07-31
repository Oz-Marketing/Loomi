import type { MarketCheckIncentive } from '@/lib/integrations/marketcheck';
import { normalizeEndDate } from './fingerprint';

/**
 * Offer timing — when a programme is usable, and whether an OEM has published
 * the next cycle yet.
 *
 * WHY THIS EXISTS. Measured against the live feed on 2026-07-28: every Mazda
 * programme ended 07/31, every Chevrolet programme ended 08/03, while Honda ran
 * to 09/08. A blanket "must have ≥7 days left" gate therefore rejected 100% of
 * Mazda and Chevrolet offers and produced ZERO ads — during the exact week a
 * dealer needs next month's creative prepared.
 *
 * Two conclusions, both implemented here:
 *
 *  1. The question is not "how long is left from today" but "is this offer still
 *     valid when the ad actually RUNS". Those differ by weeks when you're
 *     preparing next month's flight, and only the second one is meaningful.
 *
 *  2. "Everything expires and nothing new is published" is a real, nameable
 *     state that deserves to be reported — not silently rendered as zero output.
 *     Silence is indistinguishable from a broken integration.
 *
 * Deliberately NOT here: a hardcoded per-make lead-time table. Three observed
 * OEMs is not a model, it's an anecdote. {@link observedLeadDays} measures lead
 * time from accumulated snapshot history instead, which is precisely what
 * shadow mode is for.
 */

/** Milliseconds per day. */
const DAY = 86_400_000;

/** The period an ad is being prepared for. */
export interface RunWindow {
  /** First day the ad would run. */
  start: Date;
  /** Last day the ad would run. */
  end: Date;
}

/**
 * The calendar month containing `date`, as a run window. The common case: on
 * 28 July you are preparing August.
 */
export function monthWindow(date: Date): RunWindow {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m, 1)),
    end: new Date(Date.UTC(y, m + 1, 0)), // day 0 of next month = last day of this
  };
}

/** The month AFTER the one containing `date` — what you prepare at month end. */
export function nextMonthWindow(date: Date): RunWindow {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m + 1, 1)),
    end: new Date(Date.UTC(y, m + 2, 0)),
  };
}

/** An explicit window from today for `days` days — for always-on evergreen ads. */
export function rollingWindow(date: Date, days: number): RunWindow {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return { start, end: new Date(start.getTime() + days * DAY) };
}

/** Offer end date as a Date, or null when the feed gave none/unparseable. */
export function offerEndsAt(inc: MarketCheckIncentive): Date | null {
  const iso = normalizeEndDate(inc.endDate);
  if (!iso) return null;
  const d = new Date(`${iso}T23:59:59Z`); // an offer is good THROUGH its end date
  return Number.isNaN(d.getTime()) ? null : d;
}

export type OfferWindowFit =
  /** Valid for the whole run window. */
  | 'covers'
  /** Valid at the start of the window but expires partway through. */
  | 'partial'
  /** Already over before the window even begins. */
  | 'expired'
  /** No end date — treated as open-ended, which is how the feed means it. */
  | 'undated';

/** How a single offer fits the window an ad would run in. */
export function fitToWindow(inc: MarketCheckIncentive, window: RunWindow): OfferWindowFit {
  const ends = offerEndsAt(inc);
  if (!ends) return 'undated';
  if (ends.getTime() < window.start.getTime()) return 'expired';
  if (ends.getTime() < window.end.getTime()) return 'partial';
  return 'covers';
}

export type OfferCycleState =
  /** The OEM published nothing at all for this vehicle. */
  | 'none'
  /** At least one offer covers the whole run window. Normal, healthy. */
  | 'current'
  /** Offers reach into the window but expire inside it. Usable with a caveat. */
  | 'partial'
  /**
   * THE MONTH-BOUNDARY CASE. Programmes exist but every one expires before the
   * window opens — the current cycle is ending and the OEM hasn't published the
   * next one. Not an error and not "no offers": a wait state that should be
   * reported and re-polled, never silently treated as zero.
   */
  | 'expiring_unrenewed'
  /** Offers exist but carry no end dates, so timing can't be reasoned about. */
  | 'undated';

export interface OfferCycleReport {
  state: OfferCycleState;
  window: RunWindow;
  total: number;
  counts: Record<OfferWindowFit, number>;
  /** Offers usable for this window (covers + partial + undated). */
  usable: MarketCheckIncentive[];
  /** Latest end date across all offers — when the current cycle actually runs out. */
  latestEnd: Date | null;
  /** Human summary for the run log / dashboard. */
  summary: string;
}

/** Classify a vehicle's whole offer set against the window an ad would run in. */
export function evaluateOfferCycle(
  incentives: MarketCheckIncentive[],
  window: RunWindow,
): OfferCycleReport {
  const counts: Record<OfferWindowFit, number> = { covers: 0, partial: 0, expired: 0, undated: 0 };
  const usable: MarketCheckIncentive[] = [];
  let latestEnd: Date | null = null;

  for (const inc of incentives) {
    const fit = fitToWindow(inc, window);
    counts[fit]++;
    if (fit !== 'expired') usable.push(inc);
    const ends = offerEndsAt(inc);
    if (ends && (!latestEnd || ends > latestEnd)) latestEnd = ends;
  }

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const range = `${fmt(window.start)}→${fmt(window.end)}`;

  let state: OfferCycleState;
  let summary: string;
  if (incentives.length === 0) {
    state = 'none';
    summary = 'No programmes published for this vehicle.';
  } else if (counts.covers > 0) {
    state = 'current';
    summary = `${counts.covers} programme(s) cover ${range}.`;
  } else if (counts.partial > 0) {
    state = 'partial';
    summary = `${counts.partial} programme(s) reach ${range} but expire inside it${
      latestEnd ? ` (last ends ${fmt(latestEnd)})` : ''
    }.`;
  } else if (counts.undated > 0) {
    state = 'undated';
    summary = `${counts.undated} programme(s) carry no end date.`;
  } else {
    state = 'expiring_unrenewed';
    summary = `All ${incentives.length} programme(s) expire before ${fmt(window.start)}${
      latestEnd ? ` (last ends ${fmt(latestEnd)})` : ''
    } — the OEM has not published the next cycle yet.`;
  }

  return { state, window, total: incentives.length, counts, usable, latestEnd, summary };
}

/** True for states where waiting and re-polling is the right move, rather than
 *  treating the vehicle as having no offers. */
export function shouldRepoll(state: OfferCycleState): boolean {
  return state === 'expiring_unrenewed';
}

/**
 * Measured publication lead time for an OEM, in days: how far ahead of a
 * programme's end date we first saw it. Fed by accumulated snapshot history, so
 * after a few weeks of shadow mode each make has a real number instead of the
 * guess we'd otherwise hardcode.
 *
 * Returns null until there's anything to measure.
 */
export function observedLeadDays(
  samples: { firstSeenAt: Date; endDate: string | null }[],
): { median: number; min: number; max: number; n: number } | null {
  const spans: number[] = [];
  for (const s of samples) {
    const iso = normalizeEndDate(s.endDate);
    if (!iso) continue;
    const end = new Date(`${iso}T23:59:59Z`).getTime();
    const days = Math.round((end - s.firstSeenAt.getTime()) / DAY);
    if (Number.isFinite(days) && days >= 0) spans.push(days);
  }
  if (spans.length === 0) return null;
  spans.sort((a, b) => a - b);
  const mid = Math.floor(spans.length / 2);
  const median = spans.length % 2 ? spans[mid] : Math.round((spans[mid - 1] + spans[mid]) / 2);
  return { median, min: spans[0], max: spans[spans.length - 1], n: spans.length };
}
