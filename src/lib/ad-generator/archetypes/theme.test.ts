import { describe, it, expect } from 'vitest';
import { applyTheme, docTheme } from './theme';
import { youngSubaruSingleOffer, YOUNG_SUBARU_THEME } from './young-subaru-archetype';
import { blankTemplateDoc } from '../doc-template';
import type { TemplateDoc, Theme } from '../doc-types';
import { archetypeStart, docFromStart, BRAND_THEME } from './registry';

/**
 * Retheming. The whole reason an archetype's output is an ordinary doc is that a
 * designer can keep working on it, so the one thing a recolour must never do is
 * throw that work away.
 */

const RED: Theme = {
  base: '#fff5f5',
  brand: '#b91c1c',
  ink: '#450a0a',
  muted: '#7f1d1d',
  fade: { angle: 90, end: 40 },
};

/**
 * `applyTheme` survives, but it has nothing to paint.
 *
 * The starting points build PLAIN text boxes and image slots — no fills, no
 * colours, no faces — so a retheme is a no-op on everything they produce. What
 * these tests guard is that it stays a no-op rather than becoming destructive:
 * an unguarded copy of the theme's keys would push `undefined` over whatever
 * styling the DESIGNER had applied, and clear their work every time the theme
 * was touched.
 */
describe('a retheme never destroys the designer\u2019s work', () => {
  it('records the theme it is now wearing', () => {
    expect(docTheme(applyTheme(youngSubaruSingleOffer(), RED))).toEqual(RED);
    expect(docTheme(youngSubaruSingleOffer())).toEqual(YOUNG_SUBARU_THEME);
  });

  it('is reversible — the old theme back gives the old design back', () => {
    const doc = youngSubaruSingleOffer();
    const round = applyTheme(applyTheme(doc, RED), YOUNG_SUBARU_THEME);
    expect(round).toEqual(doc);
  });
});

describe('a recolour keeps the designer’s work', () => {
  const doc = youngSubaruSingleOffer();

  it('touches no geometry', () => {
    expect(applyTheme(doc, RED).layouts).toEqual(doc.layouts);
    expect(applyTheme(doc, RED).sizes).toEqual(doc.sizes);
  });

  it('keeps repositioned boxes, added layers and renamed ones', () => {
    const edited = {
      ...doc,
      elements: [
        ...doc.elements.map((e) => (e.id === 'offerMain' ? { ...e, name: 'The big number' } : e)),
        { id: 'mine', type: 'text' as const, name: 'My badge', color: '#123456' },
      ],
      layouts: {
        ...doc.layouts,
        [doc.sizes[0].id]: { ...doc.layouts[doc.sizes[0].id], mine: { x: 0.1, y: 0.1, w: 0.2, h: 0.1, z: 9 } },
      },
    };
    const next = applyTheme(edited, RED);
    expect(next.elements.find((e) => e.id === 'offerMain')!.name).toBe('The big number');
    expect(next.layouts[doc.sizes[0].id].mine).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.1, z: 9 });
    // A hand-placed layer is not the theme's business.
    expect(next.elements.find((e) => e.id === 'mine')!.color).toBe('#123456');
  });

  it('keeps a per-size override that is not about colour', () => {
    const edited = { ...doc, overrides: { [doc.sizes[1].id]: { tagline: { align: 'center' as const } } } };
    expect(applyTheme(edited, RED).overrides?.[doc.sizes[1].id]?.tagline).toEqual({ align: 'center' });
  });

  it('drops a per-size override that pinned an old colour', () => {
    // Otherwise the recolour would appear to fail on that one board, which is the
    // worst version: the theme changed everywhere the designer was not looking.
    const edited = {
      ...doc,
      overrides: { [doc.sizes[1].id]: { disclaimer: { color: '#00ff00', align: 'center' as const } } },
    };
    const kept = applyTheme(edited, RED).overrides?.[doc.sizes[1].id]?.disclaimer;
    expect(kept).toEqual({ align: 'center' });
  });

  it('drops the whole override entry when colour was all it held', () => {
    const edited = { ...doc, overrides: { [doc.sizes[1].id]: { disclaimer: { color: '#00ff00' } } } };
    expect(applyTheme(edited, RED).overrides?.[doc.sizes[1].id]).toBeUndefined();
  });
});

describe('a doc no archetype produced is left alone', () => {
  it('returns a hand-built doc unchanged', () => {
    const blank = blankTemplateDoc('t', 'Hand-built');
    expect(applyTheme(blank, RED)).toBe(blank);
    expect(docTheme(blank)).toBeUndefined();
  });

  it('returns a doc naming an archetype this build does not know unchanged', () => {
    const doc = { ...youngSubaruSingleOffer(), archetype: { id: 'from-the-future', offers: 1, theme: RED } };
    expect(applyTheme(doc, YOUNG_SUBARU_THEME)).toBe(doc);
  });
});

/**
 * Type is a theme value, not a per-layer chore.
 *
 * Before this, an archetype styled every text slot on every board and named no
 * face, so a brand font was a change a designer made one layer at a time and then
 * repeated on the next template.
 */
describe('the theme is recorded, even though nothing reads it', () => {
  const doc = () => docFromStart(archetypeStart('vehicle-offer')!, { id: 't', name: 'T' });
  const faceOf = (d: TemplateDoc, id: string) => d.elements.find((e) => e.id === id)?.fontFamily;

  it('names no face by default, so an older design is unchanged', () => {
    const d = doc();
    for (const el of d.elements) expect(el.fontFamily).toBeUndefined();
  });

  it('keeps the face it was given on the doc it stores', () => {
    const d = applyTheme(doc(), { ...BRAND_THEME, heading: 'Archivo', body: 'Source Serif 4' });
    expect(d.archetype?.theme.heading).toBe('Archivo');
    expect(d.archetype?.theme.body).toBe('Source Serif 4');
  });

  it('does not touch a hand-placed layer', () => {
    const base = doc();
    const withMine: TemplateDoc = { ...base, elements: [...base.elements, { id: 'mine', type: 'text', fontFamily: 'Courier New' }] };
    const d = applyTheme(withMine, { ...BRAND_THEME, heading: 'Archivo' });
    expect(faceOf(d, 'mine')).toBe('Courier New');
  });
});
