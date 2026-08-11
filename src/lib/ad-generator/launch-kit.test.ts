import { describe, it, expect } from 'vitest';
import type { AdData } from './types';
import { vehicleFromData } from './vehicle-fields';
import { googleCopySheet, metaCopySheet, targetingSheet, readmeSheet, type LaunchKitInput } from './launch-kit';
import { PRESET_DEFAULTS, resolveLaunch } from './launch-preset';

/** The keys a real generated ad actually carries. */
function realAdData(over: Partial<AdData> = {}): AdData {
  return {
    offerType: 'lease',
    monthlyPayment: '311',
    leaseTerm: '24',
    dueAtSigning: '2859',
    vehicleName: '2026 Chevrolet Trax LT',
    _vehYear: '2026',
    _vehMake: 'Chevrolet',
    _vehModel: 'Trax',
    _vehTrim: 'LT',
    disclaimer: 'Closed-end lease. With approved credit.',
    ...over,
  };
}

describe('vehicleFromData', () => {
  it('reads the keys real ads actually use', () => {
    // `data.make` is undefined on every real ad — the stored key is `_vehMake`.
    // Reading the wrong one fails silently, because an empty make reads as "no
    // manufacturer rules apply" everywhere downstream.
    const v = vehicleFromData(realAdData());
    expect(v.make).toBe('Chevrolet');
    expect(v.model).toBe('Trax');
    expect(v.year).toBe('2026');
    expect(v.name).toBe('2026 Chevrolet Trax LT');
  });

  it('composes a name from the parts when none is stored', () => {
    const v = vehicleFromData(realAdData({ vehicleName: '' }));
    expect(v.name).toBe('2026 Chevrolet Trax');
  });

  it('returns empty strings rather than undefined for a bare ad', () => {
    const v = vehicleFromData({} as AdData);
    expect(v).toEqual({ year: '', make: '', model: '', trim: '', name: '' });
  });

  it('reads a second offer through the o2_ prefix', () => {
    const v = vehicleFromData({ o2__vehMake: 'Honda', o2__vehModel: 'Civic' } as AdData, 'o2_');
    expect(v.make).toBe('Honda');
    expect(v.model).toBe('Civic');
  });
});

function kit(over: Partial<LaunchKitInput> = {}): LaunchKitInput {
  const data = realAdData();
  return {
    adName: '2026 Chevrolet Trax — $311/mo',
    accountName: 'Young Chev',
    vehicle: '2026 Chevrolet Trax LT',
    offerSummary: '$311/mo · 24-month lease',
    copy: {
      fields: {},
      meta: { primaryText: '2026 Chevrolet Trax — $311/mo.', headline: '$311/mo — Trax', description: 'Per month lease' },
      google: { headlines: ['$311/mo Trax', '2026 Trax', 'Young Chev'], descriptions: ['24-month lease.', 'See it today.'] },
    },
    copySource: 'deterministic',
    launch: resolveLaunch({ preset: { platform: 'meta', ...PRESET_DEFAULTS }, data, fallbackUrl: 'youngchevy.com' }),
    approval: null,
    imageFiles: ['images/trax-1080x1080.png'],
    expiresAt: null,
    generatedAt: '2026-08-05T12:00:00.000Z',
    ...over,
  };
}

describe('targetingSheet', () => {
  it('states the category and the restrictions it forces', () => {
    const s = targetingSheet(kit());
    expect(s).toContain('FINANCIAL_PRODUCTS_SERVICES');
    expect(s).toContain('at least 15 miles');
    expect(s).toContain('cannot be narrowed');
    expect(s).toContain('exclusions not permitted');
  });

  it('omits the restrictions block for a non-financing ad', () => {
    const data = realAdData({ offerType: 'sales_price', monthlyPayment: '', leaseTerm: '', dueAtSigning: '', disclaimer: 'See dealer.' });
    const s = targetingSheet(kit({ launch: resolveLaunch({ data, fallbackUrl: 'd.com' }) }));
    expect(s).not.toContain('REQUIRED BY META');
  });

  it('lists the creative files and the resolver notes', () => {
    const s = targetingSheet(kit());
    expect(s).toContain('images/trax-1080x1080.png');
    expect(s).toContain('credit advertising');
  });
});

describe('metaCopySheet', () => {
  it('gives each field with its character count', () => {
    const s = metaCopySheet(kit());
    expect(s).toContain('$311/mo — Trax');
    expect(s).toContain('(14/40)');
  });

  it('flags text that would be truncated', () => {
    const k = kit();
    k.copy!.meta.headline = 'x'.repeat(45);
    expect(metaCopySheet(k)).toContain('OVER LIMIT');
  });

  it('renders without copy rather than throwing', () => {
    expect(metaCopySheet(kit({ copy: null }))).toContain('PRIMARY TEXT');
  });
});

describe('googleCopySheet', () => {
  it('numbers the assets and warns that Search is not an option', () => {
    const s = googleCopySheet(kit());
    expect(s).toContain('1. $311/mo Trax');
    expect(s).toContain('Search is not an option');
  });
});

describe('readmeSheet', () => {
  it('tells the reader to check targeting before building anything', () => {
    // The category changes what you may target, so reading it second means
    // rebuilding the campaign.
    const s = readmeSheet(kit());
    expect(s).toContain('targeting.txt first');
  });
});
