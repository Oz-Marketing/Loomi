import { describe, it, expect } from 'vitest';
import { ARCHETYPE_STARTS, archetypeStartGroups, docFromStart } from './registry';
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
          // The frame has no floor now — these are unarranged blocks and a small
          // board carrying all of them cannot spare one. The type CEILING is the
          // guarantee that survives.
          expect(lay.disclaimer.fontSize!, `${size.id} disclaimer cap`).toBeLessThanOrEqual(16);
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

/**
 * THE BRAND-TOKEN TESTS WERE HERE.
 *
 * `BRAND_THEME.brand === 'brand'` meant the offer figure arrived painted in the
 * account's colour, so a generic starting point was usable for every rooftop
 * instead of arriving grey. The starting points now build PLAIN blocks — nothing
 * they produce carries a colour at all — so there is no painting left to assert.
 * The theme is still recorded on the doc; see `theme.test.ts` for what it does
 * and does not do now.
 */

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

describe('the picker has something to show', () => {
  it('offers every entry, grouped', () => {
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

  it('names no rooftop, dealership or make — this list is shown to everyone', () => {
    // The regression this exists for: two Young Subaru presets sat here, so a Ford
    // dealer opening the builder was offered "Young Subaru" as a way to start an
    // ad. A store's palette belongs to its account branding, its channel sizes to
    // the size library, and its sample content to its own templates.
    for (const s of ARCHETYPE_STARTS) {
      const text = `${s.id} ${s.name} ${s.hint} ${s.group}`;
      expect(text, s.id).not.toMatch(
        /young|subaru|mazda|ford|chevrolet|kia|hyundai|nissan|toyota|honda|dealership/i,
      );
    }
  });

  it('paints every entry from the account rather than a fixed palette', () => {
    // The reason a store preset is unnecessary in the first place.
    for (const s of ARCHETYPE_STARTS) expect(s.theme.brand, s.id).toBe('brand');
  });

  it('has no duplicate ids or names', () => {
    const ids = ARCHETYPE_STARTS.map((s) => s.id);
    const names = ARCHETYPE_STARTS.map((s) => s.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });
});
