import { describe, expect, it } from 'vitest';
import { availableLogoVariants, brandLogoData, isLogoVariant, logoVariantDataKey } from './brand-logos';
import { renderDoc } from './doc-renderer';
import type { TemplateDoc } from './doc-types';
import type { LogoVariant } from './brand-logos';

const LOGOS = {
  light: 'https://cdn.test/light.png',
  dark: 'https://cdn.test/dark.png',
  white: 'https://cdn.test/white.png',
};

describe('logoVariantDataKey', () => {
  it('maps a variant to its data key', () => {
    expect(logoVariantDataKey('light')).toBe('logoUrlLight');
    expect(logoVariantDataKey('dark')).toBe('logoUrlDark');
    expect(logoVariantDataKey('black')).toBe('logoUrlBlack');
  });
});

describe('isLogoVariant', () => {
  it('accepts the four variants and nothing else', () => {
    expect(isLogoVariant('dark')).toBe(true);
    expect(isLogoVariant('primary')).toBe(false);
    expect(isLogoVariant(undefined)).toBe(false);
  });
});

describe('availableLogoVariants', () => {
  it('lists only the variants with a file, in display order', () => {
    expect(availableLogoVariants(LOGOS).map((v) => v.key)).toEqual(['light', 'dark', 'white']);
  });

  it('is empty for an account with no logos', () => {
    expect(availableLogoVariants(null)).toEqual([]);
    expect(availableLogoVariants({})).toEqual([]);
  });
});

describe('brandLogoData', () => {
  it('defaults to the first variant on file', () => {
    expect(brandLogoData(LOGOS).logoUrl).toBe(LOGOS.light);
  });

  it('honours the ad-level pick as the default', () => {
    expect(brandLogoData(LOGOS, 'dark').logoUrl).toBe(LOGOS.dark);
  });

  it('ignores a pick the account has no file for', () => {
    expect(brandLogoData(LOGOS, 'black').logoUrl).toBe(LOGOS.light);
  });

  it('exposes every variant under its own key', () => {
    const data = brandLogoData(LOGOS);
    expect(data.logoUrlLight).toBe(LOGOS.light);
    expect(data.logoUrlDark).toBe(LOGOS.dark);
    expect(data.logoUrlWhite).toBe(LOGOS.white);
  });

  it('falls a missing variant back to the default, so a pin never renders a hole', () => {
    expect(brandLogoData(LOGOS).logoUrlBlack).toBe(LOGOS.light);
    expect(brandLogoData(LOGOS, 'dark').logoUrlBlack).toBe(LOGOS.dark);
  });

  it('returns nothing for an account with no logos at all', () => {
    expect(brandLogoData(null)).toEqual({});
  });
});

describe('renderDoc — pinned logo variants', () => {
  const SIZE = { id: 's', label: 'Square', width: 100, height: 100 };

  function docWith(variant?: LogoVariant): TemplateDoc {
    return {
      id: 'tmpl',
      name: 'Logo test',
      fields: [],
      elements: [{ id: 'logo', type: 'logo', binding: { kind: 'brand', key: 'logoUrl', ...(variant ? { variant } : {}) } }],
      sizes: [SIZE],
      layouts: { s: { logo: { x: 0, y: 0, w: 0.5, h: 0.2 } } },
      defaults: {},
    } as TemplateDoc;
  }

  it('renders the pinned variant, not the ad default', () => {
    const html = renderDoc(docWith('dark'), brandLogoData(LOGOS), SIZE);
    expect(html).toContain(LOGOS.dark);
    expect(html).not.toContain(LOGOS.light);
  });

  it('renders the ad default when nothing is pinned', () => {
    const html = renderDoc(docWith(), brandLogoData(LOGOS, 'white'), SIZE);
    expect(html).toContain(LOGOS.white);
  });

  it('falls back to the ad default when the account lacks the pinned variant', () => {
    const html = renderDoc(docWith('black'), brandLogoData(LOGOS), SIZE);
    expect(html).toContain(LOGOS.light);
  });

  it('still resolves a pin against data assembled without the variant keys', () => {
    const html = renderDoc(docWith('dark'), { logoUrl: LOGOS.light }, SIZE);
    expect(html).toContain(LOGOS.light);
  });
});
