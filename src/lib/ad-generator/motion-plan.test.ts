import { describe, it, expect } from 'vitest';
import { docHasMotion, planMotionComposite, sizeHasMotion } from './motion-plan';
import { renderDoc } from './doc-renderer';
import type { DocElement, TemplateDoc } from './doc-types';
import type { AdSize } from './types';

const SQUARE: AdSize = { id: 'square', label: 'Square', width: 1000, height: 1000 };
const STORY: AdSize = { id: 'story', label: 'Story', width: 1080, height: 1920 };

function doc(
  elements: DocElement[],
  layout: Record<string, { x: number; y: number; w: number; h: number; z?: number; hidden?: boolean; objectX?: number; objectScale?: number }>,
  extra: Partial<TemplateDoc> = {},
): TemplateDoc {
  return {
    id: 't',
    name: 'T',
    sizes: [SQUARE],
    fields: [],
    elements,
    layouts: { square: layout },
    defaults: {},
    ...extra,
  };
}

const FULL = { x: 0, y: 0, w: 1, h: 1 };

describe('planMotionComposite', () => {
  it('reports no motion for an all-still design, and puts everything on one plate', () => {
    const d = doc(
      [
        { id: 'bg', type: 'background', fill: '#fff' },
        { id: 'head', type: 'text', binding: { kind: 'static', value: 'Hi' } },
      ],
      { bg: { ...FULL, z: 0 }, head: { x: 0.1, y: 0.1, w: 0.5, h: 0.1, z: 1 } },
    );
    const plan = planMotionComposite(d, {}, SQUARE);
    expect(plan.hasMotion).toBe(false);
    expect(plan.clips).toEqual([]);
    expect(plan.layers).toEqual([{ kind: 'plate', ids: ['bg', 'head'], canvas: true }]);
  });

  it('splits a moving background into fill-under, clip, fade-over', () => {
    // The three things a `background` element carries have to end up on three
    // different sides of the video, or the fade would render beneath it.
    const d = doc(
      [
        {
          id: 'bg',
          type: 'background',
          fill: '#101010',
          binding: { kind: 'static', value: 'https://cdn/hero.mp4' },
          overlay: { type: 'linear', stops: [{ color: '#000', pos: 0, opacity: 60 }, { color: '#000', pos: 100, opacity: 0 }] },
        },
        { id: 'head', type: 'text', binding: { kind: 'static', value: 'Hi' } },
      ],
      { bg: { ...FULL, z: 0 }, head: { x: 0.1, y: 0.1, w: 0.5, h: 0.1, z: 1 } },
    );
    const plan = planMotionComposite(d, {}, SQUARE);
    expect(plan.hasMotion).toBe(true);
    expect(plan.layers).toEqual([
      { kind: 'plate', ids: ['bg'], bgParts: { bg: 'base' }, canvas: true },
      { kind: 'clip', clip: expect.objectContaining({ elId: 'bg', kind: 'video' }) },
      { kind: 'plate', ids: ['bg', 'head'], bgParts: { bg: 'overlay' } },
    ]);
  });

  it('keeps z-order, so a clip layered over a scrim composites in that order', () => {
    const d = doc(
      [
        { id: 'bg', type: 'background', fill: '#fff' },
        { id: 'clipA', type: 'image', binding: { kind: 'static', value: '/a.mp4' } },
        { id: 'scrim', type: 'shape', fill: '#000', opacity: 40 },
        { id: 'clipB', type: 'image', binding: { kind: 'static', value: '/b.webm' } },
        { id: 'logo', type: 'logo', binding: { kind: 'brand', key: 'logoUrl' } },
      ],
      {
        bg: { ...FULL, z: 0 },
        clipA: { ...FULL, z: 1 },
        scrim: { ...FULL, z: 2 },
        clipB: { x: 0.5, y: 0.5, w: 0.4, h: 0.3, z: 3 },
        logo: { x: 0.1, y: 0.8, w: 0.2, h: 0.1, z: 4 },
      },
    );
    const plan = planMotionComposite(d, {}, SQUARE);
    expect(plan.layers.map((l) => (l.kind === 'plate' ? `plate:${l.ids.join('+')}` : `clip:${l.clip.elId}`))).toEqual([
      'plate:bg',
      'clip:clipA',
      'plate:scrim',
      'clip:clipB',
      'plate:logo',
    ]);
    expect(plan.clips).toHaveLength(2);
  });

  it('places a clip in canvas pixels, carrying the per-size crop', () => {
    const d = doc([{ id: 'v', type: 'image', fit: 'cover', binding: { kind: 'static', value: '/a.mp4' } }], {
      v: { x: 0.25, y: 0.5, w: 0.5, h: 0.25, objectX: 0.2, objectScale: 1.4 },
    });
    const [clip] = planMotionComposite(d, {}, SQUARE).clips;
    expect(clip.placement).toMatchObject({ x: 250, y: 500, w: 500, h: 250, fit: 'cover', focalX: 0.2, zoom: 1.4 });
  });

  it('carries corner radii so the MP4 rounds the clip like the still does', () => {
    const d = doc(
      [{ id: 'v', type: 'image', radius: 24, radiusTR: 0, binding: { kind: 'static', value: '/a.mp4' } }],
      { v: FULL },
    );
    expect(planMotionComposite(d, {}, SQUARE).clips[0].placement.radii).toEqual([24, 0, 24, 24]);
  });

  it('leaves radii off a square clip, so no mask is built for nothing', () => {
    const d = doc([{ id: 'v', type: 'image', binding: { kind: 'static', value: '/a.mp4' } }], { v: FULL });
    expect(planMotionComposite(d, {}, SQUARE).clips[0].placement.radii).toBeUndefined();
  });

  it('ignores crop zoom on a background clip, because the still ignores it too', () => {
    // The background element's texture has no zoom transform in CSS. Honouring
    // objectScale here would crop the MP4 tighter than the PNG of the same ad.
    const d = doc([{ id: 'bg', type: 'background', binding: { kind: 'static', value: '/a.mp4' } }], {
      bg: { ...FULL, objectScale: 1.6, objectX: 0.2 },
    });
    const [clip] = planMotionComposite(d, {}, SQUARE).clips;
    expect(clip.placement.zoom).toBeUndefined();
    expect(clip.placement.focalX).toBe(0.2);
  });

  it('ignores crop zoom on a contained clip, which has no crop to zoom', () => {
    const d = doc([{ id: 'v', type: 'image', fit: 'contain', binding: { kind: 'static', value: '/a.mp4' } }], {
      v: { ...FULL, objectScale: 2 },
    });
    expect(planMotionComposite(d, {}, SQUARE).clips[0].placement.zoom).toBeUndefined();
  });

  it('multiplies element opacity by the background texture opacity', () => {
    const d = doc(
      [{ id: 'bg', type: 'background', opacity: 50, bgImageOpacity: 50, binding: { kind: 'static', value: '/a.mp4' } }],
      { bg: FULL },
    );
    expect(planMotionComposite(d, {}, SQUARE).clips[0].placement.opacity).toBe(25);
  });

  it('resolves the clip through the data, not just a static binding', () => {
    const d = doc([{ id: 'v', type: 'image', binding: { kind: 'field', key: 'heroUrl' } }], { v: FULL });
    expect(sizeHasMotion(d, { heroUrl: '/from-the-form.mp4' }, SQUARE)).toBe(true);
    expect(sizeHasMotion(d, { heroUrl: '/from-the-form.jpg' }, SQUARE)).toBe(false);
  });

  it('ignores a hidden clip — hiding a layer takes it out of the ad', () => {
    const d = doc([{ id: 'v', type: 'image', binding: { kind: 'static', value: '/a.mp4' } }], { v: { ...FULL, hidden: true } });
    expect(planMotionComposite(d, {}, SQUARE).hasMotion).toBe(false);
  });

  it('treats an animated GIF as a clip', () => {
    const d = doc([{ id: 'v', type: 'image', binding: { kind: 'static', value: '/loop.gif' } }], { v: FULL });
    expect(planMotionComposite(d, {}, SQUARE).clips[0].kind).toBe('gif');
  });

  it('warns where the MP4 cannot match the still, instead of silently differing', () => {
    const d = doc(
      [{ id: 'v', type: 'image', fit: 'tile', blendMode: 'multiply', name: 'Texture', binding: { kind: 'static', value: '/a.mp4' } }],
      { v: FULL },
    );
    const { warnings } = planMotionComposite(d, {}, SQUARE);
    expect(warnings.join(' ')).toContain('Tile');
    expect(warnings.join(' ')).toContain('multiply');
  });

  it('answers motion per size, and across the doc', () => {
    const d: TemplateDoc = {
      ...doc([{ id: 'v', type: 'image', binding: { kind: 'static', value: '/a.mp4' } }], { v: FULL }),
      sizes: [SQUARE, STORY],
      layouts: { square: { v: FULL }, story: { v: { ...FULL, hidden: true } } },
    };
    expect(sizeHasMotion(d, {}, SQUARE)).toBe(true);
    expect(sizeHasMotion(d, {}, STORY)).toBe(false);
    expect(docHasMotion(d, {})).toBe(true);
    expect(docHasMotion(d, {}, ['story'])).toBe(false);
  });
});

describe('renderDoc with motion', () => {
  const clipDoc = doc(
    [
      { id: 'bg', type: 'background', fill: '#111', binding: { kind: 'static', value: '/hero.mp4' }, trimStart: 1.5 },
      { id: 'head', type: 'text', binding: { kind: 'static', value: 'Hello' } },
    ],
    { bg: { ...FULL, z: 0 }, head: { x: 0.1, y: 0.1, w: 0.5, h: 0.1, z: 1 } },
  );

  it('emits a real, autoplaying, muted video the builder and a browser can play', () => {
    const html = renderDoc(clipDoc, {}, SQUARE);
    expect(html).toContain('<video src="/hero.mp4" autoplay muted loop playsinline');
    // The still exporter seeks to this frame, so the PNG and the MP4's first
    // frame are the same picture.
    expect(html).toContain('data-still-at="1.5"');
  });

  it('keeps an animated GIF an <img>', () => {
    const d = doc([{ id: 'v', type: 'image', binding: { kind: 'static', value: '/loop.gif' } }], { v: FULL });
    const html = renderDoc(d, {}, SQUARE);
    expect(html).toContain('<img src="/loop.gif"');
    expect(html).not.toContain('<video');
  });

  it('omits the clip on a plate render and leaves the canvas transparent', () => {
    const html = renderDoc(clipDoc, {}, SQUARE, { plate: { ids: ['bg', 'head'], bgParts: { bg: 'overlay' } } });
    expect(html).not.toContain('<video');
    expect(html).toContain('background:transparent');
    expect(html).toContain('Hello');
  });

  it('paints the canvas fill on the bottom plate only', () => {
    const base = renderDoc(clipDoc, {}, SQUARE, { plate: { ids: ['bg'], bgParts: { bg: 'base' }, canvas: true } });
    expect(base).toContain('background:#111');
    expect(base).not.toContain('background:transparent');
  });

  it('drops a background element whose only content was the clip, rather than leaving an empty box', () => {
    const d = doc([{ id: 'bg', type: 'background', binding: { kind: 'static', value: '/hero.mp4' } }], { bg: FULL });
    const html = renderDoc(d, {}, SQUARE, { plate: { ids: ['bg'] } });
    expect(html).not.toContain('data-el-id="bg"');
  });

  it('still renders a plain image slot as an image', () => {
    const d = doc([{ id: 'i', type: 'image', binding: { kind: 'static', value: '/car.png' } }], { i: FULL });
    expect(renderDoc(d, {}, SQUARE)).toContain('<img src="/car.png"');
  });
});
