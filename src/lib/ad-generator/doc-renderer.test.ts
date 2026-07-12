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

  it('quotes font families with single quotes so they never break the style="" attribute', () => {
    const fontDoc: TemplateDoc = {
      id: 'f',
      name: 'F',
      sizes: [SIZE],
      fields: [],
      elements: [{ id: 'price', type: 'text', binding: { kind: 'static', value: 'Hi' }, fontFamily: 'Verdana' }],
      layouts: { square: { price: { x: 0.1, y: 0.5, w: 0.8, h: 0.1, fontSize: 64, z: 1 } } },
      defaults: {},
    };
    // Doc-level font too — this is what was breaking every element's font-family.
    const html = renderDoc(fontDoc, { fontFamily: 'Genesis Sans Head' }, SIZE);
    // A double-quoted family inside style="…" would close the attribute early.
    expect(html).not.toContain('font-family:"');
    // The chosen family is present (single-quoted) AND the declaration survives to
    // the following font-size (i.e. the attribute wasn't truncated).
    expect(html).toContain("font-family:'Verdana', 'Genesis Sans Head'");
    expect(html).toMatch(/font-family:'Verdana'[^"]*font-size:64px/);
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

  it('renders a tiled (repeating) image fill with a size-independent tile width', () => {
    const tDoc: TemplateDoc = {
      id: 't',
      name: 'T',
      sizes: [SIZE],
      fields: [],
      elements: [{ id: 'tex', type: 'image', binding: { kind: 'field', key: 'img' }, fit: 'tile', tileScale: 0.2 }],
      layouts: { square: { tex: { x: 0, y: 0, w: 1, h: 1 } } },
      defaults: {},
    };
    const html = renderDoc(tDoc, { img: 'https://x/tex.png' }, SIZE);
    expect(html).toContain('background-image:url(https://x/tex.png)');
    expect(html).toContain('background-repeat:repeat');
    expect(html).toContain('background-size:20% auto');
    expect(html).not.toContain('<img'); // tile renders as a CSS background, not an <img>
  });

  it('composites a unified background element: base fill + texture + fade overlay', () => {
    const bgDoc: TemplateDoc = {
      id: 'b',
      name: 'B',
      sizes: [SIZE],
      fields: [],
      elements: [
        {
          id: 'bg',
          type: 'background',
          binding: { kind: 'field', key: 'tex' },
          fit: 'cover',
          fill: '#199fdb',
          overlay: { type: 'linear', angle: 180, stops: [{ color: '#ffffff', pos: 0 }, { color: '#ffffff', pos: 100, opacity: 0 }] },
        },
      ],
      layouts: { square: { bg: { x: 0, y: 0, w: 1, h: 1 } } },
      defaults: {},
    };
    const html = renderDoc(bgDoc, { tex: 'https://x/topo.png' }, SIZE);
    expect(html).toContain('background:#199fdb'); // base fill layer
    expect(html).toContain('<img src="https://x/topo.png"'); // texture layer (cover)
    expect(html).toContain('object-fit:cover');
    expect(html).toContain('linear-gradient(180deg, #ffffff 0%, rgba(255,255,255,0) 100%)'); // fade overlay
  });

  it('renders a background element with a tiled texture and no fill/overlay', () => {
    const bgDoc: TemplateDoc = {
      id: 'b',
      name: 'B',
      sizes: [SIZE],
      fields: [],
      elements: [{ id: 'bg', type: 'background', binding: { kind: 'field', key: 'tex' }, fit: 'tile', tileScale: 0.15, bgImageOpacity: 50 }],
      layouts: { square: { bg: { x: 0, y: 0, w: 1, h: 1 } } },
      defaults: {},
    };
    const html = renderDoc(bgDoc, { tex: 'https://x/grain.png' }, SIZE);
    expect(html).toContain('background-image:url(https://x/grain.png)');
    expect(html).toContain('background-size:15% auto');
    expect(html).toContain('opacity:0.5'); // texture-layer opacity
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

  it('formats number-typed field values with thousands commas + interpolates {{tokens}}', () => {
    const tDoc: TemplateDoc = {
      ...doc,
      fields: [{ key: 'dueAtSigning', label: 'Due', type: 'number' }],
      elements: [
        { id: 'due', type: 'text', binding: { kind: 'field', key: 'dueAtSigning' } },
        { id: 'sentence', type: 'text', binding: { kind: 'static', value: 'With {{dueAtSigning}} due at signing' } },
      ],
      layouts: { square: { due: { x: 0, y: 0, w: 0.5, h: 0.1 }, sentence: { x: 0, y: 0.2, w: 1, h: 0.1 } } },
    };
    const html = renderDoc(tDoc, { dueAtSigning: '2999' }, SIZE);
    expect(html).toContain('2,999'); // direct number binding grouped
    expect(html).toContain('With 2,999 due at signing'); // token interpolated + grouped
  });

  it('leaves non-number fields ungrouped and drops unknown tokens', () => {
    const tDoc: TemplateDoc = {
      ...doc,
      fields: [{ key: 'stock', label: 'Stock', type: 'text' }],
      elements: [{ id: 't', type: 'text', binding: { kind: 'static', value: 'Stock {{stock}} / {{missing}}' } }],
      layouts: { square: { t: { x: 0, y: 0, w: 1, h: 0.1 } } },
    };
    expect(renderDoc(tDoc, { stock: '4421' }, SIZE)).toContain('Stock 4421 / ');
  });

  it('renders all offer elements regardless of legacy _offerCount (dual = always shows both)', () => {
    const countDoc: TemplateDoc = {
      ...doc,
      elements: [
        { id: 'o1', type: 'text', binding: { kind: 'static', value: 'OFFER-ONE' } },
        { id: 'o2', type: 'text', binding: { kind: 'field', key: '_o2_offerMain' } },
      ],
      layouts: {
        square: {
          o1: { x: 0, y: 0, w: 0.5, h: 0.1 },
          o2: { x: 0.5, y: 0, w: 0.5, h: 0.1 },
        },
      },
    };
    // A dual template always shows both offers now; a leftover _offerCount is ignored.
    const html = renderDoc(countDoc, { _offerCount: '1', _o2_offerMain: 'X2' }, SIZE);
    expect(html).toContain('OFFER-ONE');
    expect(html).toContain('X2');
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

  it('renders a multi-stop gradientFill with per-stop opacity (rgba)', () => {
    const gDoc: TemplateDoc = {
      ...doc,
      elements: [
        {
          id: 'g',
          type: 'shape',
          gradientFill: {
            type: 'linear',
            angle: 180,
            stops: [
              { color: '#ffffff', pos: 0, opacity: 100 },
              { color: '#ff0000', pos: 50 },
              { color: '#ffffff', pos: 100, opacity: 0 },
            ],
          },
        },
      ],
      layouts: { square: { g: { x: 0, y: 0, w: 1, h: 1 } } },
    };
    const html = renderDoc(gDoc, {}, SIZE);
    expect(html).toContain('linear-gradient(180deg, #ffffff 0%, #ff0000 50%, rgba(255,255,255,0) 100%)');
  });

  it('renders a radial gradientFill', () => {
    const gDoc: TemplateDoc = {
      ...doc,
      elements: [
        {
          id: 'g',
          type: 'shape',
          gradientFill: { type: 'radial', radialShape: 'circle', center: [25, 75], stops: [{ color: '#000000', pos: 0 }, { color: '#ffffff', pos: 100 }] },
        },
      ],
      layouts: { square: { g: { x: 0, y: 0, w: 1, h: 1 } } },
    };
    expect(renderDoc(gDoc, {}, SIZE)).toContain('radial-gradient(circle at 25% 75%, #000000 0%, #ffffff 100%)');
  });

  it('sorts out-of-order gradient stops so CSS renders them correctly', () => {
    const gDoc: TemplateDoc = {
      ...doc,
      elements: [
        {
          id: 'g',
          type: 'shape',
          gradientFill: { type: 'linear', angle: 90, stops: [{ color: '#222222', pos: 80 }, { color: '#111111', pos: 10 }] },
        },
      ],
      layouts: { square: { g: { x: 0, y: 0, w: 1, h: 1 } } },
    };
    expect(renderDoc(gDoc, {}, SIZE)).toContain('linear-gradient(90deg, #111111 10%, #222222 80%)');
  });

  it('prefers gradientFill over the legacy gradient fields when both are set', () => {
    const gDoc: TemplateDoc = {
      ...doc,
      elements: [
        {
          id: 'g',
          type: 'shape',
          gradient: ['#111111', '#222222'],
          gradientFill: { type: 'linear', angle: 45, stops: [{ color: '#aaaaaa', pos: 0 }, { color: '#bbbbbb', pos: 100 }] },
        },
      ],
      layouts: { square: { g: { x: 0, y: 0, w: 1, h: 1 } } },
    };
    const html = renderDoc(gDoc, {}, SIZE);
    expect(html).toContain('linear-gradient(45deg, #aaaaaa 0%, #bbbbbb 100%)');
    expect(html).not.toContain('#111111');
  });

  it('applies element opacity and blend mode to a shape', () => {
    const bDoc: TemplateDoc = {
      ...doc,
      elements: [{ id: 's', type: 'shape', fill: '#ff0000', opacity: 40, blendMode: 'multiply' }],
      layouts: { square: { s: { x: 0, y: 0, w: 1, h: 1 } } },
    };
    const html = renderDoc(bDoc, {}, SIZE);
    expect(html).toContain('opacity:0.4;');
    expect(html).toContain('mix-blend-mode:multiply;');
  });

  it('resolves the brand token inside a gradientFill stop', () => {
    const gDoc: TemplateDoc = {
      ...doc,
      elements: [
        { id: 'g', type: 'shape', gradientFill: { type: 'linear', stops: [{ color: 'brand', pos: 0 }, { color: '#000000', pos: 100 }] } },
      ],
      layouts: { square: { g: { x: 0, y: 0, w: 1, h: 1 } } },
    };
    expect(renderDoc(gDoc, { brandColor: '#abcdef' }, SIZE)).toContain('#abcdef 0%');
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

  it('drops eye-hidden elements from BOTH preview and export (not just dimmed)', () => {
    expect(renderDoc(doc, {}, SIZE)).not.toContain('SHOULD-NOT-APPEAR'); // export omits hidden
    const prev = renderDoc(doc, {}, SIZE, { preview: true });
    expect(prev).not.toContain('SHOULD-NOT-APPEAR'); // hiding a layer removes it from the canvas too
  });

  it('keeps a visibleWhen-gated element dimmed in preview but omits it on export', () => {
    const gated: TemplateDoc = {
      ...doc,
      elements: [
        ...doc.elements.filter((e) => e.id !== 'gone'),
        { id: 'apronly', type: 'text', binding: { kind: 'static', value: 'APR-BADGE' }, visibleWhen: { field: 'offerType', in: ['apr'] } },
      ],
      layouts: { square: { ...doc.layouts.square, apronly: { x: 0, y: 0, w: 0.2, h: 0.1 } } },
    };
    // Wrong offer type → gated element is dimmed in preview, gone on export.
    const prev = renderDoc(gated, { offerType: 'lease' }, SIZE, { preview: true });
    expect(prev).toContain('APR-BADGE');
    expect(prev).toContain('opacity:0.35');
    expect(renderDoc(gated, { offerType: 'lease' }, SIZE)).not.toContain('APR-BADGE');
  });

  it('tags each element with data-el-id (for live drag in the builder)', () => {
    const html = renderDoc(doc, { price: '$1' }, SIZE);
    expect(html).toContain('data-el-id="price"');
    expect(html).toContain('data-el-id="bar"');
  });
});
