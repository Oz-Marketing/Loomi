import type { FieldSpec } from './types';
import type { TemplateDoc } from './doc-types';
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
