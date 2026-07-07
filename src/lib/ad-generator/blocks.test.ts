import { describe, it, expect } from 'vitest';
import { buildBlockPayload, insertBlockIntoDoc } from './blocks';
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
  it('appends elements with fresh ids on EVERY size, scaling fontSize by height', () => {
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
    // fontSize scaled by height ratio on the wide size (540/1080 = 0.5): 80 → 40
    const mainId = newIds[0];
    expect(next.layouts.s1[mainId].fontSize).toBe(80); // same-size, no scale
    expect(next.layouts.s2[mainId].fontSize).toBe(40); // half height
    // nudged so it doesn't sit exactly on the original
    expect(next.layouts.s1[mainId].x).toBeCloseTo(0.13, 5);
    // stacked above existing content
    expect(next.layouts.s1[mainId].z).toBeGreaterThan(4);
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

  it('drops group membership so it does not dangle in the target', () => {
    const doc = makeDoc();
    doc.elements[0].groupId = 'g-old';
    const payload = buildBlockPayload(doc, ['text-main'], 's1')!;
    let n = 0;
    const { doc: next, newIds } = insertBlockIntoDoc(makeDoc(), payload, (t) => `${t}-y${n++}`);
    const inserted = next.elements.find((e) => e.id === newIds[0])!;
    expect(inserted.groupId).toBeUndefined();
  });
});
