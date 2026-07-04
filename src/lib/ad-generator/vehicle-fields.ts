import type { FieldSpec } from './types';
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
