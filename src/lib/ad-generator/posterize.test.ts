import { describe, it, expect } from 'vitest';
import { hasMotionSource, stillRenderFor } from './posterize';
import { adTemplateFromDoc } from './doc-template';
import type { DocElement, TemplateDoc } from './doc-types';

function doc(elements: DocElement[]): TemplateDoc {
  return {
    id: 't',
    name: 'T',
    sizes: [{ id: 'sq', label: 'Square', width: 100, height: 100 }],
    fields: [],
    elements,
    layouts: { sq: Object.fromEntries(elements.map((e) => [e.id, { x: 0, y: 0, w: 1, h: 1 }])) },
    defaults: {},
  };
}

// The ffmpeg-dependent path is exercised end to end elsewhere; what matters here
// is that a still ad NEVER pays for any of it, and that the no-op cases return the
// caller's own objects rather than rebuilt ones.
describe('hasMotionSource', () => {
  it('is false for a design of stills', () => {
    const d = doc([
      { id: 'i', type: 'image', binding: { kind: 'static', value: '/car.png' } },
      { id: 't', type: 'text', binding: { kind: 'static', value: 'Hello' } },
    ]);
    expect(hasMotionSource(d, {})).toBe(false);
  });

  it('is true for a clip on a static binding', () => {
    const d = doc([{ id: 'i', type: 'image', binding: { kind: 'static', value: '/hero.mp4' } }]);
    expect(hasMotionSource(d, {})).toBe(true);
  });

  it('is true for a clip arriving through the form', () => {
    // The common real case: a dealer uploads an .mp4 into an image field, and no
    // one edited the template.
    const d = doc([{ id: 'i', type: 'image', binding: { kind: 'field', key: 'heroImage' } }]);
    expect(hasMotionSource(d, { heroImage: '/hero.webm' })).toBe(true);
    expect(hasMotionSource(d, { heroImage: '/hero.jpg' })).toBe(false);
  });

  it('ignores a video URL sitting in a TEXT element', () => {
    // Text is not a media slot; a URL typed into a headline is just characters.
    const d = doc([{ id: 't', type: 'text', binding: { kind: 'static', value: '/hero.mp4' } }]);
    expect(hasMotionSource(d, {})).toBe(false);
  });
});

describe('stillRenderFor', () => {
  it('hands back the same template and data when nothing moves', async () => {
    const d = doc([{ id: 'i', type: 'image', binding: { kind: 'static', value: '/car.png' } }]);
    const template = adTemplateFromDoc('t', d);
    const data = { headline: 'Hi' };
    const out = await stillRenderFor({ template, doc: d, data });
    expect(out.template).toBe(template);
    expect(out.data).toBe(data);
  });

  it('is a no-op when the caller has no doc to inspect', async () => {
    // The two retired code templates are render functions with no doc behind them.
    const d = doc([{ id: 'i', type: 'image', binding: { kind: 'static', value: '/hero.mp4' } }]);
    const template = adTemplateFromDoc('t', d);
    const out = await stillRenderFor({ template, doc: null, data: {} });
    expect(out.template).toBe(template);
  });
});
