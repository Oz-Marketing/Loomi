import type { MarketCheckIncentive } from '@/lib/integrations/marketcheck';
import { incentiveKey } from '../incentive-apply';
import { normalizeEndDate } from './fingerprint';
import { fitToWindow, type RunWindow } from './offer-timing';

/**
 * Deterministic offer selection.
 *
 * MarketCheck can return dozens of programs for one vehicle — lease, APR, cash,
 * trim-specific and regional variants. Something has to choose, and unattended
 * that something can't be a human or a model: when a dealer asks "why did it run
 * the Forester lease and not the Outback APR", the answer has to be a rule you
 * can point at. So this is a plain, inspectable sort, and every candidate keeps
 * the reason it was ranked or rejected.
 *
 * Pure — no DB, no clock of its own (pass `now`), no network.
 */

export type SelectableOfferType = 'lease' | 'apr' | 'cash';

/** Default priority: a monthly payment is the strongest retail hook, then a rate,
 *  then cash. Overridable per sub-account. */
export const DEFAULT_OFFER_TYPE_PRIORITY: SelectableOfferType[] = ['lease', 'apr', 'cash'];

export interface SelectOfferPolicy {
  /** Offer types to consider, best first. Types omitted here are not eligible. */
  priority?: SelectableOfferType[];
  /**
   * PREFERRED. The period the ad would actually run. An offer is eligible when
   * it's still valid at the START of this window — the honest test, because the
   * ad runs then, not now.
   *
   * This exists because the naive alternative below silently produced zero ads:
   * polling on 2026-07-28, every Mazda and Chevrolet programme ended within a
   * week, so a fixed `minDaysRemaining: 7` rejected all of them even though they
   * were exactly the programmes August's ads should be built from. Supplying a
   * window makes that judgement explicit instead of accidental.
   *
   * When set, `minDaysRemaining` is ignored.
   */
  runWindow?: RunWindow;
  /**
   * Fallback when no `runWindow` is given: reject offers ending within this many
   * days of `now`. 0 disables the check. Fine for "publish something today";
   * misleading for month-boundary planning — prefer `runWindow` there.
   */
  minDaysRemaining?: number;
  /** Evaluation time. Injected so runs are reproducible in tests + replays. */
  now?: Date;
}

export type RejectionReason =
  | 'type_not_eligible'
  | 'no_usable_numbers'
  | 'expired'
  | 'expiring_soon';

export interface OfferCandidate {
  incentive: MarketCheckIncentive;
  key: string;
  /** Null when the candidate was rejected. Lower sorts earlier. */
  rank: number | null;
  rejected: RejectionReason | null;
  /** Plain-language justification, for the run log and the review UI. */
  reason: string;
}

export interface SelectOfferResult {
  /** The winner, or null when nothing was eligible. */
  chosen: OfferCandidate | null;
  /** Every candidate, eligible first (by rank) then rejected — the audit trail. */
  candidates: OfferCandidate[];
}

/** Days from `now` until `endDate`; null when there's no parseable end date.
 *  Routed through `normalizeEndDate` because the feed mixes ISO (`2026-09-08`)
 *  and US (`07/31/2026`) formats — parsing the raw string would be
 *  locale-dependent for the latter. */
export function daysUntil(endDate: string | null, now: Date): number | null {
  const iso = normalizeEndDate(endDate);
  if (!iso) return null;
  const end = new Date(`${iso}T23:59:59Z`);
  if (Number.isNaN(end.getTime())) return null;
  return Math.floor((end.getTime() - now.getTime()) / 86_400_000);
}

/**
 * Does this offer carry the numbers its own type needs to render? A lease with
 * no payment or an APR with no term produces an ad with a hole in it, so it's
 * never a candidate — better to run nothing than to run that.
 */
export function hasUsableNumbers(inc: MarketCheckIncentive): boolean {
  switch (inc.type) {
    case 'lease':
      return inc.payment > 0 && inc.term > 0;
    // A 0% rate is the headline offer, not a missing value — so `rate` is allowed
    // to be zero and only the term is actually required.
    case 'apr':
      return inc.term > 0;
    case 'cash':
      return inc.amount > 0;
    default:
      return false;
  }
}

/**
 * Score within an offer type — lower is better, so the strongest retail offer
 * wins: cheapest lease payment, lowest finance rate, biggest cash amount.
 */
function withinTypeScore(inc: MarketCheckIncentive): number {
  switch (inc.type) {
    case 'lease':
      return inc.payment;
    case 'apr':
      // Tie-break equal rates by preferring the longer term (lower payment).
      return inc.rate * 1000 - inc.term;
    case 'cash':
      return -inc.amount;
    default:
      return Number.MAX_SAFE_INTEGER;
  }
}

function describe(inc: MarketCheckIncentive): string {
  switch (inc.type) {
    case 'lease':
      return `$${Math.round(inc.payment).toLocaleString()}/mo for ${inc.term} months`;
    case 'apr':
      return `${inc.rate}% APR for ${inc.term} months`;
    case 'cash':
      return `$${Math.round(inc.amount).toLocaleString()} cash`;
    default:
      return inc.description || 'offer';
  }
}

/**
 * Rank every incentive, then pick the top one. Rejected candidates are retained
 * with their reason so a run log can explain what was passed over and why.
 */
export function selectOffer(
  incentives: MarketCheckIncentive[],
  policy: SelectOfferPolicy = {},
): SelectOfferResult {
  const priority = policy.priority?.length ? policy.priority : DEFAULT_OFFER_TYPE_PRIORITY;
  const minDays = policy.minDaysRemaining ?? 0;
  const now = policy.now ?? new Date();

  const candidates: OfferCandidate[] = incentives.map((inc) => {
    const key = incentiveKey(inc);
    const typeIndex = priority.indexOf(inc.type as SelectableOfferType);

    if (typeIndex < 0) {
      return {
        incentive: inc,
        key,
        rank: null,
        rejected: 'type_not_eligible',
        reason: `${inc.type} offers are not enabled for this sub-account.`,
      };
    }
    if (!hasUsableNumbers(inc)) {
      return {
        incentive: inc,
        key,
        rank: null,
        rejected: 'no_usable_numbers',
        reason: `The feed gave no usable numbers for this ${inc.type} program.`,
      };
    }
    const remaining = daysUntil(inc.endDate, now);
    if (policy.runWindow) {
      // Window mode: the only question is whether the offer survives to the day
      // the ad starts running.
      if (fitToWindow(inc, policy.runWindow) === 'expired') {
        return {
          incentive: inc,
          key,
          rank: null,
          rejected: 'expired',
          reason: `Ends before the run window opens on ${policy.runWindow.start
            .toISOString()
            .slice(0, 10)}.`,
        };
      }
    } else {
      if (remaining !== null && remaining < 0) {
        return {
          incentive: inc,
          key,
          rank: null,
          rejected: 'expired',
          reason: `Ended ${Math.abs(remaining)} day(s) ago.`,
        };
      }
      if (minDays > 0 && remaining !== null && remaining < minDays) {
        return {
          incentive: inc,
          key,
          rank: null,
          rejected: 'expiring_soon',
          reason: `Ends in ${remaining} day(s) — under the ${minDays}-day minimum.`,
        };
      }
    }

    // Rank: offer type dominates, best-in-type breaks the tie. The type term is
    // scaled far beyond any within-type score so priority is never outvoted.
    const rank = typeIndex * 1_000_000 + withinTypeScore(inc);
    return {
      incentive: inc,
      key,
      rank,
      rejected: null,
      reason: `${describe(inc)} — ${inc.type} is priority ${typeIndex + 1} of ${priority.length}.`,
    };
  });

  const eligible = candidates
    .filter((c) => c.rank !== null)
    .sort((a, b) => (a.rank as number) - (b.rank as number));
  const rejected = candidates.filter((c) => c.rank === null);

  return {
    chosen: eligible[0] ?? null,
    candidates: [...eligible, ...rejected],
  };
}
