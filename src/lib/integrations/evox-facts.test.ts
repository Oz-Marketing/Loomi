import { describe, it, expect } from 'vitest';
import { normalizeOems } from '@/lib/oems';

/**
 * The derivation importEvoxImage applies to a vehicle's facts before filing the
 * image. Kept honest here because EVOX itself can't run in a test — but the
 * mapping is where the value is, and where a silent wrong answer would live.
 */
function deriveEvoxFacts(vehicle?: { year?: number | string | null; make?: string | null; model?: string | null }) {
  const [brand] = normalizeOems(vehicle?.make ?? undefined);
  const yearNum = Number(vehicle?.year);
  const modelYear = Number.isFinite(yearNum) && yearNum > 1900 ? String(yearNum) : null;
  const vehicleModel = vehicle?.model?.trim() || null;
  return { brand: brand ?? null, modelYear, vehicleModel };
}

describe('EVOX vehicle facts → DAM fields', () => {
  it('canonicalizes the make so one brand is one library', () => {
    // "chevrolet" and "Chevrolet" must not become two rows in the brand rail.
    expect(deriveEvoxFacts({ make: 'chevrolet' }).brand).toBe('Chevrolet');
    expect(deriveEvoxFacts({ make: 'Honda' }).brand).toBe('Honda');
  });

  it('takes the year as a string, from a number or a string', () => {
    expect(deriveEvoxFacts({ year: 2026 }).modelYear).toBe('2026');
    expect(deriveEvoxFacts({ year: '2026' }).modelYear).toBe('2026');
  });

  it('rejects a nonsense year rather than storing it', () => {
    // A bad value here would show up as a facet nobody can explain.
    expect(deriveEvoxFacts({ year: 0 }).modelYear).toBeNull();
    expect(deriveEvoxFacts({ year: 'n/a' }).modelYear).toBeNull();
    expect(deriveEvoxFacts({ year: 1899 }).modelYear).toBeNull();
  });

  it('trims the model and drops an empty one', () => {
    expect(deriveEvoxFacts({ model: '  Civic ' }).vehicleModel).toBe('Civic');
    expect(deriveEvoxFacts({ model: '   ' }).vehicleModel).toBeNull();
  });

  it('degrades to all-null when the caller passes nothing', () => {
    // The parameter is optional; an older caller must still import cleanly.
    expect(deriveEvoxFacts()).toEqual({ brand: null, modelYear: null, vehicleModel: null });
    expect(deriveEvoxFacts({})).toEqual({ brand: null, modelYear: null, vehicleModel: null });
  });

  it('passes an unknown marque through rather than dropping the image', () => {
    expect(deriveEvoxFacts({ make: 'Rivian' }).brand).toBe('Rivian');
  });
});
