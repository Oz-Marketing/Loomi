import type { FieldSpec } from './types';
import type { TemplateDoc, DocElement, DocLayoutBox } from './doc-types';
import { vehicleOffer } from './templates/vehicle-offer';
import { vehicleDualOffer } from './templates/vehicle-dual-offer';

/**
 * The built-in vehicle/offer question set for a from-scratch ad. Reuses the
 * exact fields the code vehicle-offer templates use, so the offer engine (EVOX
 * picker, OEM compliance, dual `o2_` handling) works unchanged — the form gates
 * on the presence of `offerType` / `o2_*` fields.
 *
 * This is the small functional remnant of the retired Ad Types taxonomy: a
 * designer starting an ad from scratch can opt into single- or dual-vehicle
 * offer questions instead of a blank form. It is NOT a taxonomy — just a field
 * seed toggle.
 */
export type VehicleFieldsMode = 'none' | 'single' | 'dual';

export function vehicleModeFields(mode: VehicleFieldsMode): FieldSpec[] {
  if (mode === 'single') return vehicleOffer.fields;
  if (mode === 'dual') return vehicleDualOffer.fields;
  return [];
}

/**
 * Merge the offer/vehicle question set (single or dual) into a template's form,
 * deduped by field key — adds only the fields the doc doesn't already have, plus
 * their starter default values (again, only for keys not already set) so the
 * preview reads real. Never overwrites the designer's existing fields/defaults.
 * The layout-only `backgroundImage` field is intentionally excluded (it lives on
 * the code offer *docs*, not in this data-entry kit). Shared by the from-scratch
 * creation flow and the builder's "Add offer fields" action.
 */
export function addFieldKit(doc: TemplateDoc, mode: 'single' | 'dual'): TemplateDoc {
  const kit = mode === 'single' ? vehicleOffer : vehicleDualOffer;
  const have = new Set(doc.fields.map((f) => f.key));
  const newFields = kit.fields.filter((f) => !have.has(f.key));
  if (newFields.length === 0) return doc;
  const defaults = { ...doc.defaults };
  for (const [k, v] of Object.entries(kit.defaults)) {
    if (!(k in defaults)) defaults[k] = v;
  }
  return { ...doc, fields: [...doc.fields, ...newFields], defaults };
}

// The offer-1 computed display bindings and the per-offer field keys that have
// an `o2_` twin in the dual kit — i.e. the bindings that get a second-offer
// counterpart. Shared/legal keys (expiration, disclaimer, vin, stock) are NOT
// prefixed in the dual kit, so they're deliberately excluded from cloning.
const OFFER1_COMPUTED = ['_offerLabel', '_offerMain', '_offerTerms'];
const O2_TWIN_KEYS = new Set(
  vehicleDualOffer.fields.filter((f) => f.key.startsWith('o2_')).map((f) => f.key.slice(3)),
);

/** The second-offer counterpart of an offer-1 binding key, or null if the key
 *  is already an offer-2 key or a shared/chrome field that shouldn't be cloned. */
function secondOfferKey(key: string): string | null {
  if (key.startsWith('o2_') || key.startsWith('_o2_')) return null;
  if (OFFER1_COMPUTED.includes(key)) return `_o2_${key.slice(1)}`; // _offerMain → _o2_offerMain
  if (O2_TWIN_KEYS.has(key)) return `o2_${key}`; // vehicleName → o2_vehicleName
  return null;
}

/**
 * Seed a recommended second-offer element block: clone each offer-1 offer/vehicle
 * element, rebind it to the matching `o2_`/`_o2_` field, tag it 2-offers-only
 * (`offerCounts:[2]`), and shift it beside the original in every size. Chrome and
 * shared/legal elements are left untouched (they show for both counts). Idempotent
 * — skips an offer-1 element whose o2 twin already exists — so re-running is safe.
 * The designer rearranges freely afterward using the builder's offer-count toggle.
 */
export function seedSecondOfferElements(doc: TemplateDoc): TemplateDoc {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const existingO2 = new Set(
    doc.elements
      .filter((e) => e.binding?.kind === 'field')
      .map((e) => (e.binding as { key: string }).key),
  );
  const clones: DocElement[] = [];
  const layoutAdds: Record<string, Record<string, DocLayoutBox>> = {};
  doc.elements.forEach((el, i) => {
    if (el.binding?.kind !== 'field') return;
    const target = secondOfferKey(el.binding.key);
    if (!target || existingO2.has(target)) return;
    const id = `${el.type}-o2-${i}-${el.id}`.slice(0, 60);
    clones.push({ ...structuredClone(el), id, binding: { kind: 'field', key: target }, offerCounts: [2] });
    for (const sid of Object.keys(doc.layouts)) {
      const b = doc.layouts[sid][el.id];
      if (!b) continue;
      (layoutAdds[sid] ??= {})[id] = { ...b, x: clamp(b.x + b.w + 0.04, 0, 1 - b.w) };
    }
  });
  if (!clones.length) return doc;
  const layouts = { ...doc.layouts };
  for (const sid of Object.keys(layoutAdds)) layouts[sid] = { ...layouts[sid], ...layoutAdds[sid] };
  return { ...doc, elements: [...doc.elements, ...clones], layouts };
}
