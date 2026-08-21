import type { FieldSpec } from './types';
import { offerKind } from './offer-kinds';

/**
 * The VEHICLE kind's field schema — the fields a designer binds elements to on a
 * vehicle offer template.
 *
 * Designers do not author fields. Everything downstream — the offer engine
 * (`_offer*` tokens), OEM compliance / required fields, the disclaimer token
 * engine, and MarketCheck — only understands these exact keys, so a
 * designer-invented field was inert.
 *
 * ⚠️ THIS IS NO LONGER "the schema for every ad". It is one kind's schema, and
 * it is the one that happens to be the default. Anything that needs the schema
 * for a PARTICULAR template must read `fieldsForKind(docOfferKind(doc))`, not
 * this — otherwise it silently applies vehicle fields to every other kind, which
 * is exactly the bug offer kinds exist to fix. This export remains because plenty
 * of callers legitimately mean "the vehicle schema" (the code vehicle templates,
 * the co-op rule editor's field list).
 */
export const SYSTEM_FIELDS: FieldSpec[] = offerKind('vehicle').fields;

/** The vehicle kind's preview / starter values, so a fresh canvas reads real
 *  immediately. The offer numbers are deliberate placeholders — see the kind.
 *
 *  Spread into a fresh object rather than aliased: several callers assign this
 *  straight into a doc's `defaults`, and an alias would let one of them mutate
 *  the kind for the whole process. */
export const SYSTEM_FIELD_DEFAULTS: Record<string, string> = { ...offerKind('vehicle').defaults };

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
