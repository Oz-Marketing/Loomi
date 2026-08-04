import { describe, expect, it } from 'vitest';
import {
  applyBox,
  applyElementPatch,
  clearElementOverride,
  effectiveElement,
  effectiveElements,
  overridableKeys,
  overriddenKeys,
  styleVariants,
} from './size-scope';
import { renderDoc } from './doc-renderer';
import type { TemplateDoc } from './doc-types';

const SQUARE = { id: 'square', label: 'Square 1080×1080', width: 1080, height: 1080 };
const STORY = { id: 'story', label: 'Story 1080×1920', width: 1080, height: 1920 };

function doc(): TemplateDoc {
  return {
    id: 'tmpl',
    name: 'Test',
    fields: [],
    elements: [
      { id: 'headline', type: 'text', binding: { kind: 'static', value: 'HEADLINE' }, color: '#0f172a', fontWeight: 800 },
      { id: 'sub', type: 'text', binding: { kind: 'static', value: 'SUB' }, color: '#475569' },
    ],
    sizes: [SQUARE, STORY],
    layouts: {
      square: {
        headline: { x: 0.1, y: 0.1, w: 0.8, h: 0.2, fontSize: 108, z: 2 },
        sub: { x: 0.1, y: 0.4, w: 0.8, h: 0.1, fontSize: 32 },
      },
      story: {
        headline: { x: 0.05, y: 0.2, w: 0.9, h: 0.15, fontSize: 72, z: 5, hidden: true },
        sub: { x: 0.05, y: 0.5, w: 0.9, h: 0.08, fontSize: 28 },
      },
    },
    defaults: {},
  } as TemplateDoc;
}

describe('effectiveElement', () => {
  it('returns the element untouched when the size has no override', () => {
    const d = doc();
    expect(effectiveElement(d.elements[0], d.overrides, 'square')).toBe(d.elements[0]);
  });

  it('merges the size override over the shared style', () => {
    const d = applyElementPatch(doc(), 'headline', { color: '#ff0000' }, 'size', 'story');
    expect(effectiveElement(d.elements[0], d.overrides, 'story').color).toBe('#ff0000');
    expect(effectiveElement(d.elements[0], d.overrides, 'square').color).toBe('#0f172a');
  });

  it('never lets an override change identity', () => {
    const d = doc();
    const overrides = { story: { headline: { id: 'other', type: 'shape', color: '#fff' } } } as TemplateDoc['overrides'];
    const eff = effectiveElement(d.elements[0], overrides, 'story');
    expect(eff.id).toBe('headline');
    expect(eff.type).toBe('text');
  });
});

describe('applyElementPatch — scope "size"', () => {
  it('changes only the board being edited', () => {
    const d = applyElementPatch(doc(), 'headline', { color: '#ff0000' }, 'size', 'story');
    expect(d.elements.find((e) => e.id === 'headline')?.color).toBe('#0f172a');
    expect(overriddenKeys(d, 'story', 'headline')).toEqual(['color']);
    expect(overriddenKeys(d, 'square', 'headline')).toEqual([]);
  });

  it('accumulates several localised keys', () => {
    let d = applyElementPatch(doc(), 'headline', { color: '#ff0000' }, 'size', 'story');
    d = applyElementPatch(d, 'headline', { fontWeight: 400 }, 'size', 'story');
    expect(overriddenKeys(d, 'story', 'headline').sort()).toEqual(['color', 'fontWeight']);
  });

  it('writes content, show-for and the layer name globally even so', () => {
    // There is no per-size home for these: they define what the element IS, and
    // the co-op checks read the shared elements.
    const d = applyElementPatch(doc(), 'headline', { name: 'Big line' }, 'size', 'story');
    expect(d.elements.find((e) => e.id === 'headline')?.name).toBe('Big line');
    expect(d.overrides).toBeUndefined();
  });

  it('splits a mixed patch — style local, identity shared', () => {
    const d = applyElementPatch(doc(), 'headline', { name: 'Big line', color: '#ff0000' }, 'size', 'story');
    expect(d.elements.find((e) => e.id === 'headline')?.name).toBe('Big line');
    expect(d.elements.find((e) => e.id === 'headline')?.color).toBe('#0f172a');
    expect(overriddenKeys(d, 'story', 'headline')).toEqual(['color']);
  });
});

describe('applyElementPatch — scope "all"', () => {
  it('changes the shared element', () => {
    const d = applyElementPatch(doc(), 'headline', { color: '#00ff00' }, 'all', 'square');
    expect(d.elements.find((e) => e.id === 'headline')?.color).toBe('#00ff00');
  });

  it('clears that key everywhere it had diverged, so the edit visibly takes', () => {
    // Otherwise the board that had its own colour would keep it, and a global
    // change would look like it silently did nothing there.
    let d = applyElementPatch(doc(), 'headline', { color: '#ff0000' }, 'size', 'story');
    d = applyElementPatch(d, 'headline', { color: '#00ff00' }, 'all', 'square');
    expect(effectiveElement(d.elements[0], d.overrides, 'story').color).toBe('#00ff00');
    expect(overriddenKeys(d, 'story', 'headline')).toEqual([]);
  });

  it('leaves a different key that board had localised', () => {
    let d = applyElementPatch(doc(), 'headline', { fontWeight: 400 }, 'size', 'story');
    d = applyElementPatch(d, 'headline', { color: '#00ff00' }, 'all', 'square');
    expect(overriddenKeys(d, 'story', 'headline')).toEqual(['fontWeight']);
  });

  it('leaves other elements alone', () => {
    const d = applyElementPatch(doc(), 'headline', { color: '#00ff00' }, 'all', 'square');
    expect(d.elements.find((e) => e.id === 'sub')?.color).toBe('#475569');
  });
});

describe('clearElementOverride', () => {
  it('drops one board back to the shared style', () => {
    let d = applyElementPatch(doc(), 'headline', { color: '#ff0000' }, 'size', 'story');
    d = clearElementOverride(d, 'headline', 'story');
    expect(effectiveElement(d.elements[0], d.overrides, 'story').color).toBe('#0f172a');
    expect(d.overrides).toBeUndefined();
  });

  it('can clear an element on every board at once', () => {
    let d = applyElementPatch(doc(), 'headline', { color: '#ff0000' }, 'size', 'story');
    d = applyElementPatch(d, 'headline', { color: '#0000ff' }, 'size', 'square');
    d = clearElementOverride(d, 'headline', 'all');
    expect(d.overrides).toBeUndefined();
  });

  it('is a no-op on a doc with no overrides', () => {
    const before = doc();
    expect(clearElementOverride(before, 'headline', 'story')).toBe(before);
  });
});

describe('applyBox', () => {
  const moved = { x: 0.3, y: 0.3, w: 0.4, h: 0.1 };

  it('scope "size" touches one board', () => {
    const d = applyBox(doc(), 'headline', { ...moved, fontSize: 108, z: 2 }, 'size', 'square');
    expect(d.layouts.square.headline.x).toBe(0.3);
    expect(d.layouts.story.headline.x).toBe(0.05);
  });

  it('scope "all" broadcasts the fractional geometry', () => {
    const d = applyBox(doc(), 'headline', { ...moved, fontSize: 108, z: 2 }, 'all', 'square');
    expect(d.layouts.story.headline).toMatchObject(moved);
  });

  it('scope "all" leaves per-size font size, stacking and omission alone', () => {
    const d = applyBox(doc(), 'headline', { ...moved, fontSize: 108, z: 2 }, 'all', 'square');
    // A 108px headline pushed onto a banner would bury it; z and hidden are
    // per-board by design.
    expect(d.layouts.story.headline.fontSize).toBe(72);
    expect(d.layouts.story.headline.z).toBe(5);
    expect(d.layouts.story.headline.hidden).toBe(true);
  });

  it('scope "all" does not add the element to a board it is absent from', () => {
    const base = doc();
    delete base.layouts.story.headline;
    const d = applyBox(base, 'headline', { ...moved }, 'all', 'square');
    expect(d.layouts.story.headline).toBeUndefined();
  });
});

describe('styleVariants', () => {
  it('is just the elements when nothing is overridden', () => {
    const d = doc();
    expect(styleVariants(d)).toBe(d.elements);
  });

  it('includes each board-specific variant, so its font still gets embedded', () => {
    const d = applyElementPatch(doc(), 'headline', { fontFamily: 'Story Only Sans' }, 'size', 'story');
    expect(styleVariants(d).some((e) => e.fontFamily === 'Story Only Sans')).toBe(true);
  });
});

describe('overridableKeys', () => {
  it('keeps style and drops identity', () => {
    expect(overridableKeys({ color: '#fff', name: 'x', binding: { kind: 'static', value: 'y' } })).toEqual(['color']);
  });
});

describe('renderDoc with overrides', () => {
  it('renders each board with its own style', () => {
    const d = applyElementPatch(doc(), 'headline', { color: '#ff0000' }, 'size', 'story');
    // `story` hides the headline, so read the colour off a board that shows it.
    const withSub = applyElementPatch(d, 'sub', { color: '#00ff00' }, 'size', 'story');
    expect(renderDoc(withSub, {}, STORY)).toContain('color:#00ff00');
    expect(renderDoc(withSub, {}, SQUARE)).toContain('color:#475569');
  });

  it('leaves a doc with no overrides rendering exactly as before', () => {
    expect(renderDoc(doc(), {}, SQUARE)).toContain('color:#0f172a');
  });
});

describe('effectiveElements', () => {
  it('returns the shared array when a size has no overrides at all', () => {
    const d = doc();
    expect(effectiveElements(d, 'square')).toBe(d.elements);
  });

  it('maps every element for a size that has any override', () => {
    const d = applyElementPatch(doc(), 'headline', { color: '#ff0000' }, 'size', 'story');
    const els = effectiveElements(d, 'story');
    expect(els.find((e) => e.id === 'headline')?.color).toBe('#ff0000');
    expect(els.find((e) => e.id === 'sub')?.color).toBe('#475569');
  });
});
