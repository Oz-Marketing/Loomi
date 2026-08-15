import { describe, expect, it } from 'vitest';
import {
  isVehicleImageField,
  VEHICLE_PLACEHOLDER_URL,
  withPreviewPlaceholders,
} from './preview-placeholders';
import type { FieldSpec } from './types';

const FIELDS: FieldSpec[] = [
  { key: 'vehicleImageUrl', label: 'Vehicle image URL', type: 'image' },
  { key: 'o2_vehicleImageUrl', label: 'Vehicle 2 image URL', type: 'image' },
  { key: 'badgeImageUrl', label: 'Badge', type: 'image' },
  { key: 'vehicleName', label: 'Vehicle', type: 'text' },
];

describe('isVehicleImageField', () => {
  it('matches the vehicle slots, including the second offer', () => {
    expect(isVehicleImageField('vehicleImageUrl')).toBe(true);
    expect(isVehicleImageField('o2_vehicleImageUrl')).toBe(true);
  });

  it('does not match other image fields', () => {
    expect(isVehicleImageField('badgeImageUrl')).toBe(false);
    expect(isVehicleImageField('vehicleName')).toBe(false);
  });
});

describe('VEHICLE_PLACEHOLDER_URL', () => {
  it('is a self-contained data URI — nothing to fetch, nothing licensed', () => {
    expect(VEHICLE_PLACEHOLDER_URL.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    // The xmlns namespace is a URI but never fetched; what must be absent is
    // anything the renderer would actually go and load.
    const svg = decodeURIComponent(VEHICLE_PLACEHOLDER_URL.replace('data:image/svg+xml;utf8,', ''));
    expect(svg).not.toMatch(/<image|xlink:href|href=|url\(/);
    expect(svg.replace(/xmlns="[^"]*"/g, '')).not.toContain('http');
  });

  it('is a flat translucent shape, so it cannot be mistaken for a rendered car', () => {
    const svg = decodeURIComponent(VEHICLE_PLACEHOLDER_URL);
    // No baked-in label (it collided with the design), no photo — just a shape
    // drawn translucent, which is what makes it read as "a car goes here".
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('<image');
    expect(svg).toContain('fill-opacity');
  });

  it('is sized like the transparent PNGs the real slot takes, so `contain` behaves the same', () => {
    expect(decodeURIComponent(VEHICLE_PLACEHOLDER_URL)).toContain('viewBox="0 0 1200 600"');
  });
});

describe('withPreviewPlaceholders', () => {
  it('fills an empty vehicle slot', () => {
    const out = withPreviewPlaceholders({}, FIELDS);
    expect(out.vehicleImageUrl).toBe(VEHICLE_PLACEHOLDER_URL);
    expect(out.o2_vehicleImageUrl).toBe(VEHICLE_PLACEHOLDER_URL);
  });

  it('never displaces a real vehicle image', () => {
    const out = withPreviewPlaceholders({ vehicleImageUrl: 'https://cdn/evox.png' }, FIELDS);
    expect(out.vehicleImageUrl).toBe('https://cdn/evox.png');
  });

  it('treats whitespace as empty', () => {
    expect(withPreviewPlaceholders({ vehicleImageUrl: '   ' }, FIELDS).vehicleImageUrl).toBe(
      VEHICLE_PLACEHOLDER_URL,
    );
  });

  it('leaves other empty image slots reading as empty', () => {
    // A blank logo or badge slot is honest information; a fake car is not.
    expect(withPreviewPlaceholders({}, FIELDS).badgeImageUrl).toBeUndefined();
  });

  it('prefers a real vehicle image when one was resolved', () => {
    const out = withPreviewPlaceholders({}, FIELDS, 'https://cdn/evox-crosstrek.png');
    expect(out.vehicleImageUrl).toBe('https://cdn/evox-crosstrek.png');
    expect(out.o2_vehicleImageUrl).toBe('https://cdn/evox-crosstrek.png');
  });

  it('falls back to the drawn silhouette when no real image was resolved', () => {
    expect(withPreviewPlaceholders({}, FIELDS, null).vehicleImageUrl).toBe(VEHICLE_PLACEHOLDER_URL);
    expect(withPreviewPlaceholders({}, FIELDS, '   ').vehicleImageUrl).toBe(VEHICLE_PLACEHOLDER_URL);
  });

  it('still never displaces a real vehicle image, sample or not', () => {
    const out = withPreviewPlaceholders({ vehicleImageUrl: 'https://cdn/real.png' }, FIELDS, 'https://cdn/sample.png');
    expect(out.vehicleImageUrl).toBe('https://cdn/real.png');
  });

  it('returns the same object when there is nothing to fill', () => {
    const data = { vehicleImageUrl: 'https://cdn/a.png', o2_vehicleImageUrl: 'https://cdn/b.png' };
    expect(withPreviewPlaceholders(data, FIELDS)).toBe(data);
  });

  it('does nothing for a template with no vehicle fields', () => {
    const data = {};
    expect(withPreviewPlaceholders(data, [{ key: 'headline', label: 'Headline', type: 'text' }])).toBe(data);
  });
});
