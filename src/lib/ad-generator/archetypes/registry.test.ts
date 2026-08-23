import { describe, it, expect } from 'vitest';
import { ARCHETYPE_STARTS, BRAND_THEME, DEFAULT_SIZES, archetypeStart, archetypeStartGroups, docFromStart } from './registry';
import { youngSubaruDualOffer, youngSubaruSingleOffer } from './young-subaru-archetype';
import { YOUNG_SUBARU_SIZES } from '../templates/young-subaru-offers';
import { renderDoc } from '../doc-renderer';
import { enrichOfferFields } from '../offer-text';
import type { AdSize } from '../types';

/**
 * The starting points a designer picks from. The acceptance criterion for Phase 3
 * is that one click produces a template laid out on every board without anybody
 * typing a coordinate — so these check the doc that lands, not the picker's markup.
 */

describe('every starting point produces a usable template', () => {
  for (const start of ARCHETYPE_STARTS) {
    describe(start.name, () => {
      const doc = docFromStart(start, { id: 'tmpl' });

      it('lays out every board it brings', () => {
        expect(doc.sizes).toHaveLength(start.sizes.length);
        for (const size of doc.sizes) {
          const lay = doc.layouts[size.id];
          expect(lay, size.id).toBeTruthy();
          // The two things no board may be missing.
          expect(lay.offerMain, `${size.id} offer`).toBeTruthy();
          expect(lay.disclaimer, `${size.id} disclaimer`).toBeTruthy();
          expect(lay.disclaimer.h * size.height, `${size.id} disclaimer px`).toBeGreaterThanOrEqual(22);
        }
      });

      it('renders on every board without throwing', () => {
        for (const size of doc.sizes) {
          expect(() => renderDoc(doc, enrichOfferFields(doc.defaults), size, { preview: false }), size.id).not.toThrow();
        }
      });

      it('carries one plate per offer and no conditional visibility', () => {
        const figures = doc.elements.filter((e) => /offerMain$/.test(e.id));
        expect(figures).toHaveLength(start.offers);
        for (const el of doc.elements) expect(el.visibleWhen, el.id).toBeUndefined();
      });

      it('declares the offer fields the form has to expose', () => {
        expect(doc.fields.some((f) => f.key === 'offerType')).toBe(true);
      });
    });
  }
});

describe('the default theme paints itself from the account', () => {
  it('uses the brand token rather than a hardcoded colour', () => {
    // So the generic starting points are usable for every rooftop instead of
    // arriving grey and needing a recolour before they look like anything.
    expect(BRAND_THEME.brand).toBe('brand');
    const doc = docFromStart(ARCHETYPE_STARTS[0], { id: 't' });
    expect(doc.elements.find((e) => e.id === 'offerMain')!.color).toBe('brand');
  });

  it('resolves to the account colour at render time', () => {
    const doc = docFromStart(ARCHETYPE_STARTS[0], { id: 't' });
    const html = renderDoc(doc, enrichOfferFields({ ...doc.defaults, brandColor: '#ff0055' }), DEFAULT_SIZES[0], { preview: false });
    expect(html).toContain('#ff0055');
  });
});

describe('a starting point keeps the template it lands on', () => {
  it('keeps the id, and the name when the designer has set one', () => {
    const named = docFromStart(ARCHETYPE_STARTS[0], { id: 'keep-me', name: 'Spring Event' });
    expect(named.id).toBe('keep-me');
    expect(named.name).toBe('Spring Event');
  });

  it('falls back to the starting point name when the template is unnamed', () => {
    expect(docFromStart(ARCHETYPE_STARTS[0], { id: 't' }).name).toBe('Vehicle Offer');
  });

  it('lays out the boards the designer already chose instead of its own', () => {
    const mine: AdSize[] = [{ id: 'sky', label: 'Skyscraper', width: 160, height: 600 }];
    const doc = docFromStart(ARCHETYPE_STARTS[0], { id: 't', sizes: mine });
    expect(doc.sizes).toEqual(mine);
    expect(doc.layouts.sky.offerMain).toBeTruthy();
  });
});

describe('the Young Subaru starts match the archetype docs', () => {
  /**
   * The acceptance criterion for this phase: a designer picking "Young Subaru —
   * One Offer" gets the doc `youngSubaruSingleOffer()` produces, on all five
   * channels, without typing a coordinate. Everything but the template's own
   * identity has to be identical, so this compares the whole design.
   */
  const identity = (doc: ReturnType<typeof youngSubaruSingleOffer>) => {
    const { id, name, description, ...design } = doc;
    void id;
    void name;
    void description;
    return design;
  };

  it('single offer is byte-comparable to youngSubaruSingleOffer()', () => {
    const fromStart = docFromStart(archetypeStart('young-subaru-single')!, { id: 'x' });
    expect(identity(fromStart)).toEqual(identity(youngSubaruSingleOffer()));
  });

  it('dual offer is byte-comparable to youngSubaruDualOffer()', () => {
    const fromStart = docFromStart(archetypeStart('young-subaru-dual')!, { id: 'x' });
    expect(identity(fromStart)).toEqual(identity(youngSubaruDualOffer()));
  });

  it('lays the same five channels out either way', () => {
    const fromStart = docFromStart(archetypeStart('young-subaru-single')!, { id: 'x' });
    expect(Object.keys(fromStart.layouts).sort()).toEqual(YOUNG_SUBARU_SIZES.map((s) => s.id).sort());
  });

  it('arrives with the rooftop already filled in', () => {
    // A store preset that lands showing a generic placeholder has not saved the
    // designer the work it exists to save.
    const doc = docFromStart(archetypeStart('young-subaru-single')!, { id: 'x' });
    expect(doc.defaults.dealerName).toBe('Young Subaru');
    expect(doc.defaults.vehicleName).toContain('Subaru');
  });
});

describe('the picker has something to show', () => {
  it('groups compositions before store presets', () => {
    const groups = archetypeStartGroups();
    expect(groups[0].group).toBe('Compositions');
    expect(groups.flatMap((g) => g.items)).toHaveLength(ARCHETYPE_STARTS.length);
    for (const g of groups) expect(g.items.length).toBeGreaterThan(0);
  });

  it('gives every entry a name, a hint and at least one board', () => {
    for (const s of ARCHETYPE_STARTS) {
      expect(s.name.length, s.id).toBeGreaterThan(2);
      expect(s.hint.length, s.id).toBeGreaterThan(20);
      expect(s.sizes.length, s.id).toBeGreaterThan(0);
    }
  });

  it('has no duplicate ids or names', () => {
    const ids = ARCHETYPE_STARTS.map((s) => s.id);
    const names = ARCHETYPE_STARTS.map((s) => s.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });
});
