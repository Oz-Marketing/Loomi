import { describe, it, expect } from 'vitest';
import type { AdData } from './types';
import {
  FINANCIAL_TARGETING_FLOOR,
  PRESET_DEFAULTS,
  SPECIAL_AD_CATEGORIES,
  destinationUrl,
  fillUrlTemplate,
  isFinancialCategory,
  resolveLaunch,
  specialAdCategoriesFor,
  type PresetRow,
} from './launch-preset';

function data(over: Partial<AdData> = {}): AdData {
  return {
    offerType: 'lease',
    year: '2026',
    make: 'Chevrolet',
    model: 'Trax',
    monthlyPayment: '299',
    leaseTerm: '24',
    ...over,
  };
}

function preset(over: Partial<PresetRow> = {}): PresetRow {
  return { platform: 'meta', ...PRESET_DEFAULTS, ...over };
}

describe('SPECIAL_AD_CATEGORIES', () => {
  it('offers FINANCIAL_PRODUCTS_SERVICES and not the retired CREDIT', () => {
    // Meta replaced CREDIT on 2025-01-14; sending it now is rejected outright, and
    // the spec this was built from still named it.
    expect(SPECIAL_AD_CATEGORIES).toContain('FINANCIAL_PRODUCTS_SERVICES');
    expect(SPECIAL_AD_CATEGORIES as readonly string[]).not.toContain('CREDIT');
  });
});

describe('specialAdCategoriesFor', () => {
  it('applies the category to a lease offer', () => {
    const d = specialAdCategoriesFor({ offerType: 'lease' });
    expect(d.categories).toEqual(['FINANCIAL_PRODUCTS_SERVICES']);
    expect(isFinancialCategory(d.categories)).toBe(true);
  });

  it('applies it to an APR offer', () => {
    expect(specialAdCategoriesFor({ offerType: 'apr' }).categories).toEqual(['FINANCIAL_PRODUCTS_SERVICES']);
  });

  it('leaves a plain sale price alone', () => {
    const d = specialAdCategoriesFor({ offerType: 'sales_price', texts: ['Save big this August.'] });
    expect(d.categories).toEqual(['NONE']);
    expect(isFinancialCategory(d.categories)).toBe(false);
  });

  it('catches financing hidden in the fine print of a cash offer', () => {
    // Meta's rule reaches an ad whose financing appears only in a disclaimer, and
    // "with approved credit" is in nearly every dealer disclaimer.
    const d = specialAdCategoriesFor({
      offerType: 'discount',
      texts: ['$3,000 cash back', 'Offer requires financing with approved credit through GM Financial.'],
    });
    expect(d.categories).toEqual(['FINANCIAL_PRODUCTS_SERVICES']);
    expect(d.reason).toContain('financing');
  });

  it('catches a monthly payment in the copy of an untyped offer', () => {
    const d = specialAdCategoriesFor({ offerType: 'custom', texts: ['Drive home for $299/mo'] });
    expect(d.categories).toEqual(['FINANCIAL_PRODUCTS_SERVICES']);
  });

  it('ignores empty and missing text', () => {
    expect(specialAdCategoriesFor({ offerType: 'custom', texts: [null, undefined, ''] }).categories).toEqual([
      'NONE',
    ]);
    expect(specialAdCategoriesFor({}).categories).toEqual(['NONE']);
  });
});

describe('fillUrlTemplate', () => {
  it('fills placeholders and url-encodes them', () => {
    expect(fillUrlTemplate('https://d.com/new/{{make}}/{{model}}', data({ model: 'Silverado 1500' }))).toBe(
      'https://d.com/new/Chevrolet/Silverado%201500',
    );
  });

  it('drops a placeholder the data has no value for', () => {
    expect(fillUrlTemplate('https://d.com/{{vin}}', data())).toBe('https://d.com/');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(fillUrlTemplate('https://d.com/{{ model }}', data())).toBe('https://d.com/Trax');
  });
});

describe('destinationUrl', () => {
  it('adds UTMs', () => {
    const url = destinationUrl({
      urlTemplate: 'https://youngchevy.com/new/{{model}}',
      data: data(),
      utm: { source: 'meta', medium: 'paid_social', campaign: 'august-lease' },
    });
    expect(url).toBe('https://youngchevy.com/new/Trax?utm_source=meta&utm_medium=paid_social&utm_campaign=august-lease');
  });

  it("keeps the template's own query parameters", () => {
    // A dealer SRP URL usually carries filters; clobbering them sends the traffic
    // to the wrong inventory.
    const url = destinationUrl({
      urlTemplate: 'https://youngchevy.com/inventory?condition=new&model={{model}}',
      data: data(),
      utm: { source: 'meta' },
    });
    expect(url).toContain('condition=new');
    expect(url).toContain('model=Trax');
    expect(url).toContain('utm_source=meta');
  });

  it('falls back to the account website when there is no template', () => {
    expect(destinationUrl({ fallbackUrl: 'youngchevy.com', data: data() })).toBe('https://youngchevy.com/');
  });

  it('returns null when there is nowhere to send the click', () => {
    expect(destinationUrl({ data: data() })).toBeNull();
    expect(destinationUrl({ urlTemplate: 'not a url', data: data() })).toBeNull();
  });
});

describe('resolveLaunch', () => {
  it('raises a too-tight radius to Meta’s floor and says so', () => {
    const r = resolveLaunch({ preset: preset({ geoRadiusMiles: 5 }), data: data() });
    expect(r.geoRadiusMiles).toBe(FINANCIAL_TARGETING_FLOOR.minRadiusMiles);
    expect(r.notices.join(' ')).toContain('raised from 5 to 15');
  });

  it('leaves a compliant radius alone', () => {
    expect(resolveLaunch({ preset: preset({ geoRadiusMiles: 30 }), data: data() }).geoRadiusMiles).toBe(30);
  });

  it('does not apply the floor to a non-financing ad', () => {
    const r = resolveLaunch({
      preset: preset({ geoRadiusMiles: 5 }),
      data: data({ offerType: 'sales_price', monthlyPayment: '' }),
      texts: ['Save $4,000 this month'],
    });
    expect(r.geoRadiusMiles).toBe(5);
    expect(r.targetingFloor).toBeNull();
  });

  it('reports that a saved audience cannot be used on a financing ad', () => {
    const r = resolveLaunch({
      preset: preset({ audienceSpec: '{"interests":["trucks"]}' }),
      data: data(),
    });
    expect(r.notices.join(' ')).toContain('detailed targeting and exclusions');
  });

  it('reports that zip targeting degrades to a radius centre', () => {
    const r = resolveLaunch({ preset: preset({ geoZip: '84401' }), data: data() });
    expect(r.notices.join(' ')).toContain('84401');
    expect(r.geoZip).toBe('84401');
  });

  it('works with no preset at all — an account can launch on day one', () => {
    const r = resolveLaunch({ preset: null, data: data(), fallbackUrl: 'youngchevy.com' });
    expect(r.objective).toBe('OUTCOME_TRAFFIC');
    expect(r.destinationUrl).toContain('utm_source=meta');
    expect(r.specialAdCategories).toEqual(['FINANCIAL_PRODUCTS_SERVICES']);
  });

  it('flags a missing destination rather than silently producing one', () => {
    const r = resolveLaunch({ preset: preset(), data: data() });
    expect(r.destinationUrl).toBeNull();
    expect(r.notices.join(' ')).toContain('needs somewhere to send the click');
  });

  it('intersects the preset sizes with what the ad actually has', () => {
    const r = resolveLaunch({
      preset: preset({ sizeIds: JSON.stringify(['square', 'story']) }),
      data: data(),
      availableSizeIds: ['square', 'landscape'],
    });
    expect(r.sizeIds).toEqual(['square']);
  });

  it('falls back to every size when the preset names none that exist', () => {
    const r = resolveLaunch({
      preset: preset({ sizeIds: JSON.stringify(['wide']) }),
      data: data(),
      availableSizeIds: ['square', 'story'],
    });
    expect(r.sizeIds).toEqual(['square', 'story']);
    expect(r.notices.join(' ')).toContain('every rendered size');
  });

  it('always explains the category decision', () => {
    const r = resolveLaunch({ preset: preset(), data: data() });
    expect(r.notices[0]).toContain('credit advertising');
  });
});
