import type { FieldSpec } from './types';
import { vehicleOffer } from './templates/vehicle-offer';
import { vehicleDualOffer } from './templates/vehicle-dual-offer';

/**
 * Ad Types — an admin-configurable taxonomy scoped to an INDUSTRY. Each type
 * carries a question set (FieldSpec[]) plus a `vehicleMode` that toggles the
 * built-in vehicle/EVOX/OEM/offer engine. Templates + creatives reference a type
 * via adTypeId; an account only sees types matching its industry.
 */

export type AdTypeVehicleMode = 'none' | 'single' | 'dual';

export interface AdType {
  id: string;
  name: string;
  description?: string | null;
  industry: string;
  category?: string | null;
  vehicleMode: AdTypeVehicleMode;
  fields: FieldSpec[];
  sortOrder?: number;
  isActive?: boolean;
}

export function normalizeVehicleMode(v: unknown): AdTypeVehicleMode {
  return v === 'single' || v === 'dual' ? v : 'none';
}

/** Parse the AdType.fields JSON column into FieldSpec[]. */
export function parseAdTypeFields(raw: string | null | undefined): FieldSpec[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as FieldSpec[]) : [];
  } catch {
    return [];
  }
}

/**
 * The built-in vehicle/offer question set a `vehicleMode` switches on — reuses
 * the exact fields the code vehicle-offer templates already use, so the offer
 * engine, EVOX picker, OEM compliance and dual (`o2_`) handling all work
 * unchanged (the form gates on the presence of `offerType` / `o2_*` fields).
 */
export function vehicleModeFields(mode: AdTypeVehicleMode): FieldSpec[] {
  if (mode === 'single') return vehicleOffer.fields;
  if (mode === 'dual') return vehicleDualOffer.fields;
  return [];
}

/**
 * The full form question set for an ad type: the vehicle/offer fields (per mode)
 * followed by the type's own custom questions, de-duped by key (a custom field
 * with a built-in key is dropped so the engine's field wins).
 */
export function adTypeFormFields(vehicleMode: AdTypeVehicleMode, customFields: FieldSpec[]): FieldSpec[] {
  const base = vehicleModeFields(vehicleMode);
  const seen = new Set(base.map((f) => f.key));
  return [...base, ...customFields.filter((f) => f.key && !seen.has(f.key))];
}
