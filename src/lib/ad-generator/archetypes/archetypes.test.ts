import { describe, it, expect } from 'vitest';
import { youngSubaruSingleOffer, youngSubaruDualOffer, YOUNG_SUBARU_THEME } from './young-subaru-archetype';
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

/** The archetypes under test. Same family, different offer count. */
const single = vehicleOfferArchetype(1);
const dual = vehicleOfferArchetype(2);

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
      const present = single.present(size, single.slots);
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
      apr: ['APR', '1.9%', 'for 60 months'], // the label carries the word, the figure doesn't repeat it
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

describe('the offer blocks keep a sane relative order and size', () => {
  const doc = youngSubaruSingleOffer();

  it('keeps the figure dominant over the label and terms everywhere', () => {
    for (const size of doc.sizes) {
      const lay = doc.layouts[size.id];
      const main = px(lay.offerMain, size).h;
      const label = px(lay.offerLabel, size).h;
      const terms = px(lay.offerTerms, size).h;
      expect(main, `${size.id}: figure vs label`).toBeGreaterThan(label);
      expect(main, `${size.id}: figure vs terms`).toBeGreaterThan(terms);
      // No absolute legibility floor any more. These are unarranged blocks, so how
      // big the number ends up is the designer's call; all the stack owes is that
      // the figure starts with more room than the lines around it.
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

describe('every block lands on every board', () => {
  const doc = youngSubaruSingleOffer();

  it('carries no tagline or expiration slot at all, on any board', () => {
    // Both left the composition on the designers' say-so — "we never use
    // taglines", "the expiration usually just goes into the disclaimer". The
    // fields remain bindable; the composition simply stops assuming them.
    for (const size of doc.sizes) {
      expect(doc.layouts[size.id].tagline, size.id).toBeUndefined();
      expect(doc.layouts[size.id].expiration, size.id).toBeUndefined();
    }
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
      // No 22px frame guarantee: a 728x90 carrying seven stacked blocks cannot
      // give the disclaimer one, and it does not need to — the designer arranges
      // before it ships. The `fontSize` ceiling still holds, which is the part
      // that keeps legal text legal.
      expect(lay.disclaimer.fontSize!, `${size.id} disclaimer cap`).toBeLessThanOrEqual(16);
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

});

describe('what the archetype replaces', () => {
  it('produces the same slots the hand-built Young Subaru doc places', () => {
    // Same anatomy, so the comparison is like-for-like: what changes is that
    // nobody typed the geometry.
    //
    // Except the expiration pill, which the archetype deliberately no longer
    // carries — Young's designers put the date in the disclaimer, where the
    // manufacturer's own wording already composes it.
    // The backdrop layers and the brand band went with the composition — the
    // starting point is plain blocks now, and a background fill is not a block a
    // designer arranges. The expiration pill and tagline were dropped earlier, on
    // Young's designers' say-so.
    const dropped = new Set(['expiration', 'tagline', 'bgFill', 'bgTexture', 'bgFade']);
    const arch = youngSubaruSingleOffer();
    const hand = youngSubaruSingleOfferDoc;
    const ids = (d: TemplateDoc) => new Set(d.elements.map((e) => e.id));
    for (const id of ids(hand)) {
      if (dropped.has(id)) continue;
      expect(ids(arch).has(id), `missing slot ${id}`).toBe(true);
    }
    for (const id of dropped) expect(ids(arch).has(id), `${id} should be gone`).toBe(false);
  });

  it('carries no hand-authored geometry — every box is derived', () => {
    // The Subaru palette is the whole of what a designer chose here.
    expect(YOUNG_SUBARU_THEME.base).toBe('#199fdb');
    expect(YOUNG_SUBARU_THEME.brand).toBe('#0a3d8f');
    // And the doc it produces carries no hand-authored geometry: every box came
    // from the archetype, for every board, including ones added later.
    const doc = youngSubaruSingleOffer();
    expect(Object.keys(doc.layouts)).toHaveLength(5);
  });

});


// ── DUAL ────────────────────────────────────────────────────────────────────

/** Both plates' content slots, for the symmetry checks. */
const PLATE_PARTS = ['vehicleName', 'offerLabel', 'offerMain', 'offerTerms'];
const DUAL_CONTENT = ['logo', 'tagline', 'expiration', 'disclaimer', ...PLATE_PARTS, ...PLATE_PARTS.map((p) => `o2_${p}`)];

describe('two offers are the same archetype, not a second implementation', () => {
  const doc = youngSubaruDualOffer();

  it('declares one plate per offer, bound to that offer own fields', () => {
    const figures = doc.elements.filter((e) => /offerMain$/.test(e.id));
    expect(figures.map((e) => e.id)).toEqual(['offerMain', 'o2_offerMain']);
    expect(figures[0].binding).toEqual({ kind: 'field', key: '_offerMain' });
    expect(figures[1].binding).toEqual({ kind: 'field', key: '_o2_offerMain' });
  });

  it('still carries no conditional visibility', () => {
    for (const el of doc.elements) expect(el.visibleWhen, el.id).toBeUndefined();
  });

  it('gives each offer its own product shot', () => {
    // It used to give neither, on the reasoning that "two cars in a 300x250 is
    // mush". The mush is real; the conclusion was too broad. A 300x250 sheds both
    // shots by the density rule anyway, and every board above it has room for two
    // — so withholding them everywhere meant a comparison of two VEHICLES never
    // showed a vehicle.
    expect(doc.elements.find((e) => e.id === 'vehicle')).toBeDefined();
    expect(doc.elements.find((e) => e.id === 'o2_vehicle')).toBeDefined();
    // Each bound to its own side of the twin-field schema.
    const second = doc.elements.find((e) => e.id === 'o2_vehicle')!;
    expect(second.binding).toEqual({ kind: 'field', key: 'o2_vehicleImageUrl' });
  });

  it('renders two DIFFERENT offer types at once', () => {
    // The case the twin-field model made awkward: a lease beside an APR.
    const size = bySize(doc, 'fb');
    const html = renderDoc(
      doc,
      enrichOfferFields({
        ...doc.defaults,
        offerType: 'lease',
        monthlyPayment: '299',
        leaseTerm: '36',
        o2_offerType: 'apr',
        o2_aprRate: '1.9',
        o2_aprTerm: '60',
      }),
      size,
      { preview: false },
    );
    expect(html).toContain('$299/mo');
    expect(html).toContain('PER MONTH LEASE');
    expect(html).toContain('1.9%');
  });
});

describe('the two plates are comparable', () => {
  const doc = youngSubaruDualOffer();

  it('gives both plates the same size on every board', () => {
    // A comparison whose halves are different sizes is not a comparison.
    for (const size of doc.sizes) {
      const lay = doc.layouts[size.id];
      for (const part of PLATE_PARTS) {
        const a = lay[part];
        const b = lay[`o2_${part}`];
        if (!a || !b) {
          expect(!!a, `${size.id}: ${part} present on one side only`).toBe(!!b);
          continue;
        }
        // Equal to within the 1e-4 grid boxes are STORED on — not to arbitrary
        // precision. In a stacked dual the two plates sit at different y, so
        // their heights can land on adjacent grid steps: 0.06px on a 600px
        // board. `toBeCloseTo(_, 4)` demanded 5e-5, which is finer than the
        // format can represent, so it was asserting something unachievable
        // rather than something true.
        const STEP = 1e-4 + 1e-9;
        expect(Math.abs(a.w - b.w), `${size.id}/${part} width`).toBeLessThanOrEqual(STEP);
        expect(Math.abs(a.h - b.h), `${size.id}/${part} height`).toBeLessThanOrEqual(STEP);
      }
    }
  });

  it('gives both plates the same blocks, never one side only', () => {
    for (const size of doc.sizes) {
      const lay = doc.layouts[size.id];
      for (const part of PLATE_PARTS) {
        expect(!!lay[part], `${size.id}/${part}`).toBe(!!lay[`o2_${part}`]);
      }
    }
  });

  it('lays both offers out the same way, whatever the board', () => {
    // The two-column split is gone: choosing that two offers sit side by side is
    // an arrangement, and arranging is the designer's job. Both plates now stack
    // in one column like every other block, so all the pairing owes is that each
    // offer's blocks keep the same internal order.
    for (const size of doc.sizes) {
      const lay = doc.layouts[size.id];
      for (const p of ['', 'o2_']) {
        expect(lay[`${p}offerLabel`].y, `${size.id} ${p}label→figure`).toBeLessThan(lay[`${p}offerMain`].y);
        expect(lay[`${p}offerMain`].y, `${size.id} ${p}figure→terms`).toBeLessThan(lay[`${p}offerTerms`].y);
      }
      // Offer 1 comes before offer 2, always.
      expect(lay.offerMain.y, `${size.id} order`).toBeLessThan(lay.o2_offerMain.y);
    }
  });

  it('keeps each plate a lockup — nothing lands inside one', () => {
    for (const size of doc.sizes) {
      const lay = doc.layouts[size.id];
      for (const p of ['', 'o2_']) {
        const rows = PLATE_PARTS.map((x) => lay[`${p}${x}`]).filter(Boolean);
        const top = Math.min(...rows.map((r) => r.y));
        const bottom = Math.max(...rows.map((r) => r.y + r.h));
        const mine = new Set(PLATE_PARTS.map((x) => `${p}${x}`));
        for (const id of DUAL_CONTENT) {
          if (mine.has(id) || !lay[id]) continue;
          const b = lay[id];
          const inside = b.y > top + 1e-4 && b.y + b.h < bottom - 1e-4;
          // The other plate sits beside this one on a wide board, so only a
          // vertical overlap counts as intrusion when they share a column.
          const sameColumn = Math.abs(b.x - rows[0].x) < 1e-4;
          expect(inside && sameColumn, `${size.id}: ${id} inside the ${p || 'first'} plate`).toBe(false);
        }
      }
    }
  });
});

describe('the dual is complete and clean on every board', () => {
  const doc = youngSubaruDualOffer();

  it('keeps every box on the board and never overlaps content', () => {
    for (const size of doc.sizes) {
      const lay = doc.layouts[size.id];
      for (const [id, b] of Object.entries(lay)) {
        expect(b.x + b.w, `${size.id}/${id} right`).toBeLessThanOrEqual(1 + 1e-3);
        expect(b.y + b.h, `${size.id}/${id} bottom`).toBeLessThanOrEqual(1 + 1e-3);
      }
      const ids = DUAL_CONTENT.filter((id) => lay[id]);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          expect(overlaps(lay[ids[i]], lay[ids[j]]), `${size.id}: ${ids[i]} vs ${ids[j]}`).toBe(false);
        }
      }
    }
  });

  it('lays out a board it has never seen', () => {
    const sky: AdSize = { id: 'sky', label: 'Skyscraper 160×600', width: 160, height: 600 };
    const d = youngSubaruDualOffer([...YOUNG_SUBARU_SIZES, sky]);
    const lay = d.layouts.sky;
    expect(lay.offerMain).toBeTruthy();
    expect(lay.o2_offerMain).toBeTruthy();
    expect(lay.disclaimer).toBeTruthy();
    expect(() => renderDoc(d, enrichOfferFields(d.defaults), sky, { preview: false })).not.toThrow();
  });

  it('needs one number and a fade angle to differ from the single', () => {
    // The whole difference between the two docs, which the hand-built pair states
    // as two element lists and ten layouts.
    expect(dual.slots.filter((s) => /offerMain$/.test(s.id))).toHaveLength(2);
    expect(single.slots.filter((s) => /offerMain$/.test(s.id))).toHaveLength(1);
  });
});

describe('nothing an archetype builds is sized in fixed pixels', () => {
  /**
   * The trap this catches, found on the Google 300×250: `padding` is emitted as
   * literal px on every board, so a pill inset that is comfortable at 1200×628
   * ate 24 of the 30 pixels the same pill gets at 300×250 and shrank the
   * expiration date to six. Every inset an archetype wants has to come from the
   * layout (which knows the board) or from the renderer's board-relative default —
   * never from a number on the element.
   */
  for (const [label, arch] of [
    ['single', vehicleOfferArchetype(1)],
    ['dual', vehicleOfferArchetype(2)],
  ] as const) {
    it(`${label}: no slot sets padding`, () => {
      for (const slot of arch.slots) {
        const el = slot.build(YOUNG_SUBARU_THEME);
        expect(el.padding, `${slot.id} padding`).toBeUndefined();
        expect(el.paddingTop, `${slot.id} paddingTop`).toBeUndefined();
        expect(el.paddingRight, `${slot.id} paddingRight`).toBeUndefined();
        expect(el.paddingBottom, `${slot.id} paddingBottom`).toBeUndefined();
        expect(el.paddingLeft, `${slot.id} paddingLeft`).toBeUndefined();
      }
    });

    it(`${label}: no box states a font size except the disclaimer's cap`, () => {
      // Same reason, one level up: `fontSize` on a layout box is px on that board.
      // Type is FITTED to its frame instead, so the frame is the only thing an
      // archetype has to get right and the size follows from the board.
      //
      // The disclaimer is the exception, and it earns it: it is the one slot that
      // HOLDS its type rather than fitting it (a paragraph of unknown length in a
      // fixed strip), so it needs a ceiling — and the ceiling is derived from the
      // board's short edge, not typed in. What the rule forbids is a constant.
      const doc = buildArchetypeDoc(arch, YOUNG_SUBARU_THEME, YOUNG_SUBARU_SIZES, {
        id: 't',
        name: 'T',
      });
      const caps = new Set<number>();
      for (const [sizeId, boxes] of Object.entries(doc.layouts)) {
        for (const [id, b] of Object.entries(boxes)) {
          if (id === 'disclaimer') {
            const size = YOUNG_SUBARU_SIZES.find((s) => s.id === sizeId)!;
            // No lower bound: on a small board carrying every block the frame is
            // only ~10px, and a ceiling above its own frame would be meaningless.
            // The audit flags the legibility; this only checks the cap is honest.
            // 16px ceiling: fine print has to be legible, not prominent.
            expect(b.fontSize, `${sizeId}/disclaimer cap`).toBeLessThanOrEqual(16);
            // And it has to FIT the strip it caps, or the cap is a lie.
            expect(b.fontSize!, `${sizeId}/disclaimer cap vs strip`).toBeLessThanOrEqual(
              b.h * size.height,
            );
            caps.add(b.fontSize!);
            continue;
          }
          expect(b.fontSize, `${sizeId}/${id}`).toBeUndefined();
        }
      }
      // Derived, not constant: five boards of different short edges must not all
      // land on one number.
      expect(caps.size, 'the cap should vary with the board').toBeGreaterThan(1);
    });
  }
});
