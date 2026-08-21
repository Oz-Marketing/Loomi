import { describe, it, expect } from 'vitest';
import { buildBlockPayload, insertBlockIntoDoc, blockFitsKind } from './blocks';
import { offerKind } from './offer-kinds';
import type { TemplateDoc } from './doc-types';

/** A minimal two-size doc with an offer block (main/label/terms) + a logo. */
function makeDoc(): TemplateDoc {
  return {
    id: 't1',
    name: 'T1',
    sizes: [
      { id: 's1', label: 'Square', width: 1080, height: 1080 },
      { id: 's2', label: 'Wide', width: 1200, height: 540 },
    ],
    fields: [{ key: 'headline', label: 'Headline', type: 'text' }],
    elements: [
      { id: 'text-main', type: 'text', binding: { kind: 'field', key: '_offerMain' } },
      { id: 'text-label', type: 'text', binding: { kind: 'field', key: '_offerLabel' } },
      { id: 'text-terms', type: 'text', binding: { kind: 'field', key: '_offerTerms' } },
      { id: 'logo-1', type: 'logo', binding: { kind: 'brand', key: 'logoUrl' } },
    ],
    layouts: {
      s1: {
        'text-main': { x: 0.1, y: 0.4, w: 0.5, h: 0.2, z: 2, fontSize: 80 },
        'text-label': { x: 0.62, y: 0.4, w: 0.2, h: 0.1, z: 3, fontSize: 24 },
        'text-terms': { x: 0.1, y: 0.62, w: 0.6, h: 0.08, z: 4, fontSize: 20 },
        'logo-1': { x: 0.1, y: 0.1, w: 0.3, h: 0.1, z: 1 },
      },
      s2: {
        'text-main': { x: 0.1, y: 0.4, w: 0.5, h: 0.2, z: 2, fontSize: 60 },
        'text-label': { x: 0.62, y: 0.4, w: 0.2, h: 0.1, z: 3, fontSize: 18 },
        'text-terms': { x: 0.1, y: 0.62, w: 0.6, h: 0.08, z: 4, fontSize: 16 },
        'logo-1': { x: 0.1, y: 0.1, w: 0.3, h: 0.1, z: 1 },
      },
    },
    defaults: { headline: 'Hi' },
  };
}

describe('buildBlockPayload', () => {
  it('captures the selected offer elements + boxes and flags the offer kit', () => {
    const doc = makeDoc();
    const payload = buildBlockPayload(doc, ['text-main', 'text-label', 'text-terms'], 's1')!;
    expect(payload).not.toBeNull();
    expect(payload.elements.map((e) => e.id)).toEqual(['text-main', 'text-label', 'text-terms']);
    expect(payload.boxes['text-main']).toMatchObject({ x: 0.1, y: 0.4, fontSize: 80 });
    expect(payload.sourceSize).toEqual({ w: 1080, h: 1080 });
    expect(payload.offerKit).toBe('single'); // bound to _offerMain/_offerLabel/_offerTerms
  });

  it('detects a dual offer kit from _o2_ bindings', () => {
    const doc = makeDoc();
    doc.elements.push({ id: 'text-o2', type: 'text', binding: { kind: 'field', key: '_o2_offerMain' } });
    doc.layouts.s1['text-o2'] = { x: 0.1, y: 0.8, w: 0.4, h: 0.1, z: 5 };
    const payload = buildBlockPayload(doc, ['text-main', 'text-o2'], 's1')!;
    expect(payload.offerKit).toBe('dual');
  });

  it('returns null when nothing is selected', () => {
    expect(buildBlockPayload(makeDoc(), [], 's1')).toBeNull();
  });
});

describe('insertBlockIntoDoc', () => {
  it('appends elements with fresh ids on EVERY size, scaling the block as a whole', () => {
    const doc = makeDoc();
    const payload = buildBlockPayload(doc, ['text-main', 'text-label', 'text-terms'], 's1')!;

    let n = 0;
    const target = makeDoc();
    const { doc: next, newIds } = insertBlockIntoDoc(target, payload, (type) => `${type}-new${n++}`);

    // 4 original + 3 inserted
    expect(next.elements).toHaveLength(7);
    expect(newIds).toHaveLength(3);
    // Present on both sizes
    for (const id of newIds) {
      expect(next.layouts.s1[id]).toBeTruthy();
      expect(next.layouts.s2[id]).toBeTruthy();
    }
    // The frame and the type scale TOGETHER, by the width ratio (1200/1080).
    // Type used to scale by HEIGHT (→40) while the frame's fractions were copied
    // untouched, so on this wide board the box grew wider and the words shrank —
    // the two moved in opposite directions and the block came apart.
    const mainId = newIds[0];
    const s1Box = next.layouts.s1[mainId];
    const s2Box = next.layouts.s2[mainId];
    expect(s1Box.fontSize).toBe(80); // same-size, no scale
    expect(s2Box.fontSize).toBe(89); // 80 × 1200/1080
    // …and the box keeps its shape: same on-screen aspect ratio on both boards.
    const aspect = (b: { w: number; h: number }, w: number, h: number) => (b.w * w) / (b.h * h);
    expect(aspect(s2Box, 1200, 540)).toBeCloseTo(aspect(s1Box, 1080, 1080), 5);
    // nudged so it doesn't sit exactly on the original
    expect(next.layouts.s1[mainId].x).toBeCloseTo(0.13, 5);
    // stacked above existing content
    expect(next.layouts.s1[mainId].z).toBeGreaterThan(4);
  });

  it('holds the lockup together — internal gaps scale with the block, not the board', () => {
    // THE bug this exists for. Every member's `y` used to be copied as a fraction
    // of its own board's HEIGHT, so on a taller board they drifted apart and on a
    // squat one they collided. Measured on the shipped "Sale Price" block from one
    // insert: 43px between the price and the MSRP line on a 1080×1080, 261px on a
    // 1080×1920, and −1px (overlapping) on a 300×250.
    const payload = buildBlockPayload(makeDoc(), ['text-main', 'text-label', 'text-terms'], 's1')!;
    const target: TemplateDoc = {
      ...makeDoc(),
      sizes: [
        { id: 'sq', label: 'Square', width: 1080, height: 1080 },
        { id: 'story', label: 'Story', width: 1080, height: 1920 },
        { id: 'med', label: 'Medium', width: 300, height: 250 },
      ],
      layouts: { sq: {}, story: {}, med: {} },
    };
    let n = 0;
    const { doc: next, newIds } = insertBlockIntoDoc(target, payload, (t) => `${t}-n${n++}`);
    const [mainId, , termsId] = newIds;

    // The gap between the price and its terms, in px, per board.
    const gap = (sid: string, h: number) => {
      const main = next.layouts[sid][mainId];
      const terms = next.layouts[sid][termsId];
      return terms.y * h - (main.y + main.h) * h;
    };
    const px = (sid: string, id: string, w: number) => next.layouts[sid][id].w * w;

    // Same width → the block is the same size, so the gap is IDENTICAL (not 6×).
    expect(gap('story', 1920)).toBeCloseTo(gap('sq', 1080), 4);
    expect(px('story', mainId, 1080)).toBeCloseTo(px('sq', mainId, 1080), 4);
    // Quarter the width → everything, gap included, is a quarter the size.
    const k = 300 / 1080;
    expect(gap('med', 250)).toBeCloseTo(gap('sq', 1080) * k, 4);
    expect(px('med', mainId, 300)).toBeCloseTo(px('sq', mainId, 1080) * k, 4);
    // The invariant that matters to a designer: the gap is the same multiple of
    // the type size on every board.
    const ratio = (sid: string, h: number) => gap(sid, h) / next.layouts[sid][mainId].fontSize!;
    expect(ratio('story', 1920)).toBeCloseTo(ratio('sq', 1080), 1);
    expect(ratio('med', 250)).toBeCloseTo(ratio('sq', 1080), 1);
  });

  it('shrinks a lockup that would not fit, rather than letting it run off', () => {
    // Type and panels: overflow here is a CUT, not a crop. A block authored down
    // the full height of a square has to come in to land on a leaderboard.
    const src = makeDoc();
    src.layouts.s1['text-main'] = { x: 0.1, y: 0.05, w: 0.5, h: 0.4, z: 2, fontSize: 80 };
    src.layouts.s1['text-terms'] = { x: 0.1, y: 0.55, w: 0.6, h: 0.4, z: 4, fontSize: 20 };
    const payload = buildBlockPayload(src, ['text-main', 'text-terms'], 's1')!;
    const target: TemplateDoc = {
      ...makeDoc(),
      sizes: [{ id: 'lb', label: 'Leaderboard', width: 728, height: 90 }],
      layouts: { lb: {} },
    };
    let n = 0;
    const { doc: next, newIds } = insertBlockIntoDoc(target, payload, (t) => `${t}-n${n++}`);
    for (const id of newIds) {
      const b = next.layouts.lb[id];
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.h).toBeLessThanOrEqual(1.0001);
    }
    // Uniform: the block kept its shape on the way down.
    const [mainId] = newIds;
    const srcBox = src.layouts.s1['text-main'];
    const out = next.layouts.lb[mainId];
    expect((out.w * 728) / (out.h * 90)).toBeCloseTo((srcBox.w * 1080) / (srcBox.h * 1080), 4);
  });

  it('leaves scenery out of the lockup — a bleeding backdrop still fills the board', () => {
    const src = makeDoc();
    src.elements.push({ id: 'img-bg', type: 'image', fit: 'cover' });
    src.layouts.s1['img-bg'] = { x: 0, y: 0, w: 1, h: 1, z: 0 };
    const payload = buildBlockPayload(src, ['img-bg', 'text-main', 'text-terms'], 's1')!;
    const target: TemplateDoc = {
      ...makeDoc(),
      sizes: [{ id: 'story', label: 'Story', width: 1080, height: 1920 }],
      layouts: { story: {} },
    };
    let n = 0;
    const { doc: next, newIds } = insertBlockIntoDoc(target, payload, (t) => `${t}-n${n++}`);
    // Payload order follows the DOC's element order, and the backdrop was pushed
    // on last — so it's the last new id, not the first.
    const bg = next.layouts.story[newIds[newIds.length - 1]];
    // Edge to edge, un-nudged: it's scenery, not a member holding a position.
    expect(bg.x).toBe(0);
    expect(bg.w).toBe(1);
    // …and the two text members still sit tight to each other, not spread over
    // the whole (now full-canvas) bounding box.
    const main = next.layouts.story[newIds[0]];
    const terms = next.layouts.story[newIds[1]];
    expect(main.y).toBeLessThan(0.5);
    // The gap between them is the source gap (same width), not stretched over the
    // full canvas the backdrop covers.
    const srcGap = (0.62 - (0.4 + 0.2)) * 1080;
    expect(terms.y * 1920 - (main.y + main.h) * 1920).toBeCloseTo(srcGap, 3);
  });

  it('re-seeds the offer field kit so bindings resolve in a blank doc', () => {
    const payload = buildBlockPayload(makeDoc(), ['text-main', 'text-label', 'text-terms'], 's1')!;
    const blank: TemplateDoc = {
      id: 'b',
      name: 'Blank',
      sizes: [{ id: 'z1', label: 'Sq', width: 1080, height: 1080 }],
      fields: [],
      elements: [],
      layouts: { z1: {} },
      defaults: {},
    };
    let n = 0;
    const { doc: next } = insertBlockIntoDoc(blank, payload, (t) => `${t}-x${n++}`);
    // addFieldKit('single') pulled in the offer question set
    expect(next.fields.some((f) => f.key === 'offerType')).toBe(true);
    expect(next.fields.length).toBeGreaterThan(3);
  });

  it('drops a DANGLING group ref (groupId with no group def)', () => {
    const doc = makeDoc();
    doc.elements[0].groupId = 'g-old'; // no matching entry in doc.groups
    const payload = buildBlockPayload(doc, ['text-main'], 's1')!;
    expect(payload.groups).toEqual([]); // nothing captured
    let n = 0;
    const { doc: next, newIds } = insertBlockIntoDoc(makeDoc(), payload, (t) => `${t}-y${n++}`);
    const inserted = next.elements.find((e) => e.id === newIds[0])!;
    expect(inserted.groupId).toBeUndefined();
  });

  it('preserves grouping — re-creates the captured group with a fresh id', () => {
    const doc = makeDoc();
    doc.groups = [{ id: 'g1', name: 'Offer' }];
    doc.elements[0].groupId = 'g1'; // text-main
    doc.elements[1].groupId = 'g1'; // text-label
    const payload = buildBlockPayload(doc, ['text-main', 'text-label'], 's1')!;
    expect(payload.groups).toEqual([{ id: 'g1', name: 'Offer' }]);

    let n = 0;
    const { doc: next, newIds } = insertBlockIntoDoc(makeDoc(), payload, (t) => `${t}-z${n++}`);
    const inserted = next.elements.filter((e) => newIds.includes(e.id));
    const gids = new Set(inserted.map((e) => e.groupId));
    expect(gids.size).toBe(1); // both inserted elements share ONE group
    const newGid = [...gids][0]!;
    expect(newGid).not.toBe('g1'); // fresh id, not the source group's
    expect(next.groups?.find((g) => g.id === newGid)?.name).toBe('Offer');
  });

  it('preserves NESTED grouping — captures + remaps ancestor groups', () => {
    const doc = makeDoc();
    doc.groups = [
      { id: 'outer', name: 'Outer' },
      { id: 'inner', name: 'Inner', parentId: 'outer' },
    ];
    doc.elements[0].groupId = 'inner';
    const payload = buildBlockPayload(doc, ['text-main'], 's1')!;
    // both the inner group AND its ancestor are captured
    expect(new Set(payload.groups!.map((g) => g.id))).toEqual(new Set(['inner', 'outer']));

    let n = 0;
    const { doc: next, newIds } = insertBlockIntoDoc(makeDoc(), payload, (t) => `${t}-w${n++}`);
    const inner = next.groups!.find((g) => g.name === 'Inner')!;
    const outer = next.groups!.find((g) => g.name === 'Outer')!;
    expect(inner.parentId).toBe(outer.id); // nesting remapped to the new outer id
    expect(next.elements.find((e) => e.id === newIds[0])!.groupId).toBe(inner.id);
  });
});


describe('a block may never widen the doc schema past its offer kind', () => {
  /**
   * A vehicle offer block: carries the offer kit AND vehicle required fields.
   *
   * Deliberately a DUAL kit. A `single` kit is invisible on a vehicle doc — those
   * fields are already in the schema, so the merge is a no-op and the test
   * couldn't tell "merged" from "skipped". The `o2_*` fields only arrive via the
   * kit, which makes the merge observable either way.
   */
  function vehicleBlock() {
    const doc = makeDoc();
    doc.elements.push({ id: 'text-o2', type: 'text', binding: { kind: 'field', key: '_o2_offerMain' } });
    doc.layouts.s1['text-o2'] = { x: 0.1, y: 0.8, w: 0.4, h: 0.1, z: 5 };
    const payload = buildBlockPayload(doc, ['text-main', 'text-label', 'text-o2'], 's1')!;
    expect(payload.offerKit).toBe('dual');
    payload.requiredFields = [
      { key: 'msrp', label: 'MSRP', type: 'text' },
      { key: 'vin', label: 'VIN', type: 'text' },
    ];
    payload.requiredDefaults = { msrp: '34000', vin: '' };
    return payload;
  }

  it('refuses to graft the vehicle schema onto a custom offer', () => {
    // The seeded "Lease" / "APR offer" / "Vehicle offer block" rows all carry
    // `offerKit: 'single'` plus vehicle required fields. Before offer kinds
    // existed every doc had the vehicle schema anyway, so this merge was free;
    // now it would corrupt a custom-offer template.
    const custom: TemplateDoc = {
      ...makeDoc(),
      offerKind: 'custom',
      fields: offerKind('custom').fields,
      defaults: {},
    };
    const { doc: next, newIds } = insertBlockIntoDoc(custom, vehicleBlock(), (t) => `${t}-new`);
    const keys = next.fields.map((f) => f.key);
    expect(keys).not.toContain('msrp');
    expect(keys).not.toContain('vin');
    expect(keys).not.toContain('monthlyPayment');
    expect(keys).not.toContain('o2_offerType'); // the offer kit was skipped too
    // `offerType` IS legitimately in the custom schema — the kind has offer types
    // of its own. What must not arrive is the VEHICLE offer's fields.
    expect(keys).toContain('offerType');
    expect(next.defaults.msrp).toBeUndefined();
    // The ELEMENTS still insert — a blank binding is visible and fixable, a
    // silently mutated schema is neither.
    expect(newIds.length).toBe(3);
    expect(next.elements.length).toBe(custom.elements.length + 3);
  });

  it('still merges both on a vehicle doc, exactly as before', () => {
    const vehicle: TemplateDoc = {
      ...makeDoc(),
      offerKind: 'vehicle',
      fields: offerKind('vehicle').fields,
      defaults: {},
    };
    const { doc: next } = insertBlockIntoDoc(vehicle, vehicleBlock(), (t) => `${t}-new`);
    const keys = next.fields.map((f) => f.key);
    expect(keys).toContain('msrp'); // already in the vehicle schema
    expect(keys).toContain('offerType');
    expect(keys).toContain('o2_offerType'); // the dual kit the block asked for
  });

  it('treats a doc with no offerKind as vehicle, so nothing regresses', () => {
    const legacy = { ...makeDoc(), fields: offerKind('vehicle').fields, defaults: {} };
    const { doc: next } = insertBlockIntoDoc(legacy, vehicleBlock(), (t) => `${t}-new`);
    expect(next.fields.map((f) => f.key)).toContain('o2_offerType');
  });
});

describe('blockFitsKind', () => {
  it('keeps a vehicle offer block out of the list for the custom kind', () => {
    const payload = buildBlockPayload(makeDoc(), ['text-main'], 's1')!;
    expect(blockFitsKind(payload, offerKind('vehicle'))).toBe(true);
    expect(blockFitsKind(payload, offerKind('custom'))).toBe(false); // carries offerKit
  });

  it('rejects a block needing a field the kind never declares', () => {
    const payload = buildBlockPayload(makeDoc(), ['logo-1'], 's1')!;
    payload.offerKit = null; // a plain logo block — nothing offer-shaped
    expect(blockFitsKind(payload, offerKind('custom'))).toBe(true);
    payload.requiredFields = [{ key: 'msrp', label: 'MSRP', type: 'text' }];
    expect(blockFitsKind(payload, offerKind('custom'))).toBe(false);
    expect(blockFitsKind(payload, offerKind('vehicle'))).toBe(true);
  });
});
