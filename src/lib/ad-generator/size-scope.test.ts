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
  refitAllSizes,
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

  it('scope "all" broadcasts position verbatim and re-derives height to keep the shape', () => {
    const d = applyBox(doc(), 'headline', { ...moved, fontSize: 108, z: 2 }, 'all', 'square');
    const story = d.layouts.story.headline;
    // Position and width are fractions of the same axis, so they carry across.
    expect(story).toMatchObject({ x: 0.3, y: 0.3, w: 0.4 });
    // Height is NOT copied: 0.1 of a 1080-tall square is 108px, and this used to
    // arrive as 0.1 of a 1920-tall story — 192px, a different shape. It now lands
    // as the fraction that reproduces 108px on this board.
    expect(story.h).toBeCloseTo(0.05625, 6);
    expect(Math.round(story.h * 1920)).toBe(108);
    expect(Math.round(story.w * 1080)).toBe(432);
  });

  it('scope "all" leaves stacking and omission alone', () => {
    const d = applyBox(doc(), 'headline', { ...moved, fontSize: 108, z: 2 }, 'all', 'square');
    expect(d.layouts.story.headline.z).toBe(5);
    expect(d.layouts.story.headline.hidden).toBe(true);
  });

  it('scope "all" leaves font size alone when it did not change', () => {
    const d = applyBox(doc(), 'headline', { ...moved, fontSize: 108, z: 2 }, 'all', 'square');
    expect(d.layouts.story.headline.fontSize).toBe(72);
  });

  it('scope "all" scales type by the same PROPORTION, not to the same number', () => {
    // Square 108 → 216 is a doubling, so story's 72 doubles to 144. Copying 216
    // onto a story (or a 300×250 banner) would bury the board.
    const d = applyBox(doc(), 'headline', { ...moved, fontSize: 216, z: 2 }, 'all', 'square');
    expect(d.layouts.square.headline.fontSize).toBe(216);
    expect(d.layouts.story.headline.fontSize).toBe(144);
  });

  it('scope "all" scales type down as well', () => {
    const d = applyBox(doc(), 'headline', { ...moved, fontSize: 54 }, 'all', 'square');
    expect(d.layouts.story.headline.fontSize).toBe(36);
  });

  it('scope "all" keeps a scaled font size inside the stepper bounds', () => {
    const d = applyBox(doc(), 'headline', { ...moved, fontSize: 400 }, 'all', 'square');
    expect(d.layouts.story.headline.fontSize).toBeLessThanOrEqual(400);
    expect(d.layouts.story.headline.fontSize).toBeGreaterThanOrEqual(4);
  });

  it('scope "all" does not invent a font size for a board that had none', () => {
    const base = doc();
    delete base.layouts.story.headline.fontSize;
    const d = applyBox(base, 'headline', { ...moved, fontSize: 216 }, 'all', 'square');
    expect(d.layouts.story.headline.fontSize).toBeUndefined();
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

// ── shape preservation across artboards ──
//
// Regression cover for the bug designers reported as "the size I set doesn't
// carry across artboards": `w` is a fraction of width and `h` a fraction of
// height, so copying the pair verbatim turned a square into a rectangle on every
// board with a different aspect ratio.

const LANDSCAPE = { id: 'landscape', label: 'Landscape 1200×628', width: 1200, height: 628 };

/** On-screen size of a box on a given board, in whole pixels. */
const pxOf = (b: { w: number; h: number }, s: { width: number; height: number }) => ({
  w: Math.round(b.w * s.width),
  h: Math.round(b.h * s.height),
});

function shapeDoc(): TemplateDoc {
  const square = { x: 0.1, y: 0.1, w: 400 / 1080, h: 400 / 1080 };
  return {
    id: 'tmpl', name: 'Shapes', fields: [],
    elements: [
      { id: 'badge', type: 'shape', name: 'Badge', fill: '#f00' },
      { id: 'bg', type: 'shape', name: 'Background', fill: '#000' },
    ],
    sizes: [SQUARE, LANDSCAPE, STORY],
    layouts: {
      square: { badge: { ...square }, bg: { x: 0, y: 0, w: 1, h: 1 } },
      landscape: { badge: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, bg: { x: 0, y: 0, w: 1, h: 1 } },
      story: { badge: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, bg: { x: 0, y: 0, w: 1, h: 1 } },
    },
    background: { color: '#fff' }, defaults: {},
  } as unknown as TemplateDoc;
}

describe('rescaleBox / broadcast shape preservation', () => {
  it('keeps a square square on every artboard (was 444×233 and 400×711)', () => {
    const d = shapeDoc();
    const out = applyBox(d, 'badge', d.layouts.square.badge, 'all', 'square');
    expect(pxOf(out.layouts.square.badge, SQUARE)).toEqual({ w: 400, h: 400 });
    // Scales with the board's width, but stays a SQUARE.
    expect(pxOf(out.layouts.landscape.badge, LANDSCAPE)).toEqual({ w: 444, h: 444 });
    expect(pxOf(out.layouts.story.badge, STORY)).toEqual({ w: 400, h: 400 });
  });

  it('leaves an edge-to-edge background stretching to fill each board', () => {
    const d = shapeDoc();
    const out = applyBox(d, 'bg', d.layouts.square.bg, 'all', 'square');
    for (const s of [SQUARE, LANDSCAPE, STORY]) {
      const b = out.layouts[s.id].bg;
      expect(pxOf(b, s)).toEqual({ w: s.width, h: s.height });
    }
  });

  it('clamps rather than overflowing when the shape cannot fit the target', () => {
    const d = shapeDoc();
    const tall = { x: 0.1, y: 0.05, w: 0.9, h: 0.9 };
    const out = applyBox({ ...d, layouts: { ...d.layouts, square: { ...d.layouts.square, badge: tall } } },
      'badge', tall, 'all', 'square');
    const b = out.layouts.landscape.badge;
    expect(b.h).toBeLessThanOrEqual(1);
    expect(b.y + b.h).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('refitAllSizes repairs a template whose boards already drifted', () => {
    const d = shapeDoc();
    // Landscape currently holds a distorted 240×126 badge.
    expect(pxOf(d.layouts.landscape.badge, LANDSCAPE)).toEqual({ w: 240, h: 126 });
    const out = refitAllSizes(d, 'square');
    expect(pxOf(out.layouts.landscape.badge, LANDSCAPE)).toEqual({ w: 444, h: 444 });
    expect(pxOf(out.layouts.story.badge, STORY)).toEqual({ w: 400, h: 400 });
  });

  it('refitAllSizes does not add an element to a board it was left off', () => {
    const d = shapeDoc();
    delete (d.layouts.story as Record<string, unknown>).badge;
    const out = refitAllSizes(d, 'square');
    expect(out.layouts.story.badge).toBeUndefined();
  });
});
