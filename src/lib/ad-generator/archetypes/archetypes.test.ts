import { describe, it, expect } from 'vitest';
import { youngSubaruSingleOffer, YOUNG_SUBARU_THEME } from './young-subaru-archetype';
import { vehicleOfferArchetype } from './vehicle-offer-archetype';
import { buildArchetypeDoc } from './types';
import { YOUNG_SUBARU_SIZES } from '../templates/young-subaru-offers';
import { youngSubaruSingleOfferDoc } from '../templates/young-subaru-offers';
import { renderDoc } from '../doc-renderer';
import { enrichOfferFields } from '../offer-text';
import { OFFER_TYPES } from '../offer-text';
import type { AdSize, AdData } from '../types';
import type { DocLayoutBox, TemplateDoc } from '../doc-types';

/**
 * The prototype's contract. These are the invariants the hand-authored layouts
 * had no way to state, which is why they drifted: nothing checked that a
 * disclaimer stayed legible on the smallest board, or that the offer plate held
 * its proportions, or that a new size was complete.
 */

const px = (b: DocLayoutBox, s: AdSize) => ({ w: b.w * s.width, h: b.h * s.height });
const bySize = (doc: TemplateDoc, id: string) => doc.sizes.find((s) => s.id === id)!;

/** Non-background slots, which are the ones that must not collide. */
const CONTENT = ['logo', 'tagline', 'offerLabel', 'offerMain', 'offerTerms', 'vehicle', 'vehicleName', 'expiration', 'disclaimer'];

function overlaps(a: DocLayoutBox, b: DocLayoutBox): boolean {
  const eps = 1e-6;
  return a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
}

describe('vehicle offer archetype — every board is complete', () => {
  const doc = youngSubaruSingleOffer();

  it('covers the five channels Young runs', () => {
    expect(doc.sizes.map((s) => s.id)).toEqual(['fb', 'email', 'google', 'ksl600', 'ksl850']);
  });

  it('places a box for every element it declares, on every board', () => {
    for (const size of doc.sizes) {
      const lay = doc.layouts[size.id];
      const present = vehicleOfferArchetype.present(size, vehicleOfferArchetype.slots);
      for (const id of present) {
        expect(lay[id], `${size.id}/${id}`).toBeTruthy();
      }
      // …and never a box for something the doc has no element for.
      const ids = new Set(doc.elements.map((e) => e.id));
      for (const id of Object.keys(lay)) expect(ids.has(id), `${size.id}/${id}`).toBe(true);
    }
  });

  it('keeps every box on the board', () => {
    for (const size of doc.sizes) {
      for (const [id, b] of Object.entries(doc.layouts[size.id])) {
        expect(b.x, `${size.id}/${id} x`).toBeGreaterThanOrEqual(-1e-6);
        expect(b.y, `${size.id}/${id} y`).toBeGreaterThanOrEqual(-1e-6);
        expect(b.x + b.w, `${size.id}/${id} right`).toBeLessThanOrEqual(1 + 1e-3);
        expect(b.y + b.h, `${size.id}/${id} bottom`).toBeLessThanOrEqual(1 + 1e-3);
      }
    }
  });

  it('never overlaps two pieces of content', () => {
    for (const size of doc.sizes) {
      const lay = doc.layouts[size.id];
      const ids = CONTENT.filter((id) => lay[id]);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          expect(overlaps(lay[ids[i]], lay[ids[j]]), `${size.id}: ${ids[i]} vs ${ids[j]}`).toBe(false);
        }
      }
    }
  });
});

describe('the disclaimer is never negotiable', () => {
  const doc = youngSubaruSingleOffer();

  it('is present on every board, including the smallest', () => {
    for (const size of doc.sizes) {
      expect(doc.layouts[size.id].disclaimer, size.id).toBeTruthy();
    }
  });

  it('keeps a legible frame in real pixels, not a fraction that collapses', () => {
    // The hand-tuned layouts gave the 300×250 board a 4.5% disclaimer — eleven
    // pixels of frame. A fraction is not a size; this is the floor that says so.
    for (const size of doc.sizes) {
      const h = px(doc.layouts[size.id].disclaimer, size).h;
      expect(h, `${size.id} disclaimer height`).toBeGreaterThanOrEqual(22);
    }
  });
});

describe('one offer plate, four offer types', () => {
  const doc = youngSubaruSingleOffer();

  it('declares the offer exactly once — no per-type copies', () => {
    const offerish = doc.elements.filter((e) => /^offer/.test(e.id));
    expect(offerish.map((e) => e.id).sort()).toEqual(['offerLabel', 'offerMain', 'offerTerms']);
  });

  it('carries no conditional visibility at all', () => {
    // Every `visibleWhen` in the hand-built templates existed to switch between
    // per-type copies of the same plate. With one plate there is nothing to gate.
    for (const el of doc.elements) expect(el.visibleWhen, el.id).toBeUndefined();
  });

  it('renders a real offer for lease, APR, discount and sale price', () => {
    const size = bySize(doc, 'fb');
    const cases: Record<string, AdData> = {
      lease: { offerType: 'lease', monthlyPayment: '299', leaseTerm: '36', dueAtSigning: '2999' },
      apr: { offerType: 'apr', aprRate: '1.9', aprTerm: '60' },
      discount: { offerType: 'discount', discountAmount: '3000', msrp: '34995' },
      sales_price: { offerType: 'sales_price', salePrice: '28995', msrp: '34995' },
    };
    const expected: Record<string, string[]> = {
      lease: ['PER MONTH LEASE', '$299/mo', '36-month lease'],
      apr: ['APR', '1.9% APR', 'for 60 months'],
      discount: ['OFF MSRP', '$3,000', 'MSRP of $34,995'],
      sales_price: ['SALES PRICE', '$28,995', 'MSRP of $34,995'],
    };
    for (const [type, data] of Object.entries(cases)) {
      const html = renderDoc(doc, enrichOfferFields({ ...doc.defaults, ...data }), size, { preview: false });
      for (const fragment of expected[type]) {
        expect(html, `${type} → ${fragment}`).toContain(fragment);
      }
    }
  });

  it('covers every offer type the vehicle kind declares', () => {
    // If a fifth type is ever added, this fails until the plate is checked
    // against it — rather than a designer discovering it in a live ad.
    const size = bySize(doc, 'fb');
    for (const t of OFFER_TYPES) {
      const html = renderDoc(doc, enrichOfferFields({ ...doc.defaults, offerType: t.value }), size, { preview: false });
      expect(html, t.value).toContain('<div class="ad">');
    }
  });
});

describe('the offer plate holds its proportions across boards', () => {
  const doc = youngSubaruSingleOffer();

  it('keeps the figure dominant over the label and terms everywhere', () => {
    for (const size of doc.sizes) {
      const lay = doc.layouts[size.id];
      const main = px(lay.offerMain, size).h;
      const label = px(lay.offerLabel, size).h;
      const terms = px(lay.offerTerms, size).h;
      expect(main, `${size.id}: figure vs label`).toBeGreaterThan(label);
      expect(main, `${size.id}: figure vs terms`).toBeGreaterThan(terms);
      expect(main, `${size.id}: figure legible`).toBeGreaterThanOrEqual(34);
    }
  });

  it('stacks label, figure and terms in that order, touching, on every board', () => {
    for (const size of doc.sizes) {
      const lay = doc.layouts[size.id];
      expect(lay.offerLabel.y, size.id).toBeLessThan(lay.offerMain.y);
      expect(lay.offerMain.y, size.id).toBeLessThan(lay.offerTerms.y);
      // The plate is a lockup: no other slot may land between its rows.
      const top = lay.offerLabel.y;
      const bottom = lay.offerTerms.y + lay.offerTerms.h;
      for (const id of CONTENT) {
        if (/^offer/.test(id) || !lay[id]) continue;
        const b = lay[id];
        const inside = b.y > top + 1e-4 && b.y + b.h < bottom - 1e-4;
        expect(inside, `${size.id}: ${id} inside the offer plate`).toBe(false);
      }
    }
  });
});

describe('small boards shed content instead of crushing it', () => {
  const doc = youngSubaruSingleOffer();

  it('drops the tagline on the 300×250, exactly as the hand-tuned layout did', () => {
    expect(doc.layouts.google.tagline).toBeUndefined();
    // …and keeps it where there is room.
    expect(doc.layouts.fb.tagline).toBeTruthy();
    expect(doc.layouts.ksl850.tagline).toBeTruthy();
  });

  it('keeps the offer and the disclaimer on every board it sheds from', () => {
    for (const size of doc.sizes) {
      expect(doc.layouts[size.id].offerMain, size.id).toBeTruthy();
      expect(doc.layouts[size.id].disclaimer, size.id).toBeTruthy();
    }
  });
});

describe('a new channel size costs nothing', () => {
  it('lays out a board the archetype has never seen', () => {
    // The point of the whole exercise. Under the hand-authored model this is
    // eleven new boxes, chosen by eye, per template.
    const skyscraper: AdSize = { id: 'sky', label: 'Wide Skyscraper 160×600', width: 160, height: 600 };
    const leaderboard: AdSize = { id: 'lead', label: 'Leaderboard 728×90', width: 728, height: 90 };
    const doc = youngSubaruSingleOffer([...YOUNG_SUBARU_SIZES, skyscraper, leaderboard]);

    for (const size of [skyscraper, leaderboard]) {
      const lay = doc.layouts[size.id];
      expect(lay, size.id).toBeTruthy();
      // The two things that must survive any board.
      expect(lay.offerMain, `${size.id} offer`).toBeTruthy();
      expect(lay.disclaimer, `${size.id} disclaimer`).toBeTruthy();
      expect(px(lay.disclaimer, size).h).toBeGreaterThanOrEqual(22);
      // Still on the board, still not colliding.
      const ids = CONTENT.filter((id) => lay[id]);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          expect(overlaps(lay[ids[i]], lay[ids[j]]), `${size.id}: ${ids[i]} vs ${ids[j]}`).toBe(false);
        }
      }
      expect(() => renderDoc(doc, enrichOfferFields(doc.defaults), size, { preview: false })).not.toThrow();
    }
  });

  it('sheds harder on a 728×90 than on a 1200×628', () => {
    const leaderboard: AdSize = { id: 'lead', label: 'Leaderboard', width: 728, height: 90 };
    const kept = (s: AdSize) => vehicleOfferArchetype.present(s, vehicleOfferArchetype.slots).size;
    expect(kept(leaderboard)).toBeLessThan(kept(YOUNG_SUBARU_SIZES[0]));
  });
});

describe('what the archetype replaces', () => {
  it('produces the same slots the hand-built Young Subaru doc places', () => {
    // Same anatomy, so the comparison is like-for-like: what changes is that
    // nobody typed the geometry.
    const arch = youngSubaruSingleOffer();
    const hand = youngSubaruSingleOfferDoc;
    const ids = (d: TemplateDoc) => new Set(d.elements.map((e) => e.id));
    for (const id of ids(hand)) expect(ids(arch).has(id), `missing slot ${id}`).toBe(true);
  });

  it('states the theme once instead of five layouts', () => {
    // The Subaru palette is the whole of what a designer chose here.
    expect(YOUNG_SUBARU_THEME.base).toBe('#199fdb');
    expect(YOUNG_SUBARU_THEME.brand).toBe('#0a3d8f');
    // And the doc it produces carries no hand-authored geometry: every box came
    // from the archetype, for every board, including ones added later.
    const doc = youngSubaruSingleOffer();
    expect(Object.keys(doc.layouts)).toHaveLength(5);
  });

  it('is theme-swappable — the same archetype, another store', () => {
    const ford: typeof YOUNG_SUBARU_THEME = {
      base: '#ffffff',
      brand: '#1c3f94',
      ink: '#101828',
      muted: '#475467',
      onBrand: '#ffffff',
      fade: { angle: 180, end: 45 },
    };
    const doc = buildArchetypeDoc(vehicleOfferArchetype, ford, YOUNG_SUBARU_SIZES, {
      id: 'young-ford-single',
      name: 'Young Ford — Single Offer',
    });
    const fill = doc.elements.find((e) => e.id === 'bgFill')!;
    expect(fill.fill).toBe('#1c3f94' === ford.brand ? ford.base : ford.base);
    expect(doc.elements.find((e) => e.id === 'offerMain')!.color).toBe(ford.brand);
    // Same geometry, different paint.
    expect(Object.keys(doc.layouts.fb)).toEqual(Object.keys(youngSubaruSingleOffer().layouts.fb));
  });
});
