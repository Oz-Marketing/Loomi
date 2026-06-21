import { describe, it, expect } from 'vitest';
import { AD_SIZE_CATALOG, catalogByCategory, aspectLabel } from './ad-size-catalog';

describe('AD_SIZE_CATALOG', () => {
  it('has all 17 standard sizes with unique names + positive dimensions', () => {
    expect(AD_SIZE_CATALOG).toHaveLength(17);
    const names = new Set(AD_SIZE_CATALOG.map((s) => s.name));
    expect(names.size).toBe(17);
    for (const s of AD_SIZE_CATALOG) {
      expect(s.width).toBeGreaterThan(0);
      expect(s.height).toBeGreaterThan(0);
    }
  });

  it('groups by category in order (social, display, email)', () => {
    const groups = catalogByCategory();
    expect(groups.map((g) => g.category)).toEqual(['social', 'display', 'email']);
    expect(groups.find((g) => g.category === 'social')!.sizes).toHaveLength(9);
    expect(groups.find((g) => g.category === 'display')!.sizes).toHaveLength(6);
    expect(groups.find((g) => g.category === 'email')!.sizes).toHaveLength(2);
  });

  it('derives tidy aspect ratios for small reduced ratios, decimals otherwise', () => {
    expect(aspectLabel(1080, 1080)).toBe('1:1');
    expect(aspectLabel(1080, 1920)).toBe('9:16');
    expect(aspectLabel(1280, 720)).toBe('16:9');
    expect(aspectLabel(300, 250)).toBe('6:5');
    expect(aspectLabel(160, 600)).toBe('4:15');
    expect(aspectLabel(1200, 628)).toBe('1.91:1'); // reduces to 300:157 → too big → decimal-to-1
    expect(aspectLabel(728, 90)).toBe('8.09:1'); // reduces to 364:45 → too big → decimal-to-1
  });
});
