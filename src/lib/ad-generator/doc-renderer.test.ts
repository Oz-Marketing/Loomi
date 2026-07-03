import { describe, it, expect } from 'vitest';
import { renderDoc } from './doc-renderer';
import type { TemplateDoc } from './doc-types';
import type { AdSize } from './types';

const SIZE: AdSize = { id: 'square', label: 'Square', width: 1000, height: 1000 };

const doc: TemplateDoc = {
  id: 'test',
  name: 'Test',
  sizes: [SIZE],
  fields: [],
  background: { gradient: ['#ffffff', '#eeeeee'], accentBar: true },
  elements: [
    { id: 'price', type: 'text', binding: { kind: 'field', key: 'price' }, color: 'brand', align: 'center' },
    { id: 'veh', type: 'image', binding: { kind: 'field', key: 'vehicleImageUrl' }, fit: 'contain' },
    { id: 'bar', type: 'shape', fill: 'brand', radius: 8 },
    { id: 'gone', type: 'text', binding: { kind: 'static', value: 'SHOULD-NOT-APPEAR' } },
  ],
  layouts: {
    square: {
      price: { x: 0.1, y: 0.5, w: 0.8, h: 0.1, fontSize: 64, z: 2 },
      veh: { x: 0.2, y: 0.1, w: 0.6, h: 0.3, z: 1 },
      bar: { x: 0, y: 0.9, w: 1, h: 0.05, z: 0 },
      gone: { x: 0, y: 0, w: 0.1, h: 0.1, hidden: true },
    },
  },
  defaults: {},
};

describe('renderDoc', () => {
  it('renders bound field values', () => {
    expect(renderDoc(doc, { price: '$299/mo' }, SIZE)).toContain('$299/mo');
  });

  it('applies a per-size focal point (object-position) to a cover image element', () => {
    const bgDoc: TemplateDoc = {
      id: 'bg',
      name: 'Bg',
      sizes: [SIZE],
      fields: [],
      elements: [{ id: 'bg', type: 'image', binding: { kind: 'field', key: 'img' }, fit: 'cover' }],
      layouts: { square: { bg: { x: 0, y: 0, w: 1, h: 1, objectX: 0.25, objectY: 0.75 } } },
      defaults: {},
    };
    const html = renderDoc(bgDoc, { img: 'https://x/bg.jpg' }, SIZE);
    expect(html).toContain('object-fit:cover');
    expect(html).toContain('object-position:25% 75%');
  });

  it('applies a crop zoom (scale about the focal point) to a cover image element', () => {
    const bgDoc: TemplateDoc = {
      id: 'bg',
      name: 'Bg',
      sizes: [SIZE],
      fields: [],
      elements: [{ id: 'bg', type: 'image', binding: { kind: 'field', key: 'img' }, fit: 'cover' }],
      layouts: { square: { bg: { x: 0, y: 0, w: 1, h: 1, objectX: 0.25, objectY: 0.75, objectScale: 1.5 } } },
      defaults: {},
    };
    const html = renderDoc(bgDoc, { img: 'https://x/bg.jpg' }, SIZE);
    expect(html).toContain('transform:scale(1.5)');
    expect(html).toContain('transform-origin:25% 75%');
  });

  it('omits the crop transform when there is no extra zoom (scale <= 1)', () => {
    const bgDoc: TemplateDoc = {
      id: 'bg',
      name: 'Bg',
      sizes: [SIZE],
      fields: [],
      elements: [{ id: 'bg', type: 'image', binding: { kind: 'field', key: 'img' }, fit: 'cover' }],
      layouts: { square: { bg: { x: 0, y: 0, w: 1, h: 1, objectScale: 1 } } },
      defaults: {},
    };
    const html = renderDoc(bgDoc, { img: 'https://x/bg.jpg' }, SIZE);
    expect(html).not.toContain('transform:scale');
  });

  it('positions elements from fractional boxes (× size)', () => {
    const html = renderDoc(doc, { price: '$299/mo' }, SIZE);
    expect(html).toContain('left:100px;top:500px;');
    expect(html).toContain('width:800px;height:100px;');
  });

  it("resolves the 'brand' color token from the account", () => {
    expect(renderDoc(doc, { price: '$1', brandColor: '#ff0000' }, SIZE)).toContain('color:#ff0000');
  });

  it('shows an image placeholder only in preview; <img> when filled; nothing on empty export', () => {
    expect(renderDoc(doc, {}, SIZE)).not.toContain('Image'); // export omits an empty slot
    expect(renderDoc(doc, {}, SIZE, { preview: true })).toContain('Image'); // builder shows the placeholder
    expect(renderDoc(doc, { vehicleImageUrl: 'https://x/c.png' }, SIZE)).toContain('<img src="https://x/c.png"');
  });

  it('omits hidden / unmapped elements', () => {
    expect(renderDoc(doc, { price: '$1' }, SIZE)).not.toContain('SHOULD-NOT-APPEAR');
  });

  it('renders the background gradient + accent bar', () => {
    expect(renderDoc(doc, {}, SIZE)).toContain('linear-gradient(135deg, #ffffff 0%, #eeeeee 100%)');
  });

  it('renders a non-rectangular shape via clip-path', () => {
    const starDoc: TemplateDoc = {
      ...doc,
      elements: [{ id: 'star', type: 'shape', shapeKind: 'star', fill: '#ff0000' }],
      layouts: { square: { star: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } } },
    };
    const html = renderDoc(starDoc, {}, SIZE);
    expect(html).toContain('clip-path:polygon(50% 0%');
    expect(html).toContain('background:#ff0000');
  });

  it('renders an ellipse shape as a 50% radius (no clip-path)', () => {
    const ellDoc: TemplateDoc = {
      ...doc,
      elements: [{ id: 'e', type: 'shape', shapeKind: 'ellipse', fill: '#00ff00' }],
      layouts: { square: { e: { x: 0, y: 0, w: 0.5, h: 0.5 } } },
    };
    const html = renderDoc(ellDoc, {}, SIZE);
    expect(html).toContain('border-radius:50%');
    expect(html).not.toContain('clip-path');
  });

  it('omits elements dragged fully off the artboard (detached)', () => {
    const offDoc: TemplateDoc = {
      ...doc,
      elements: [
        { id: 'on', type: 'text', binding: { kind: 'static', value: 'ON-CANVAS' } },
        { id: 'off', type: 'text', binding: { kind: 'static', value: 'DETACHED-OFF' } },
      ],
      layouts: {
        square: {
          on: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 },
          off: { x: 1.2, y: 0.1, w: 0.3, h: 0.1 }, // entirely right of the artboard
        },
      },
    };
    const html = renderDoc(offDoc, {}, SIZE, { preview: true });
    expect(html).toContain('ON-CANVAS');
    expect(html).not.toContain('DETACHED-OFF');
  });

  it('renders a shape gradient fill', () => {
    const gDoc: TemplateDoc = {
      ...doc,
      elements: [{ id: 'g', type: 'shape', gradient: ['#111111', '#222222'], gradientAngle: 90, gradientStops: [10, 80] }],
      layouts: { square: { g: { x: 0, y: 0, w: 1, h: 1 } } },
    };
    expect(renderDoc(gDoc, {}, SIZE)).toContain('linear-gradient(90deg, #111111 10%, #222222 80%)');
  });

  it('escapes user values', () => {
    const html = renderDoc(doc, { price: '<script>x</script>' }, SIZE);
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows empty text bindings as placeholders only in preview mode', () => {
    // `price` has no value here: omitted on export, shown as its field key in the builder.
    expect(renderDoc(doc, {}, SIZE)).not.toContain('>price<');
    expect(renderDoc(doc, {}, SIZE, { preview: true })).toContain('price');
  });

  it('keeps hidden elements (dimmed) in preview but drops them on export', () => {
    expect(renderDoc(doc, {}, SIZE)).not.toContain('SHOULD-NOT-APPEAR'); // export omits hidden
    const prev = renderDoc(doc, {}, SIZE, { preview: true });
    expect(prev).toContain('SHOULD-NOT-APPEAR'); // preview keeps it…
    expect(prev).toContain('opacity:0.35'); // …dimmed
  });

  it('tags each element with data-el-id (for live drag in the builder)', () => {
    const html = renderDoc(doc, { price: '$1' }, SIZE);
    expect(html).toContain('data-el-id="price"');
    expect(html).toContain('data-el-id="bar"');
  });
});
