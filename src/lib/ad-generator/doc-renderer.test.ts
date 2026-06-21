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

  it('positions elements from fractional boxes (× size)', () => {
    const html = renderDoc(doc, { price: '$299/mo' }, SIZE);
    expect(html).toContain('left:100px;top:500px;');
    expect(html).toContain('width:800px;height:100px;');
  });

  it("resolves the 'brand' color token from the account", () => {
    expect(renderDoc(doc, { price: '$1', brandColor: '#ff0000' }, SIZE)).toContain('color:#ff0000');
  });

  it('shows a placeholder when an image slot is empty, an <img> when filled', () => {
    expect(renderDoc(doc, {}, SIZE)).toContain('Image');
    expect(renderDoc(doc, { vehicleImageUrl: 'https://x/c.png' }, SIZE)).toContain('<img src="https://x/c.png"');
  });

  it('omits hidden / unmapped elements', () => {
    expect(renderDoc(doc, { price: '$1' }, SIZE)).not.toContain('SHOULD-NOT-APPEAR');
  });

  it('renders the background gradient + accent bar', () => {
    expect(renderDoc(doc, {}, SIZE)).toContain('linear-gradient(135deg, #ffffff 0%, #eeeeee 100%)');
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

describe('renderDoc background image', () => {
  const LANDSCAPE: AdSize = { id: 'landscape', label: 'Landscape', width: 1200, height: 628 };
  const bgDoc: TemplateDoc = {
    id: 'bg',
    name: 'BG',
    sizes: [SIZE, LANDSCAPE],
    fields: [],
    background: {
      color: '#ffffff',
      image: { kind: 'field', key: 'bgUrl' },
      overlay: { color: '#000000', opacity: 0.5, direction: 'bottom' },
    },
    bgFraming: {
      square: { x: 0.5, y: 0.5 },
      landscape: { x: 0.5, y: 0.2, zoom: 1.4 },
    },
    elements: [{ id: 't', type: 'text', binding: { kind: 'static', value: 'Hi' } }],
    layouts: {
      square: { t: { x: 0.1, y: 0.1, w: 0.5, h: 0.1, fontSize: 40 } },
      landscape: { t: { x: 0.1, y: 0.1, w: 0.5, h: 0.1, fontSize: 40 } },
    },
    defaults: {},
  };

  it('renders a cover background <img> when the bound image is present', () => {
    const html = renderDoc(bgDoc, { bgUrl: 'https://x/bg.jpg' }, SIZE);
    expect(html).toContain('<img src="https://x/bg.jpg"');
    expect(html).toContain('object-fit:cover');
  });

  it('renders no background image (just the base fill) when the binding is empty', () => {
    const html = renderDoc(bgDoc, {}, SIZE);
    expect(html).not.toContain('object-fit:cover');
  });

  it('applies the per-size focal point and zoom', () => {
    const sq = renderDoc(bgDoc, { bgUrl: 'https://x/bg.jpg' }, SIZE);
    expect(sq).toContain('object-position:50% 50%');
    expect(sq).not.toContain('transform:scale'); // zoom defaults to 1 → no transform

    const ls = renderDoc(bgDoc, { bgUrl: 'https://x/bg.jpg' }, LANDSCAPE);
    expect(ls).toContain('object-position:50% 20%');
    expect(ls).toContain('transform:scale(1.4)');
  });

  it('draws the legibility scrim as an rgba gradient over the image', () => {
    const html = renderDoc(bgDoc, { bgUrl: 'https://x/bg.jpg' }, SIZE);
    expect(html).toContain('linear-gradient(to top, rgba(0,0,0,0.5)');
  });

  it('escapes the resolved image URL', () => {
    const html = renderDoc(bgDoc, { bgUrl: 'https://x/"onerror="alert(1)' }, SIZE);
    expect(html).not.toContain('"onerror="alert(1)');
    expect(html).toContain('&quot;onerror=');
  });
});
