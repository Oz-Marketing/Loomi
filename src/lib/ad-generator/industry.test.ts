import { describe, it, expect } from 'vitest';
import { effectiveIndustries, templateInIndustry, isVehicleIndustry } from './industry';
import type { FieldSpec } from './types';

const vehicleFields: FieldSpec[] = [{ key: 'offerType', label: 'Offer', type: 'select' }];
const plainFields: FieldSpec[] = [{ key: 'headline', label: 'Headline', type: 'text' }];

describe('ad-generator industry scoping', () => {
  it('treats Automotive + Powersports as vehicle industries', () => {
    expect(isVehicleIndustry('Automotive')).toBe(true);
    expect(isVehicleIndustry('powersports')).toBe(true);
    expect(isVehicleIndustry('Healthcare')).toBe(false);
    expect(isVehicleIndustry(undefined)).toBe(false);
  });

  it('uses explicit industries when set', () => {
    expect(effectiveIndustries({ industries: ['Healthcare'], fields: plainFields })).toEqual(['Healthcare']);
  });

  it('derives Automotive + Powersports for untagged vehicle templates', () => {
    expect(effectiveIndustries({ fields: vehicleFields })).toEqual(['Automotive', 'Powersports']);
  });

  it('derives nothing for an untagged non-vehicle template (stays hidden)', () => {
    expect(effectiveIndustries({ fields: plainFields })).toEqual([]);
  });

  it('shows a vehicle template to automotive/powersports accounts, hides it from others', () => {
    expect(templateInIndustry({ fields: vehicleFields }, 'Automotive')).toBe(true);
    expect(templateInIndustry({ fields: vehicleFields }, 'Powersports')).toBe(true);
    expect(templateInIndustry({ fields: vehicleFields }, 'Healthcare')).toBe(false);
  });

  it('an untagged non-vehicle template is hidden from every specific account', () => {
    expect(templateInIndustry({ fields: plainFields }, 'Healthcare')).toBe(false);
    expect(templateInIndustry({ fields: plainFields }, 'Automotive')).toBe(false);
  });

  it('admin / no account sees the full library', () => {
    expect(templateInIndustry({ fields: plainFields }, '')).toBe(true);
    expect(templateInIndustry({ fields: vehicleFields }, null)).toBe(true);
  });
});
