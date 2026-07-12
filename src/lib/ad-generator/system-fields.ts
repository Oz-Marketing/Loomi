import type { FieldSpec } from './types';
import { vehicleOffer } from './templates/vehicle-offer';

/**
 * THE canonical field schema for every ad — the fixed "system fields" a designer
 * binds elements to. This is Phase 1 of collapsing the old model (designers
 * authored arbitrary per-template fields) into one shared schema: designers no
 * longer create/manage fields, they just drag an element and point its value at
 * one of these.
 *
 * Why a fixed set is the right call: everything downstream — the offer engine
 * (`_offer*` tokens), OEM compliance / required fields, the disclaimer token
 * engine, and MarketCheck — already only understands THESE exact keys. A
 * designer-invented field was inert. So making them the single source of truth
 * removes the confusion without losing real capability.
 *
 * Sourced from the vehicle-offer template's field set (the fields the engine
 * already speaks) so there is ONE definition, never a drifting copy.
 */
export const SYSTEM_FIELDS: FieldSpec[] = vehicleOffer.fields;

/** Canonical preview / starter values so a fresh canvas reads real immediately
 *  (and the "required fields" check passes) without the designer entering data. */
export const SYSTEM_FIELD_DEFAULTS: Record<string, string> = { ...vehicleOffer.defaults };

/** System fields keyed by their `key` — for O(1) lookups (labels, gating, etc.). */
export const SYSTEM_FIELD_BY_KEY: Record<string, FieldSpec> = Object.fromEntries(
  SYSTEM_FIELDS.map((f) => [f.key, f]),
);

/** Ordered, de-duped group names in the system schema (form section order). */
export const SYSTEM_FIELD_GROUPS: string[] = (() => {
  const out: string[] = [];
  for (const f of SYSTEM_FIELDS) {
    const g = f.group?.trim() || 'General';
    if (!out.includes(g)) out.push(g);
  }
  return out;
})();
