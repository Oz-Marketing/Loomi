import type { AdData } from './types';
import { OFFER_TYPES } from './offer-text';
import { MAJOR_US_OEMS, POWERSPORTS_BRANDS } from '@/lib/oems';

/**
 * Facets for filtering the ad list — DERIVED from each ad's own data, never
 * hand-applied.
 *
 * Once the automation is running, a rooftop accumulates hundreds of ads a
 * month. Asking anyone to tag machine-built ads defeats the point of building
 * them automatically, and a tag that has to be maintained by hand goes stale
 * the first busy week. So every facet here is read back out of the fields the
 * ad already carries: the vehicle stash the YMM picker and the OEM incentive
 * apply both write (`_vehMake` &c.), plus the structured `offerType`.
 *
 * An ad can legitimately sit under several values of one facet — a dual-offer
 * template advertises two vehicles — so every facet is a LIST, and an ad
 * matches a selection when any of its values is selected.
 *
 * Pure: no React, no network. Deriving on the client is fine because the list
 * endpoint already ships each ad's full `data` for the preview thumbnails.
 */

/** The offer slots a template can fill. Mirrors `OfferSlot` in incentive-apply. */
const SLOTS = ['', 'o2_'] as const;

export type FacetKey = 'make' | 'model' | 'trim' | 'year' | 'offerType';

/** Facet order is the order the pickers render in — broad to narrow. */
export const FACET_KEYS: FacetKey[] = ['make', 'model', 'trim', 'year', 'offerType'];

export const FACET_LABELS: Record<FacetKey, string> = {
  make: 'Make',
  model: 'Model',
  trim: 'Trim',
  year: 'Year',
  offerType: 'Offer type',
};

/** One ad's values, per facet. Empty array = the ad says nothing about it. */
export type AdFacetValues = Record<FacetKey, string[]>;

/** A selection: facet → chosen values. Absent/empty = that facet is unfiltered. */
export type FacetSelection = Partial<Record<FacetKey, string[]>>;

const OFFER_TYPE_LABEL = new Map(OFFER_TYPES.map((o) => [o.value as string, o.label]));

/**
 * Brands longest-first, so "Land Rover" wins over a bare "Rover" substring and
 * "Alfa Romeo" isn't shadowed. Built once — the lists are static.
 */
const BRANDS_BY_LENGTH = [...MAJOR_US_OEMS, ...POWERSPORTS_BRANDS]
  .slice()
  .sort((a, b) => b.length - a.length);

/**
 * Make + year out of a free-text vehicle name, for ads whose structured stash
 * is missing (typed by hand, or built before the picker existed).
 *
 * Deliberately does NOT guess model or trim: "Silverado 1500 LT" gives no
 * reliable split between the two, and a filter that silently mis-files ads is
 * worse than one that leaves them out. Those two facets come from the stash
 * only; free-text names stay reachable through the search box.
 */
function fromVehicleName(name: string): { make?: string; year?: string } {
  const out: { make?: string; year?: string } = {};
  const year = name.match(/\b(19|20)\d{2}\b/);
  if (year) out.year = year[0];
  const lower = name.toLowerCase();
  const brand = BRANDS_BY_LENGTH.find((b) => lower.includes(b.toLowerCase()));
  if (brand) out.make = brand;
  return out;
}

function push(into: string[], value: unknown) {
  if (typeof value !== 'string') return;
  const v = value.trim();
  // De-duplicate case-insensitively but keep the first spelling we saw, so the
  // picker shows "Chevrolet" rather than whatever casing the last ad used.
  if (v && !into.some((x) => x.toLowerCase() === v.toLowerCase())) into.push(v);
}

/** Derive one ad's facet values from its filled data. */
export function facetsForAd(data: AdData): AdFacetValues {
  const out: AdFacetValues = { make: [], model: [], trim: [], year: [], offerType: [] };

  for (const p of SLOTS) {
    const make = data[`${p}_vehMake`];
    const model = data[`${p}_vehModel`];
    const year = data[`${p}_vehYear`];
    push(out.trim, data[`${p}_vehTrim`]);
    push(out.model, model);

    // Fall back to the display name only for what it can say without guessing.
    if (!make || !year) {
      const name = data[`${p}vehicleName`];
      const parsed = typeof name === 'string' && name.trim() ? fromVehicleName(name) : {};
      push(out.make, make || parsed.make);
      push(out.year, year || parsed.year);
    } else {
      push(out.make, make);
      push(out.year, year);
    }

    const type = data[`${p}offerType`];
    if (typeof type === 'string' && type.trim()) push(out.offerType, type.trim());
  }

  return out;
}

/** Human label for a facet value ('apr' → 'APR Financing'; everything else as-is). */
export function facetValueLabel(key: FacetKey, value: string): string {
  return key === 'offerType' ? OFFER_TYPE_LABEL.get(value) ?? value : value;
}

/**
 * Does an ad match the selection? Values within one facet are OR'd (Chevrolet
 * or GMC), facets are AND'd (a Chevrolet **and** a lease) — the behaviour every
 * faceted list has, so nobody has to learn it.
 */
export function matchesFacets(values: AdFacetValues, selection: FacetSelection): boolean {
  for (const key of FACET_KEYS) {
    const chosen = selection[key];
    if (!chosen?.length) continue;
    const mine = values[key];
    if (!mine.some((v) => chosen.some((c) => c.toLowerCase() === v.toLowerCase()))) return false;
  }
  return true;
}

/** One selectable option, with how many ads it would leave visible. */
export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

/**
 * Build the options for every facet.
 *
 * Each facet's counts are computed against the list filtered by all the OTHER
 * facets — so narrowing to Chevrolet drops Mazda's models out of the Model
 * picker, while the Make picker still shows every make (letting you switch
 * makes instead of dead-ending). Standard faceted-search behaviour, and the
 * reason a count is never zero for an option you can usefully click.
 */
export function buildFacetOptions(
  ads: { facets: AdFacetValues }[],
  selection: FacetSelection,
): Record<FacetKey, FacetOption[]> {
  const out = {} as Record<FacetKey, FacetOption[]>;

  for (const key of FACET_KEYS) {
    const others: FacetSelection = { ...selection };
    delete others[key];
    const pool = ads.filter((a) => matchesFacets(a.facets, others));

    const counts = new Map<string, { label: string; count: number }>();
    for (const ad of pool) {
      for (const v of ad.facets[key]) {
        const k = v.toLowerCase();
        const hit = counts.get(k);
        if (hit) hit.count += 1;
        else counts.set(k, { label: v, count: 1 });
      }
    }

    // Anything already selected must stay listed even if the other facets
    // filtered it down to nothing — otherwise the checkbox you ticked vanishes
    // and the filter can't be undone.
    for (const v of selection[key] ?? []) {
      if (!counts.has(v.toLowerCase())) counts.set(v.toLowerCase(), { label: v, count: 0 });
    }

    out[key] = [...counts.values()]
      .map(({ label, count }) => ({ value: label, label: facetValueLabel(key, label), count }))
      // Years read newest-first; everything else alphabetically.
      .sort((a, b) => (key === 'year' ? b.value.localeCompare(a.value) : a.label.localeCompare(b.label)));
  }

  return out;
}

/** How many individual values are selected across every facet. */
export function countSelected(selection: FacetSelection): number {
  return FACET_KEYS.reduce((n, k) => n + (selection[k]?.length ?? 0), 0);
}

// ── offer window ─────────────────────────────────────────────────────────────

/** Is the advertised offer still runnable today? */
export type OfferWindow = 'all' | 'active' | 'expired';

/**
 * When the ad's offer stops being valid, or null if it never does.
 *
 * Two sources, because the two kinds of ad record it differently: the
 * automation stamps `expiresAt` on the row, while an ad a person built from an
 * OEM incentive carries the date in its `expiration` field. Taking the earlier
 * of the two keeps an ad from reading as live past either deadline.
 */
export function offerEndsAt(data: AdData, expiresAt?: string | null): Date | null {
  const dates: number[] = [];

  if (expiresAt) {
    const t = new Date(expiresAt).getTime();
    if (!Number.isNaN(t)) dates.push(t);
  }

  const field = data.expiration;
  if (typeof field === 'string') {
    // A plain "YYYY-MM-DD" means valid THROUGH that day, and `new Date(str)`
    // would read it as UTC midnight — which is the previous evening in Utah and
    // would retire offers up to a day early. Build it as local end-of-day.
    const m = field.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) dates.push(new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999).getTime());
    else {
      const t = new Date(field).getTime();
      if (!Number.isNaN(t)) dates.push(t);
    }
  }

  return dates.length ? new Date(Math.min(...dates)) : null;
}

/**
 * An ad with no end date counts as active — an evergreen brand ad hasn't
 * expired, it simply never does, and hiding it under "Active" would be wrong.
 */
export function matchesWindow(end: Date | null, window: OfferWindow, now: Date): boolean {
  if (window === 'all') return true;
  const expired = end !== null && end.getTime() < now.getTime();
  return window === 'expired' ? expired : !expired;
}
