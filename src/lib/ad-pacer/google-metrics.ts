// Delivery-surface metric tiles (delivery/reallocation spec §4). Pure: turns the
// raw counters the sync stored on a Google row into the six figures the expander
// shows, and — the part that actually matters — decides which of them we are
// entitled to state at all.
//
// The whole module is built around one distinction: NULL means "we cannot say",
// zero means "we measured, and it is zero". Collapsing the two is how a card
// starts lying. A campaign type with no impression-share data rendered as 0%
// budget-lost reads as "this campaign is not budget-constrained, don't feed it"
// — the exact opposite of "we have no idea whether it is". Every field below is
// `number | null`, and the UI is expected to render null as an explicit
// unavailable state rather than a zero, a dash-with-a-number, or a blank.

import {
  GOOGLE_AT_CAP_RATIO,
  GOOGLE_BUDGET_LOST_IS_THRESHOLD,
  GOOGLE_CONVERSION_FLOOR,
} from './constants';
import type { PacerAd } from './types';

const num = (v: string | number | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Campaign types that report Search impression share. Google exposes
 * search_budget_lost_impression_share / search_rank_lost_impression_share for
 * Search and Shopping only; PMax, Demand Gen, Video and Display return nothing
 * (Display has its own display_* family, deliberately not wired — see §4).
 *
 * This is checked in ADDITION to the value being present, so the UI can tell
 * "this campaign type never has it" from "this campaign type has it but Google
 * withheld it this month", which are different sentences to write on a tile.
 */
export function supportsSearchImpressionShare(channelType: string | null | undefined): boolean {
  const c = (channelType ?? '').trim().toLowerCase();
  return c === 'search' || c === 'shopping';
}

/** Why an impression-share tile has no number. */
export type ImpressionShareState =
  /** Search/Shopping campaign with a real reading. */
  | { kind: 'value'; value: number; capped: boolean }
  /** PMax / Demand Gen / Video / Display — the metric does not exist here. */
  | { kind: 'unsupported' }
  /** Supported campaign type, but Google returned nothing (usually under its
   *  reporting threshold, or the campaign has not served yet this month). */
  | { kind: 'no_data' };

/**
 * Read one impression-share column into a tile state. `capped` flags Google's
 * ">90%" sentinel: the API reports anything above 0.9 as exactly 0.9, so
 * rendering it as a flat "90%" states a precision the number does not have.
 */
export function impressionShareState(
  raw: string | number | null | undefined,
  channelType: string | null | undefined,
): ImpressionShareState {
  if (!supportsSearchImpressionShare(channelType)) return { kind: 'unsupported' };
  const value = num(raw);
  if (value == null) return { kind: 'no_data' };
  return { kind: 'value', value, capped: value >= 0.9 };
}

/**
 * One impression-share reading as display text. Extracted from the tile so the
 * expander and the Compare grid render the SAME three outcomes the same way —
 * two components formatting this independently is how "Not available" ends up
 * as "0%" on one surface and inverts the move decision there.
 *
 * `muted` marks the two non-figures: they are states, not measurements, and must
 * not carry the visual weight of a real number.
 */
export function impressionShareText(state: ImpressionShareState): {
  text: string;
  muted: boolean;
} {
  if (state.kind === 'unsupported') return { text: 'Not available', muted: true };
  if (state.kind === 'no_data') return { text: 'No data', muted: true };
  // Google reports anything above 90% as exactly 0.9, so a flat "90%" would
  // claim a precision the number does not have.
  return {
    text: state.capped ? '≥90%' : `${(state.value * 100).toFixed(0)}%`,
    muted: false,
  };
}

export interface CampaignMetrics {
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  /** Conversions ÷ interactions, as a fraction. Null below the floor. */
  convRate: number | null;
  /** Spend ÷ conversions. Null below the floor. */
  costPerConversion: number | null;
  /** Clicks ÷ impressions, as a fraction. */
  ctr: number | null;
  /** Spend ÷ clicks. */
  avgCpc: number | null;
  budgetLostIs: ImpressionShareState;
  rankLostIs: ImpressionShareState;
  /** Last day the figures cover (YYYY-MM-DD) — the tiles' own as-of stamp. */
  asOf: string | null;
  /** No metrics have ever synced for this row (never imported, or synced before
   *  the metric columns existed). The panel says so instead of rendering six
   *  dashes, which look like six measured zeros. */
  neverSynced: boolean;
}

/**
 * Derive the tile figures for one Google row.
 *
 * `spentMTD` is passed in rather than read off the ad because it is already
 * resolved on the allocator line, and the cost-based ratios have to use the SAME
 * spend number the panel prints above them — deriving cost/conv from a second
 * source is how a tile ends up disagreeing with the figure two inches away.
 *
 * Cost/conv, CTR and avg CPC are computed here rather than trusted from Google's
 * own equivalent fields: Google's cost_per_conversion is blank at zero
 * conversions, and a blank next to a real spend figure reads as "free". Conv
 * rate is the one exception — it needs interactions, which are not clicks on
 * every campaign type and which we do not pull.
 */
export function campaignMetrics(
  ad: PacerAd | undefined,
  spentMTD: number,
): CampaignMetrics {
  const impressions = num(ad?.googleImpressions ?? null);
  const clicks = num(ad?.googleClicks ?? null);
  const conversions = num(ad?.googleConversions ?? null);
  const asOf = ad?.googleMetricsAsOf ?? null;

  // Every counter absent AND no stamp = the sync has never written metrics for
  // this row. A synced row with genuinely no delivery has a stamp and zeros.
  const neverSynced =
    asOf == null && impressions == null && clicks == null && conversions == null;

  // The conversion floor. Below it we hold BOTH conversion-derived figures, not
  // just cost/conv: a conversion rate off one conversion is the same noise
  // wearing a percent sign.
  const enoughConversions = conversions != null && conversions >= GOOGLE_CONVERSION_FLOOR;

  return {
    impressions,
    clicks,
    conversions,
    convRate: enoughConversions ? num(ad?.googleConvRate ?? null) : null,
    costPerConversion:
      enoughConversions && conversions > 0 ? spentMTD / conversions : null,
    ctr: impressions != null && impressions > 0 && clicks != null ? clicks / impressions : null,
    avgCpc: clicks != null && clicks > 0 ? spentMTD / clicks : null,
    budgetLostIs: impressionShareState(
      ad?.googleSearchBudgetLostIs ?? null,
      ad?.googleChannelType ?? null,
    ),
    rankLostIs: impressionShareState(
      ad?.googleSearchRankLostIs ?? null,
      ad?.googleChannelType ?? null,
    ),
    asOf,
    neverSynced,
  };
}

// ── §8 capped / headroom ──

/** How the at-cap call was reached — the tooltip has to say which, because the
 *  two carry different confidence. */
export type CapDeliveryBasis =
  /** Google's own lost-impression-share reading. Ground truth. */
  | 'budget_lost_is'
  /** Recent daily bars sitting at the cap. A heuristic, used where Google
   *  reports no impression share (PMax, Demand Gen, Display). */
  | 'bars'
  /** Nothing to judge on — no cap set, or no delivery history yet. */
  | 'unknown';

/**
 * Is this recommendation a raise the campaign cannot act on (§14)?
 *
 * The recommended daily is stateless arithmetic — (target − spent) ÷ days left —
 * so it happily tells a campaign to spend $63/day when that campaign has been
 * unable to spend the $47/day it already had. Pushing that number changes
 * nothing except the number: the constraint is demand, not budget. The money is
 * only recoverable by moving it somewhere that can spend it.
 *
 * This is a MECHANICAL spendability read, not a performance verdict (invariant
 * 9): it says the campaign is not filling the cap it already has, and says
 * nothing about whether its traffic is any good. It never blocks the push — the
 * person may be raising it for a reason the tool cannot see, like a promotion
 * starting tomorrow.
 */
export function isFutileRaise(input: {
  currentDaily: number;
  recommendedDaily: number;
  delivery: CapDelivery;
}): boolean {
  // Only a RAISE can be futile. A cut always takes effect, and is exactly what
  // frees money for the campaigns that can spend it.
  if (input.currentDaily <= 0) return false;
  if (input.recommendedDaily <= input.currentDaily) return false;
  // 'unknown' basis = no impression share AND no finalized bars to read. With no
  // evidence either way, say nothing rather than guess at the campaign's ceiling.
  if (input.delivery.basis === 'unknown') return false;
  return !input.delivery.atCap;
}

export interface CapDelivery {
  /** Is this campaign genuinely filling its daily budget? */
  atCap: boolean;
  basis: CapDeliveryBasis;
  /** Fraction of impressions lost to budget, when that's the basis. */
  budgetLostIs: number | null;
  /** Recent avg daily ÷ cap, when bars are the basis. */
  ratio: number | null;
}

/**
 * Is the campaign actually delivering to its cap (§8)?
 *
 * THE BUG THIS FIXES: the capped/headroom tag fired on Google's
 * `BUDGET_CONSTRAINED` primary-status reason alone. That flag is looser than it
 * reads — it fired on a campaign averaging ~$37–47/day against a $64 cap — so a
 * demand-limited campaign wore a badge claiming it "spends its full daily every
 * day", and the obvious next move (give it more money) was the exact wrong one.
 * The money would have sat unspent.
 *
 * Two paths, by what Google will actually tell us:
 *
 *  - **Search / Shopping** report lost impression share, so the flag has to be
 *    corroborated by real budget-lost IS. High = demand exists that the budget
 *    is turning away. Near zero = not budget-limited, whatever the flag says,
 *    and the tag comes off regardless of how the campaign is pacing against
 *    target. Pace-vs-target is a different axis and never decides this one.
 *  - **PMax / Demand Gen / Display** report none, so fall back to the bars: is
 *    recent daily spend actually sitting at the cap? Weaker evidence, hence the
 *    separate basis, but it beats trusting the flag alone.
 *
 * `series` is the row's recent daily spend; anything after `dataEdgeIso` is
 * dropped, because today is partial and would drag the average down and read as
 * a campaign that just stopped delivering.
 */
export function capDelivery(input: {
  budgetConstrained: boolean;
  channelType: string | null | undefined;
  budgetLostIsRaw: string | number | null | undefined;
  series: readonly { date: string; spend: number }[] | undefined;
  cap: number;
  dataEdgeIso: string | null;
}): CapDelivery {
  const is = impressionShareState(input.budgetLostIsRaw, input.channelType);
  if (is.kind === 'value') {
    return {
      // BOTH signals, deliberately: Google flags more campaigns than are truly
      // budget-limited, and lost impression share is what separates "the budget
      // ran out" from "Google thinks the budget might matter".
      atCap: input.budgetConstrained && is.value >= GOOGLE_BUDGET_LOST_IS_THRESHOLD,
      basis: 'budget_lost_is',
      budgetLostIs: is.value,
      ratio: null,
    };
  }

  // No impression share to corroborate with — read the delivery itself.
  const finalized = (input.series ?? []).filter(
    (p) => input.dataEdgeIso == null || p.date <= input.dataEdgeIso,
  );
  if (input.cap <= 0 || finalized.length === 0) {
    return { atCap: false, basis: 'unknown', budgetLostIs: null, ratio: null };
  }
  const avg = finalized.reduce((s, p) => s + (Number(p.spend) || 0), 0) / finalized.length;
  const ratio = avg / input.cap;
  return {
    atCap: ratio >= GOOGLE_AT_CAP_RATIO,
    basis: 'bars',
    budgetLostIs: null,
    ratio,
  };
}
