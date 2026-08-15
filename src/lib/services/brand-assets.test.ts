import { describe, it, expect } from 'vitest';
import { brandAssetSpecs } from './brand-assets';

const account = {
  dealer: 'Young Honda Ogden',
  logos: JSON.stringify({
    light: 'https://cdn.test/logos/youngHondaOgden/light-abc.png',
    dark: 'https://cdn.test/logos/youngHondaOgden/dark-def.svg',
  }),
  customFonts: JSON.stringify([
    { family: 'Honda Sans', weight: '700', style: 'normal', url: 'https://cdn.test/fonts/youngHondaOgden/a.woff2' },
    { family: 'Honda Sans', weight: '400', style: 'italic', url: 'https://cdn.test/fonts/youngHondaOgden/b.woff2' },
  ]),
  customValues: JSON.stringify({
    storefront_image: { name: 'Storefront Image', value: 'https://cdn.test/logos/youngHondaOgden/storefront-x.jpg' },
    other_field: { name: 'Other', value: 'not an asset' },
  }),
};

describe('brandAssetSpecs', () => {
  it('finds every logo variant', () => {
    const specs = brandAssetSpecs(account);
    const logos = specs.filter((s) => s.managedBy === 'account-logo');
    expect(logos.map((l) => l.managedRef).sort()).toEqual(['dark', 'light', 'storefront']);
  });

  it('picks the storefront image out of customValues, not just logos', () => {
    // It lives in a different column purely by history, but it's a brand asset
    // like the rest and would otherwise stay invisible.
    const storefront = brandAssetSpecs(account).find((s) => s.managedRef === 'storefront');
    expect(storefront?.url).toContain('storefront-x.jpg');
  });

  it('ignores unrelated customValues', () => {
    expect(brandAssetSpecs(account).some((s) => s.url === 'not an asset')).toBe(false);
  });

  it('gives each font weight and style its own identity', () => {
    // Two cuts of one family are two files; keying on family alone would make
    // the sync overwrite one with the other on every run.
    const fonts = brandAssetSpecs(account).filter((s) => s.managedBy === 'account-font');
    expect(fonts.map((f) => f.managedRef).sort()).toEqual([
      'Honda Sans|400|italic',
      'Honda Sans|700|normal',
    ]);
  });

  it('names files for a human, extension preserved', () => {
    const specs = brandAssetSpecs(account);
    expect(specs.find((s) => s.managedRef === 'light')?.filename)
      .toBe('Young Honda Ogden logo — light.png');
    expect(specs.find((s) => s.managedRef === 'dark')?.filename)
      .toBe('Young Honda Ogden logo — dark.svg');
    expect(specs.find((s) => s.managedRef === 'Honda Sans|400|italic')?.filename)
      .toBe('Honda Sans 400 italic.woff2');
  });

  it('writes alt text from the label', () => {
    const light = brandAssetSpecs(account).find((s) => s.managedRef === 'light');
    expect(light?.label).toBe('Young Honda Ogden logo, light variant');
  });

  it('returns nothing for an account with no brand assets', () => {
    expect(brandAssetSpecs({ dealer: 'X', logos: null, customFonts: null, customValues: null })).toEqual([]);
    expect(brandAssetSpecs({ dealer: 'X', logos: '{}', customFonts: '[]', customValues: '{}' })).toEqual([]);
  });

  it('survives malformed JSON rather than throwing', () => {
    // Real account rows contain hand-edited JSON; one bad column must not stop
    // the other assets being catalogued.
    const specs = brandAssetSpecs({
      dealer: 'X',
      logos: 'not json',
      customFonts: account.customFonts,
      customValues: null,
    });
    expect(specs).toHaveLength(2);
    expect(specs.every((s) => s.managedBy === 'account-font')).toBe(true);
  });

  it('skips entries with no url or family', () => {
    const specs = brandAssetSpecs({
      dealer: 'X',
      logos: JSON.stringify({ light: '', dark: 'https://cdn.test/logos/x/d.png' }),
      customFonts: JSON.stringify([{ family: 'A' }, { url: 'https://cdn.test/f.woff2' }]),
      customValues: null,
    });
    expect(specs).toHaveLength(1);
    expect(specs[0].managedRef).toBe('dark');
  });

  it('defaults missing font weight and style', () => {
    const specs = brandAssetSpecs({
      dealer: 'X',
      logos: null,
      customValues: null,
      customFonts: JSON.stringify([{ family: 'Bare', url: 'https://cdn.test/fonts/x/bare.otf' }]),
    });
    expect(specs[0].managedRef).toBe('Bare|400|normal');
  });
});
