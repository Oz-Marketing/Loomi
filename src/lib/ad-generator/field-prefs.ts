import type { FieldSpec } from './types';
import { requiredFieldsFor, FIELD_LABELS, type OemOfferRule } from './compliance';
import { OFFER_TYPES } from './offer-text';

/**
 * Per-sub-account control over which fields a custom-ad form shows.
 *
 * A shared template carries every field any dealer might need. A given rooftop
 * uses a handful of them, and the rest are noise on a form somebody fills in
 * every week. So a sub-account can hide the ones it never uses — without a
 * designer forking the template per dealer, which is how a library of near
 * identical plates gets started.
 *
 * ── WHY PROTECTION IS PER OFFER TYPE, NOT THE UNION ──
 *
 * A hidden field is still SUBMITTED with whatever value it had. So hiding a
 * field that is required RIGHT NOW doesn't relax the requirement, it removes the
 * only way to satisfy it: export stays blocked and the input to fix it is gone.
 *
 * The first cut protected everything required by ANY offer type. That is safe,
 * and almost useless: a lease-only dealer found APR rate, APR term, discount
 * amount and sale price all locked, so the list was mostly padlocks and the
 * feature looked like it did nothing.
 *
 * The requirement is per offer type, so the protection is too. A dealer may hide
 * APR rate; the moment the ad's offer type becomes `apr` it comes back on its
 * own, because {@link applyFieldPrefs} re-adds whatever the CURRENT type
 * requires. Nobody can reach a blocked-and-unfixable state, and nothing is
 * locked that isn't relevant to the ad in front of them.
 *
 * Only two keys are unconditional: `offerType`, which decides what every other
 * field means, and the disclaimer, which is the legal line.
 *
 * Pure: no DB, no network, no clock.
 */

/** Fields no sub-account may hide, under any offer type. */
export const ALWAYS_VISIBLE = ['offerType', 'disclaimer'] as const;

/**
 * Keys that must stay visible.
 *
 * With `offerType`, that's the unconditional pair plus whatever that type
 * requires — the runtime question. Without it, just the unconditional pair —
 * the question the preferences dialog asks, which is offer-type agnostic.
 */
export function protectedFieldKeys(rule?: OemOfferRule | null, offerType?: string): Set<string> {
  const keys = new Set<string>(ALWAYS_VISIBLE);
  if (offerType) for (const k of requiredFieldsFor(offerType, rule)) keys.add(k);
  return keys;
}

/** Offer types that require `key`, for the dialog's "comes back on…" note. */
function typesRequiring(key: string, rule?: OemOfferRule | null): string[] {
  return OFFER_TYPES.filter(({ value }) => requiredFieldsFor(value, rule).includes(key)).map(
    ({ label }) => label,
  );
}

/** A field a sub-account may hide, plus why it might not stay hidden. */
export interface HidableField {
  key: string;
  label: string;
  /** Set only when the field can never be hidden. */
  lockedReason?: string;
  /** Set when hiding works, but some offer types will show it anyway. */
  note?: string;
}

/**
 * Every field worth offering, marked with whether it can be hidden.
 *
 * Protected fields are listed rather than dropped: a list that silently omits
 * "Offer type" reads as a bug, where one that shows it locked with a reason
 * answers the question before it's asked.
 */
export function hidableFields(
  fields: FieldSpec[],
  rule?: OemOfferRule | null,
  /**
   * Field keys the template actually renders — the binding keys on its elements.
   *
   * Since the system-field schema became fixed, every doc carries all ~37 fields
   * whether or not it draws them, so an unfiltered list offered a dealer choices
   * that do nothing: hiding "Vehicle image URL" on a template with no image
   * element changes nothing they can see. Omit to show everything (code-defined
   * templates, where there are no bindings to read).
   */
  boundKeys?: Set<string>,
): HidableField[] {
  const locked = protectedFieldKeys(rule);
  const visible = boundKeys
    ? fields.filter((f) => boundKeys.has(f.key) || locked.has(f.key))
    : fields;

  return visible.map((f) => {
    const label = f.label || FIELD_LABELS[f.key] || f.key;
    if (locked.has(f.key)) {
      return {
        key: f.key,
        label,
        lockedReason:
          f.key === 'disclaimer' ? 'The legal line always shows' : 'Decides what the other fields mean',
      };
    }
    const types = typesRequiring(f.key, rule);
    return types.length
      ? { key: f.key, label, note: `Still shows on ${types.join(' and ')} offers` }
      : { key: f.key, label };
  });
}

/**
 * The hidden-field list as it will be stored.
 *
 * Only the unconditional keys are stripped — a per-offer-type requirement is
 * enforced at render instead, so the preference survives a change of offer type
 * rather than being silently rewritten by whichever type happened to be selected
 * when it was saved.
 */
export function sanitizeHiddenFields(
  requested: string[],
  fields: FieldSpec[],
  rule?: OemOfferRule | null,
): string[] {
  const locked = protectedFieldKeys(rule);
  const known = new Set(fields.map((f) => f.key));
  const out: string[] = [];
  for (const key of requested) {
    const k = (key ?? '').trim();
    if (!k || locked.has(k) || !known.has(k)) continue;
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * Apply a sub-account's preference to a template's field list.
 *
 * `offerType` is what keeps this safe: anything the CURRENT type requires is put
 * back regardless of the stored preference, so hiding a field can never leave an
 * ad blocked on a value with nowhere to type it.
 */
export function applyFieldPrefs(
  fields: FieldSpec[],
  hidden: string[] | null | undefined,
  rule?: OemOfferRule | null,
  offerType?: string,
): FieldSpec[] {
  if (!hidden?.length) return fields;
  const keep = protectedFieldKeys(rule, offerType);
  const drop = new Set(hidden.filter((k) => !keep.has(k)));
  if (!drop.size) return fields;
  return fields.filter((f) => !drop.has(f.key));
}

/** Parse a stored `hiddenFields` JSON column defensively. */
export function parseHiddenFields(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
