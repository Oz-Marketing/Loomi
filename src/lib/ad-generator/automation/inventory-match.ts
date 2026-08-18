import type { AdData } from '../types';

/**
 * Matching an OEM offer to actual on-lot inventory.
 *
 * Two jobs, both of which turn "can't automate this" into "can":
 *
 *  1. STOCK GATING — don't advertise a model the dealer doesn't have. Measured
 *     against real feeds, 73% of on-lot Chevrolet groups had an advertisable
 *     offer; the inverse case (an offer for a model with no units) is the one
 *     that creates a bait-and-switch exposure.
 *
 *  2. VIN INJECTION — several OEM rules require a VIN or stock number in the
 *     disclaimer. Before inventory existed those makes could not be automated at
 *     all: preflight would fail them forever. Pulling a real in-stock unit
 *     satisfies the rule with a car that actually exists.
 *
 * Selection is DETERMINISTIC. The chosen VIN ends up printed on the ad, and the
 * generate job is re-runnable — a retry that picked a different unit would
 * silently change an approved draft's fine print.
 *
 * Pure: no DB, no network.
 */

export interface StockUnit {
  vin: string;
  stockNumber: string | null;
  trim: string | null;
  price: number | null;
  msrp: number | null;
  color: string | null;
  colorDetail: string | null;
  imageUrls: string[];
}

export type StockGateVerdict = 'ok' | 'below_minimum' | 'no_stock' | 'not_enforced';

export interface StockGateResult {
  verdict: StockGateVerdict;
  count: number;
  minStock: number;
  reason: string;
}

/**
 * Should we advertise this vehicle given its on-lot count?
 *
 * `minStock: 0` means "don't consider stock at all" — the Phase 1 default, where
 * inventory was observed but not enforced. That has to stay available: a dealer
 * with no feed configured would otherwise be gated to zero ads.
 */
export function stockGate(count: number, minStock: number): StockGateResult {
  if (minStock <= 0) {
    return { verdict: 'not_enforced', count, minStock, reason: 'Stock gating is off for this account.' };
  }
  if (count <= 0) {
    return { verdict: 'no_stock', count, minStock, reason: 'No units of this vehicle are on the lot.' };
  }
  if (count < minStock) {
    return {
      verdict: 'below_minimum',
      count,
      minStock,
      reason: `Only ${count} on the lot, below the ${minStock}-unit minimum.`,
    };
  }
  return { verdict: 'ok', count, minStock, reason: `${count} on the lot.` };
}

/** True when the offer may proceed. */
export function stockGatePassed(r: StockGateResult): boolean {
  return r.verdict === 'ok' || r.verdict === 'not_enforced';
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/**
 * Pick the unit to advertise.
 *
 * Ranked: exact trim match, then a partial trim match, then any unit; within a
 * tier, prefer one that has photos (so the ad can fall back to a real vehicle
 * image), then the lowest advertised price — the most defensible thing to put in
 * an ad — and finally VIN, purely to make the order total.
 *
 * That last key is not cosmetic: without it two units with identical price sort
 * arbitrarily, and a re-run could swap the VIN printed on an already-approved
 * draft.
 */
export function pickStockUnit(units: StockUnit[], offerTrim?: string | null): StockUnit | null {
  if (units.length === 0) return null;
  const want = norm(offerTrim);

  const tier = (u: StockUnit): number => {
    if (!want) return 1; // no trim to match on — everything is equally suitable
    const t = norm(u.trim);
    if (!t) return 2;
    if (t === want) return 0;
    if (t.includes(want) || want.includes(t)) return 1;
    return 2;
  };

  return [...units].sort((a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;
    const pa = a.imageUrls.length > 0 ? 0 : 1;
    const pb = b.imageUrls.length > 0 ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const priceA = a.price ?? Number.MAX_SAFE_INTEGER;
    const priceB = b.price ?? Number.MAX_SAFE_INTEGER;
    if (priceA !== priceB) return priceA - priceB;
    return a.vin.localeCompare(b.vin);
  })[0];
}

/**
 * The ad-data patch that carries a specific unit onto the creative.
 *
 * Only fills what the unit genuinely evidences. Notably it does NOT overwrite an
 * MSRP that the OEM offer already supplied: the programme's MSRP is the figure
 * the offer's maths was built on, and replacing it with this unit's sticker would
 * make the advertised discount arithmetically wrong.
 */
export function stockUnitPatch(unit: StockUnit, existing: AdData = {}): AdData {
  const patch: AdData = {
    vin: unit.vin,
  };
  if (unit.stockNumber) patch.stockNumber = unit.stockNumber;
  // Fill MSRP only when the offer didn't provide one.
  if (unit.msrp && !(existing.msrp ?? '').trim()) patch.msrp = String(Math.round(unit.msrp));
  return patch;
}

/** `dealer_photo` was removed deliberately — see chooseVehicleImage. Keeping it
 *  in the union would imply a path that no longer exists. */
export type ImageSource = 'evox' | 'none';

export interface ImageChoice {
  source: ImageSource;
  url: string | null;
  reason: string;
}

/**
 * Choose the vehicle image, given whichever sources resolved.
 *
 * EVOX first: a jellybean is a clean studio cut-out on transparency, which
 * composites into a layout far better than a photo of a car on a lot.
 *
 * The dealer photo is the fallback that matters, though — EVOX coverage is
 * per-MODEL and partial (Honda CR-V resolves, Accord and Civic 404 at every
 * year), whereas every new unit in the Young feeds carries real photos. So the
 * models EVOX can't serve are exactly the ones inventory rescues.
 */
/**
 * EVOX jellybeans ONLY — dealer feed photos are never used.
 *
 * The fallback used to reach for the inventory photo when EVOX had no licensed
 * model. Removed on instruction after a real example showed why: the Silverado
 * 3500HD feed photo was a lot shot with an ENTIRELY DIFFERENT promotion burned
 * into it ("90 DAYS NO PAYMENTS", "$1000 GAS CARD"), which put two competing
 * offers in one creative. Dealers composite website furniture into their photos
 * as a matter of course, so the content can never be assumed clean.
 *
 * When EVOX has nothing, this returns no image and the caller SKIPS the ad. That
 * is deliberate: a vehicle ad with an empty vehicle is not a lesser ad, it's a
 * broken one, and preflight would refuse it anyway. Skipping explicitly produces
 * a reason someone can act on instead of a mystery.
 */
export function chooseVehicleImage(evoxUrl: string | null, _unit: StockUnit | null): ImageChoice {
  if (evoxUrl) {
    return { source: 'evox', url: evoxUrl, reason: 'EVOX jellybean (clean cut-out, composites best).' };
  }
  return {
    source: 'none',
    url: null,
    reason:
      'No EVOX imagery licensed for this model. Dealer feed photos are deliberately not used — they routinely carry burned-in promotions and signage. This vehicle cannot be automated until EVOX covers it.',
  };
}

/**
 * Which of `required` the offer data still can't satisfy, and whether inventory
 * could. Lets the orchestrator report "this make needs a VIN and we have one" vs
 * "…and we don't" as different outcomes rather than one opaque skip.
 */
export function unmetByInventory(
  required: string[],
  data: AdData,
  unit: StockUnit | null,
): { field: string; satisfiableFromStock: boolean }[] {
  const filled = (k: string) => (data[k] ?? '').trim() !== '';
  const fromStock: Record<string, boolean> = {
    vin: !!unit?.vin,
    stockNumber: !!unit?.stockNumber,
    msrp: !!unit?.msrp,
  };
  return required
    .filter((f) => !filled(f))
    .map((field) => ({ field, satisfiableFromStock: fromStock[field] ?? false }));
}
