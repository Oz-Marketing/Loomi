import type { AdData, FieldSpec } from './types';
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

/**
 * Read the vehicle out of an ad's data.
 *
 * WHY THIS EXISTS. The stored keys are `vehicleName` plus `_vehYear` / `_vehMake` /
 * `_vehModel` / `_vehTrim` — written by `incentiveToFieldPatch` and by the YMM
 * picker. They are NOT `year` / `make` / `model`, which is the natural guess and
 * the wrong one: reading `data.make` yields undefined on every real ad, and the
 * failure is silent because every consumer treats a missing make as "no
 * manufacturer rules apply". That is how a compliance lookup quietly becomes a
 * no-op, so it's worth having exactly one place that knows the answer.
 *
 * `prefix` reads a second offer's parallel fields (`o2_`), matching the rest of
 * the offer plumbing.
 */
export function vehicleFromData(
  data: AdData,
  prefix = '',
): { year: string; make: string; model: string; trim: string; name: string } {
  const g = (key: string): string => (data[`${prefix}${key}`] ?? '').toString().trim();
  const year = g('_vehYear');
  const make = g('_vehMake');
  const model = g('_vehModel');
  const name = g('vehicleName');
  return {
    year,
    make,
    model,
    trim: g('_vehTrim'),
    // Fall back to composing the name, so a record written by something that set
    // only the parts still reads properly.
    name: name || [year, make, model].filter(Boolean).join(' '),
  };
}
