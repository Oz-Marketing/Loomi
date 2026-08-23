import { describe, it, expect } from 'vitest';
import { applyTheme, docTheme } from './theme';
import { youngSubaruSingleOffer, YOUNG_SUBARU_THEME } from './young-subaru-archetype';
import { blankTemplateDoc } from '../doc-template';
import type { Theme } from '../doc-types';

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
  onBrand: '#ffffff',
  fade: { angle: 90, end: 40 },
};

describe('a recolour repaints the design', () => {
  it('moves every theme colour onto the elements that wear it', () => {
    const next = applyTheme(youngSubaruSingleOffer(), RED);
    const el = (id: string) => next.elements.find((e) => e.id === id)!;
    expect(el('bgFill').fill).toBe(RED.base);
    expect(el('offerMain').color).toBe(RED.brand);
    expect(el('expiration').bg).toBe(RED.brand);
    expect(el('expiration').color).toBe(RED.onBrand);
    expect(el('disclaimer').color).toBe(RED.muted);
  });

  it('rebuilds the fade from the new angle and reach', () => {
    const fade = applyTheme(youngSubaruSingleOffer(), RED).elements.find((e) => e.id === 'bgFade')!;
    expect(fade.gradientFill?.angle).toBe(90);
    expect(fade.gradientFill?.stops[1].pos).toBe(40);
  });

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
