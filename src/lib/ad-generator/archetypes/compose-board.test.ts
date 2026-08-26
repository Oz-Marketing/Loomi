import { describe, expect, it } from 'vitest';
import type { AdSize } from '../types';
import type { TemplateDoc } from '../doc-types';
import { addSizesToDoc } from '../size-ids';
import { composeBoard } from './theme';
import { docFromStart, archetypeStart, DEFAULT_SIZES } from './registry';
import { AD_SIZE_STARTERS } from '../ad-size-library';

/**
 * The bug this file exists for, in the designer's words: "I'll create a 500x1000,
 * but as soon as I visit the 2000x500, since it's vertical vs horizontal,
 * placement is whack."
 *
 * Rescaling preserved each element's SHAPE and could not do anything else, because
 * it had no idea it was moving an offer plate. These tests assert the archetype
 * gets to re-compose an added board instead.
 */

const PORTRAIT: AdSize = { id: '500x1000', label: 'Portrait 500×1000', width: 500, height: 1000 };
const STRIP: AdSize = { id: '2000x500', label: 'Strip 2000×500', width: 2000, height: 500 };

function portraitDoc(): TemplateDoc {
  const start = archetypeStart('vehicle-offer')!;
  return docFromStart(start, { id: 't1', name: 'T', sizes: [PORTRAIT] });
}

/** Add one board the way the builder does. */
function addBoard(doc: TemplateDoc, size: AdSize, from: string) {
  const { doc: next, addedIds } = addSizesToDoc(
    doc,
    [{ label: size.label, width: size.width, height: size.height }],
    from,
    (s) => composeBoard(doc, s),
  );
  return { doc: next, id: addedIds[0] };
}

describe('a board added to an archetype doc is composed, not rescaled', () => {
  it('lays the strip out for its OWN aspect, not the portrait it was added from', () => {
    const doc = portraitDoc();
    const { doc: next, id } = addBoard(doc, STRIP, PORTRAIT.id);

    // What the archetype would build for a 2000×500 from scratch is what the
    // added board should hold.
    const fresh = docFromStart(archetypeStart('vehicle-offer')!, { id: 't2', name: 'T', sizes: [STRIP] });
    expect(next.layouts[id]).toEqual(fresh.layouts[STRIP.id]);
  });

  it('does not simply copy the portrait geometry across', () => {
    const doc = portraitDoc();
    const { doc: next, id } = addBoard(doc, STRIP, PORTRAIT.id);
    expect(next.layouts[id]).not.toEqual(doc.layouts[PORTRAIT.id]);
  });

  it('keeps every box on the board', () => {
    const doc = portraitDoc();
    const { doc: next, id } = addBoard(doc, STRIP, PORTRAIT.id);
    for (const [elId, b] of Object.entries(next.layouts[id])) {
      expect(b.x, elId).toBeGreaterThanOrEqual(0);
      expect(b.y, elId).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w, elId).toBeLessThanOrEqual(1.0001);
      expect(b.y + b.h, elId).toBeLessThanOrEqual(1.0001);
    }
  });

  it('carries a hand-added layer across instead of dropping it', () => {
    const base = portraitDoc();
    // A layer the archetype knows nothing about — the case that makes composing
    // safe on a doc somebody has worked on.
    const doc: TemplateDoc = {
      ...base,
      elements: [...base.elements, { id: 'mine', type: 'text', name: 'Mine' }],
      layouts: { ...base.layouts, [PORTRAIT.id]: { ...base.layouts[PORTRAIT.id], mine: { x: 0.1, y: 0.1, w: 0.4, h: 0.1, z: 9 } } },
    };
    const { doc: next, id } = addBoard(doc, STRIP, PORTRAIT.id);
    expect(next.layouts[id].mine).toBeDefined();
    // …and it was re-fitted for the new board rather than cloned.
    expect(next.layouts[id].mine).not.toEqual(doc.layouts[PORTRAIT.id].mine);
  });

  it('does not resurrect a slot the designer deleted', () => {
    const base = portraitDoc();
    const doc: TemplateDoc = { ...base, elements: base.elements.filter((e) => e.id !== 'vehicle') };
    const { doc: next, id } = addBoard(doc, STRIP, PORTRAIT.id);
    expect(next.layouts[id].vehicle).toBeUndefined();
  });

  it('places every block on a newly added board too', () => {
    // A board added later is a board the designer has not arranged yet, so it owes
    // them the same complete set of blocks a starting board does — placed for its
    // OWN shape, not rescaled off whichever board happened to be open.
    const doc = portraitDoc();
    const tiny: AdSize = { id: '300x250', label: 'MPU', width: 300, height: 250 };
    const { doc: next, id } = addBoard(doc, tiny, PORTRAIT.id);
    const fresh = docFromStart(archetypeStart('vehicle-offer')!, { id: 't3', name: 'T', sizes: [tiny] });
    expect(next.layouts[id]).toEqual(fresh.layouts[tiny.id]);
    for (const el of doc.elements) {
      expect(next.layouts[id][el.id], `${el.id} missing on the added board`).toBeDefined();
    }
  });

  it('leaves a doc no archetype produced on the rescale path', () => {
    const plain: TemplateDoc = {
      id: 'p', name: 'Plain', sizes: [PORTRAIT], fields: [], elements: [{ id: 'a', type: 'text' }],
      layouts: { [PORTRAIT.id]: { a: { x: 0.1, y: 0.1, w: 0.5, h: 0.2, z: 1 } } }, defaults: {},
    };
    expect(composeBoard(plain, STRIP)).toBeNull();
    const { doc: next, id } = addBoard(plain, STRIP, PORTRAIT.id);
    expect(next.layouts[id].a).toBeDefined();
  });
});

describe('the default channel set', () => {
  it('gives every board a complete, in-bounds layout', () => {
    const doc = docFromStart(archetypeStart('vehicle-offer')!, { id: 't', name: 'T' });
    expect(doc.sizes).toHaveLength(DEFAULT_SIZES.length);
    expect(DEFAULT_SIZES.length).toBeGreaterThan(3);
    for (const size of DEFAULT_SIZES) {
      const layout = doc.layouts[size.id];
      expect(layout, size.id).toBeDefined();
      // The disclaimer is never shed, at any size.
      expect(layout.disclaimer, size.id).toBeDefined();
      for (const [elId, b] of Object.entries(layout)) {
        expect(b.x + b.w, `${size.id}/${elId}`).toBeLessThanOrEqual(1.0001);
        expect(b.y + b.h, `${size.id}/${elId}`).toBeLessThanOrEqual(1.0001);
      }
    }
  });

  /**
   * THE TEST THAT EARNS ITS KEEP, restated for what this archetype now promises.
   *
   * It used to assert every block cleared its LEGIBILITY floor on every board,
   * which was the right guarantee while the archetype produced a finished
   * composition — a 728x90 leaderboard slipped in once and shipped an 18px offer
   * figure that no in-bounds check noticed.
   *
   * The archetype no longer composes; it places blocks for a designer to arrange.
   * So legibility is theirs to settle, and two boards genuinely cannot hold every
   * block at the old floors (a 600x200 email header, a 300x250 dual). What must
   * still be true is weaker but real, and it is what makes the starting point
   * USABLE rather than merely present: every block exists, sits on the board,
   * overlaps nothing, and is big enough to see and grab.
   */
  it('offers every size in the library, not a curated few', () => {
    // The library is the catalogue; the designer switches off what a template is
    // not for. Curating here made them re-add by hand the boards we had decided
    // on their behalf they would not want.
    expect(DEFAULT_SIZES).toHaveLength(AD_SIZE_STARTERS.length);
    expect(new Set(DEFAULT_SIZES.map((s) => s.id)).size).toBe(DEFAULT_SIZES.length);
  });

  it('puts every block on every board, in bounds, grabbable and not overlapping', () => {
    const GRAB_PX = 8;
    for (const startId of ['vehicle-offer', 'two-vehicles'] as const) {
      const doc = docFromStart(archetypeStart(startId)!, { id: 't', name: 'T' });
      for (const size of DEFAULT_SIZES) {
        const layout = doc.layouts[size.id];
        // Every declared element is placed — nothing is silently missing.
        for (const el of doc.elements) {
          expect(layout[el.id], `${startId}/${size.id}: ${el.id} unplaced`).toBeDefined();
        }
        const arrangeable = Object.entries(layout).filter(
          ([id]) => !id.startsWith('bg') && id !== 'brandBand' && id !== 'plateDivider',
        );
        for (const [id, b] of arrangeable) {
          expect(b.x, `${startId}/${size.id}/${id} x`).toBeGreaterThanOrEqual(-1e-6);
          expect(b.y, `${startId}/${size.id}/${id} y`).toBeGreaterThanOrEqual(-1e-6);
          expect(b.x + b.w, `${startId}/${size.id}/${id} right`).toBeLessThanOrEqual(1 + 1e-3);
          expect(b.y + b.h, `${startId}/${size.id}/${id} bottom`).toBeLessThanOrEqual(1 + 1e-3);
          expect(
            Math.round(b.h * size.height),
            `${startId}/${size.id}/${id} too small to grab`,
          ).toBeGreaterThanOrEqual(GRAB_PX);
        }
        for (let i = 0; i < arrangeable.length; i++) {
          for (let j = i + 1; j < arrangeable.length; j++) {
            const [idA, a] = arrangeable[i], [idB, b] = arrangeable[j];
            const eps = 1e-6;
            const hit =
              a.x < b.x + b.w - eps && b.x < a.x + a.w - eps &&
              a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
            expect(hit, `${startId}/${size.id}: ${idA} overlaps ${idB}`).toBe(false);
          }
        }
      }
    }
  });

  it('keeps the disclaimer present and capped as fine print on every board', () => {
    for (const startId of ['vehicle-offer', 'two-vehicles'] as const) {
      const doc = docFromStart(archetypeStart(startId)!, { id: 't', name: 'T' });
      for (const size of DEFAULT_SIZES) {
        const d = doc.layouts[size.id].disclaimer;
        expect(d, `${startId}/${size.id} disclaimer`).toBeDefined();
        // The FRAME has no floor — a small board carrying every block cannot give
        // the legal text a generous one, and the designer resizes it anyway. What
        // must hold is the CEILING on its type, which is what keeps a co-op
        // paragraph from setting itself at headline size.
        expect(d.fontSize, `${startId}/${size.id} disclaimer cap`).toBeLessThanOrEqual(16);
        // No lower bound. On a small board carrying every block the disclaimer's
        // row is only ~10px, and the cap is clamped to its own frame — a ceiling
        // above the box it caps would be a number that does nothing. The template
        // audit is what flags that board as still needing arranging.
        expect(d.fontSize!, `${startId}/${size.id} cap vs frame`).toBeLessThanOrEqual(
          d.h * size.height + 0.5,
        );
      }
    }
  });

  it('has no duplicate board ids', () => {
    const ids = DEFAULT_SIZES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
