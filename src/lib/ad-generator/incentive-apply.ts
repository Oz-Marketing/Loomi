import type { AdData } from './types';
import type { MarketCheckIncentive } from '@/lib/integrations/marketcheck';

/**
 * MarketCheck incentive → structured offer fields.
 *
 * THE single transform from an OEM incentive to the `AdData` patch that fills a
 * creative's offer. Extracted from the OEM Incentives panel so the interactive
 * generator and the (headless) automation worker fill an ad the SAME way — if
 * this drifts, an auto-generated ad stops matching the one a designer would
 * have built by hand from the same offer.
 *
 * Pure: no React, no network, no `process.env`. The vehicle IMAGE is deliberately
 * not resolved here — that's an async EVOX call the caller layers on top (the
 * panel does it inline; the worker does it in the orchestrator).
 */

/** `'' ` = the only / first offer slot; `'o2_'` = a dual template's second offer. */
export type OfferSlot = '' | 'o2_';

export interface IncentivePatchContext {
  /** The searched vehicle — the incentive feed doesn't echo it back reliably. */
  year: string | number;
  make: string;
  model: string;
  /** Search ZIP, persisted so reopening the ad restores the same search. */
  zip?: string;
  /** Which offer the patch fills. Defaults to the first slot. */
  slot?: OfferSlot;
  /**
   * Don't write the vehicle fields. Set for a dual template whose second offer
   * rides the first offer's vehicle ("One model"), where overwriting would
   * clobber offer 1's selection.
   */
  skipVehicle?: boolean;
}

/**
 * Stable identity for an incentive, for selection highlighting + "which card did
 * we apply". MarketCheck rows often lack an `id`, so we fall back to the offer
 * prose.
 *
 * NOTE: this is a UI/selection key, NOT a change-detection fingerprint. Offer
 * prose wobbles between feed refreshes, so diffing on it would report phantom
 * "new offers"; a fingerprint must hash the STRUCTURED fields instead.
 */
export function incentiveKey(inc: MarketCheckIncentive): string {
  return inc.id || `${inc.type}:${inc.offerDetails || inc.description || ''}`;
}

/**
 * Cost per $1,000 financed — the standard amortization, matching Oz Dealer
 * Tools' auto-calc. 0% APR degrades to the simple principal/term case.
 * Returns null when the term is missing (nothing to amortize over).
 */
export function costPerThousand(rate: number, term: number): string | null {
  if (!(term > 0)) return null;
  const r = rate / 100 / 12;
  const cpt = r > 0 ? (r / (1 - Math.pow(1 + r, -term))) * 1000 : 1000 / term;
  return cpt.toFixed(2);
}

/** MarketCheck's incentive type → the generator's `offerType`. */
export function offerTypeFor(type: MarketCheckIncentive['type']): string {
  switch (type) {
    case 'lease':
      return 'lease';
    case 'apr':
      return 'apr';
    case 'cash':
      return 'discount';
    default:
      // Misc / unrecognized programs → free-text custom offer.
      return 'custom';
  }
}

/**
 * Build the `AdData` patch that applies `inc` to an ad.
 *
 * Keys are prefixed by `ctx.slot` where the field is per-offer (offer numbers,
 * vehicle); genuinely shared keys (`expiration`, the OEM disclaimer, the
 * persisted search) stay unprefixed — the same split the panel has always used.
 *
 * The caller decides precedence: `expiration` is emitted whenever the offer has
 * an end date, and the generator keeps a manually-entered expiration over it
 * (see OfferCard's `onApply`).
 */
export function incentiveToFieldPatch(
  inc: MarketCheckIncentive,
  ctx: IncentivePatchContext,
): AdData {
  const p = ctx.slot ?? '';
  const patch: AdData = {};

  // ── the offer itself ──
  patch[`${p}offerType`] = offerTypeFor(inc.type);
  if (inc.type === 'lease') {
    if (inc.payment) patch[`${p}monthlyPayment`] = String(Math.round(inc.payment));
    if (inc.term) patch[`${p}leaseTerm`] = String(inc.term);
    if (inc.downPayment) patch[`${p}dueAtSigning`] = String(Math.round(inc.downPayment));
  } else if (inc.type === 'apr') {
    patch[`${p}aprRate`] = String(inc.rate);
    if (inc.term) patch[`${p}aprTerm`] = String(inc.term);
    const cpt = costPerThousand(inc.rate, inc.term);
    if (cpt) patch[`${p}costPerThousand`] = cpt;
  } else if (inc.type === 'cash') {
    if (inc.amount) patch[`${p}discountAmount`] = String(Math.round(inc.amount));
  }
  if (inc.msrp) patch[`${p}msrp`] = String(Math.round(inc.msrp));

  // ── expiration (shared across offer slots) ──
  if (inc.endDate) {
    const d = new Date(inc.endDate);
    if (!Number.isNaN(d.getTime())) patch.expiration = d.toISOString().slice(0, 10);
  }

  // ── disclaimer ──
  // The OEM offer's own fine print is authoritative, so it's carried through and
  // used VERBATIM (see composeDisclaimer's `rawBody`). `_oemDisclaimer` changes
  // per apply so a fresh selection re-takes over a template-composed disclaimer;
  // empty eligibility text leaves the composed one in place.
  patch._oemDisclaimer = incentiveKey(inc);
  patch._oemDisclaimerText = inc.eligibility?.trim() || '';

  // ── vehicle ──
  // We already know it from the search, so fill it rather than making the user
  // retype. The structured `_veh*` stash sharpens the EVOX image match and seeds
  // the color picker; the trim comes from the incentive row.
  if (!ctx.skipVehicle && (ctx.make || ctx.model)) {
    const year = ctx.year ? String(ctx.year) : '';
    patch[`${p}vehicleName`] = [year, ctx.make, ctx.model, inc.trim].filter(Boolean).join(' ');
    patch[`${p}_vehYear`] = year;
    patch[`${p}_vehMake`] = ctx.make || '';
    patch[`${p}_vehModel`] = ctx.model || '';
    if (inc.trim) patch[`${p}_vehTrim`] = inc.trim;
  }

  // Explicit marker that an OEM incentive was applied. The offer card gates the
  // vehicle-color picker on this, so a fresh creative's template defaults (which
  // look like a real offer) never surface it.
  patch[`${p}_oemApplied`] = '1';

  // Persist the search so reopening the ad restores the list + highlight.
  patch._oemSelectedKey = incentiveKey(inc);
  patch._oemZip = ctx.zip ?? '';

  return patch;
}
