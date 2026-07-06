import { describe, it, expect } from 'vitest';
import { effectiveIndustries, templateInIndustry, isVehicleIndustry } from './industry';

describe('ad-generator industry scoping', () => {
  it('treats Automotive + Powersports as vehicle industries', () => {
    expect(isVehicleIndustry('Automotive')).toBe(true);
    expect(isVehicleIndustry('powersports')).toBe(true);
    expect(isVehicleIndustry('Healthcare')).toBe(false);
    expect(isVehicleIndustry(undefined)).toBe(false);
  });

  it('uses explicit industries when set', () => {
    expect(effectiveIndustries({ industries: ['Healthcare'] })).toEqual(['Healthcare']);
  });

  it('an untagged template has no industries (global to all)', () => {
    expect(effectiveIndustries({})).toEqual([]);
    expect(effectiveIndustries({ industries: [] })).toEqual([]);
  });

  it('scopes a tagged template to matching accounts, hides it from others', () => {
    expect(templateInIndustry({ industries: ['Automotive'] }, 'Automotive')).toBe(true);
    expect(templateInIndustry({ industries: ['Automotive', 'Powersports'] }, 'Powersports')).toBe(true);
    expect(templateInIndustry({ industries: ['Automotive'] }, 'Healthcare')).toBe(false);
  });

  it('an untagged template is global — visible to every account', () => {
    expect(templateInIndustry({}, 'Healthcare')).toBe(true);
    expect(templateInIndustry({ industries: [] }, 'Automotive')).toBe(true);
  });

  it('admin / no account sees the full library', () => {
    expect(templateInIndustry({ industries: ['Healthcare'] }, '')).toBe(true);
    expect(templateInIndustry({ industries: ['Automotive'] }, null)).toBe(true);
  });
});
