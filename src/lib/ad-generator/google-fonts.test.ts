import { describe, it, expect } from 'vitest';
import { isGoogleFont, googleFontsCssUrl, usedGoogleFontFamilies, googleFont } from './google-fonts';

describe('google-fonts', () => {
  it('recognizes curated families only', () => {
    expect(isGoogleFont('Lobster')).toBe(true);
    expect(isGoogleFont('Playfair Display')).toBe(true);
    expect(isGoogleFont('Verdana')).toBe(false); // websafe, not Google
    expect(isGoogleFont('Totally Made Up')).toBe(false);
    expect(isGoogleFont(undefined)).toBe(false);
  });

  it('builds a CSS2 API url with + for spaces and declared weights', () => {
    const url = googleFontsCssUrl(['Playfair Display']);
    expect(url).toContain('https://fonts.googleapis.com/css2?');
    expect(url).toContain('family=Playfair+Display:wght@');
    expect(url).toContain('display=swap');
  });

  it('honors a weight override but never requests an unsupported weight', () => {
    // Bebas Neue only ships 400 → an override of [700] falls back to 400.
    expect(googleFont('Bebas Neue')?.weights).toEqual([400]);
    expect(googleFontsCssUrl(['Bebas Neue'], [700])).toContain('Bebas+Neue:wght@400');
    // A supported override is respected.
    expect(googleFontsCssUrl(['Inter'], [400])).toContain('Inter:wght@400');
  });

  it('ignores non-curated families and returns empty when nothing valid', () => {
    expect(googleFontsCssUrl(['Verdana', 'Nope'])).toBe('');
  });

  it('collects used Google families from elements + doc-level font, deduped', () => {
    const used = usedGoogleFontFamilies(
      [{ fontFamily: 'Lobster' }, { fontFamily: 'Verdana' }, { fontFamily: 'Lobster' }, {}],
      'Montserrat',
    );
    expect(used).toContain('Lobster');
    expect(used).toContain('Montserrat');
    expect(used).not.toContain('Verdana');
    expect(used.length).toBe(2);
  });
});
