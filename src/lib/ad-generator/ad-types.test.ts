import { describe, it, expect } from 'vitest';
import { normalizeVehicleMode, parseAdTypeFields, vehicleModeFields, adTypeFormFields } from './ad-types';
import type { FieldSpec } from './types';

describe('ad-types', () => {
  it('normalizes vehicle mode', () => {
    expect(normalizeVehicleMode('single')).toBe('single');
    expect(normalizeVehicleMode('dual')).toBe('dual');
    expect(normalizeVehicleMode('none')).toBe('none');
    expect(normalizeVehicleMode('garbage')).toBe('none');
    expect(normalizeVehicleMode(undefined)).toBe('none');
  });

  it('parses the fields JSON column safely', () => {
    expect(parseAdTypeFields('[{"key":"a","label":"A","type":"text"}]')).toHaveLength(1);
    expect(parseAdTypeFields('')).toEqual([]);
    expect(parseAdTypeFields('not json')).toEqual([]);
    expect(parseAdTypeFields(null)).toEqual([]);
  });

  it('vehicleModeFields switches on the offer engine', () => {
    expect(vehicleModeFields('none')).toEqual([]);
    const single = vehicleModeFields('single');
    expect(single.some((f) => f.key === 'offerType')).toBe(true);
    expect(single.some((f) => f.key === 'vehicleImageUrl')).toBe(true);
    // dual carries the o2_ parallel offer (what the form gates dual mode on)
    expect(vehicleModeFields('dual').some((f) => f.key.startsWith('o2_'))).toBe(true);
  });

  it('combines vehicle fields + custom questions, de-duped by key', () => {
    const custom: FieldSpec[] = [
      { key: 'serviceName', label: 'Service', type: 'text' },
      { key: 'offerType', label: 'dup', type: 'text' }, // collides with the engine → dropped
    ];
    const none = adTypeFormFields('none', custom);
    expect(none.map((f) => f.key)).toContain('serviceName');
    // with the engine on, the custom offerType is dropped (engine's wins)
    const single = adTypeFormFields('single', custom);
    expect(single.filter((f) => f.key === 'offerType')).toHaveLength(1);
    expect(single.some((f) => f.key === 'serviceName')).toBe(true);
  });
});
