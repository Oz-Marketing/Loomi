import { describe, it, expect } from 'vitest';
import { renderDoc } from './doc-renderer';
import { enrichOfferFields, OFFER_TYPES } from './offer-text';
import { bindsOfferToken, boundFieldKeys, offerFieldPrefix, OFFER_PLATE_DEFAULTS } from './doc-types';
import { vehicleOffer } from './templates/vehicle-offer';
import type { TemplateDoc } from './doc-types';
import type { AdData, AdSize } from './types';

/**
 * THE OFFER PLATE — one element, every offer type.
 *
 * What it replaces: a plate built from three text elements has to be rebuilt for
 * each offer type a template serves, every copy gated by `visibleWhen`. Four
 * near-identical sets of elements, four chances to forget the gate, and a Layers
 * panel showing whichever set the current preview type let through.
 */

const SIZE: AdSize = { id: 'square', label: 'Square', width: 1080, height: 1080 };

function plateDoc(extra: Partial<TemplateDoc['elements'][number]> = {}): TemplateDoc {
  return {
    id: 'plate',
    name: 'Plate',
    sizes: [SIZE],
    fields: vehicleOffer.fields,
    elements: [{ id: 'offer', type: 'offer', color: 'brand', fontWeight: 800, ...extra }],
    layouts: { square: { offer: { x: 0.1, y: 0.3, w: 0.8, h: 0.35, z: 1 } } },
    defaults: { ...vehicleOffer.defaults },
  } as TemplateDoc;
}

const render = (doc: TemplateDoc, data: AdData, preview = false) =>
  renderDoc(doc, enrichOfferFields({ ...doc.defaults, ...data }), SIZE, { preview });

const CASES: Record<string, { data: AdData; expect: string[] }> = {
  lease: {
    data: { offerType: 'lease', monthlyPayment: '299', leaseTerm: '36', dueAtSigning: '2999' },
    expect: ['PER MONTH LEASE', '$299/mo', '36-month lease', '$2,999 due at signing'],
  },
  apr: {
    data: { offerType: 'apr', aprRate: '1.9', aprTerm: '60' },
    expect: ['APR', '1.9%', 'for 60 months'],
  },
  discount: {
    data: { offerType: 'discount', discountAmount: '3000', msrp: '34995' },
    expect: ['OFF MSRP', '$3,000', 'MSRP of $34,995'],
  },
  sales_price: {
    data: { offerType: 'sales_price', salePrice: '28995', msrp: '34995' },
    expect: ['SALES PRICE', '$28,995', 'MSRP of $34,995'],
  },
};

describe('one element, four offer types', () => {
  it('renders the whole plate for each type, from a single element', () => {
    const doc = plateDoc();
    expect(doc.elements).toHaveLength(1);
    for (const [type, c] of Object.entries(CASES)) {
      const html = render(doc, c.data);
      for (const fragment of c.expect) expect(html, `${type} → ${fragment}`).toContain(fragment);
    }
  });

  it('needs no conditional visibility to do it', () => {
    // The whole point. Every `visibleWhen` in the hand-built plates existed to
    // switch between per-type copies of these same three rows.
    for (const el of plateDoc().elements) expect(el.visibleWhen).toBeUndefined();
  });

  it('does not repeat the word APR between the label and the figure', () => {
    const html = render(plateDoc(), CASES.apr.data);
    expect(html).toContain('1.9%');
    expect(html).not.toContain('1.9% APR');
  });

  it('survives every offer type the vehicle kind declares', () => {
    for (const t of OFFER_TYPES) {
      expect(() => render(plateDoc(), { offerType: t.value }), t.value).not.toThrow();
    }
  });

  it('drops a row that has nothing to say, rather than leaving a gap', () => {
    // An APR with no term has no terms line. The figure then takes that space
    // instead of the plate rendering an empty row.
    const withTerms = render(plateDoc(), { offerType: 'apr', aprRate: '1.9', aprTerm: '60' });
    const without = render(plateDoc(), { offerType: 'apr', aprRate: '1.9', aprTerm: '' });
    expect(withTerms).toContain('for 60 months');
    expect(without).not.toContain('for 60 months');
    // Three rows with terms, two without.
    const rows = (html: string) => (html.match(/data-fit /g) ?? []).length;
    expect(rows(withTerms)).toBe(3);
    expect(rows(without)).toBe(2);
  });
});

describe('the figure dominates, and shorter figures come out larger', () => {
  it('gives the figure the height the label and terms do not take', () => {
    const html = render(plateDoc(), CASES.lease.data);
    // Label and terms are fixed shares; the figure flexes into the rest.
    expect(html).toContain(`flex:0 0 ${(OFFER_PLATE_DEFAULTS.labelShare * 100).toFixed(2)}%`);
    expect(html).toContain(`flex:0 0 ${(OFFER_PLATE_DEFAULTS.termsShare * 100).toFixed(2)}%`);
    expect(html).toContain('flex:1 1 auto');
  });

  it('lets a designer re-proportion the plate without touching the rows', () => {
    const html = render(plateDoc({ offerPlate: { labelShare: 0.3, termsShare: 0.1 } }), CASES.lease.data);
    expect(html).toContain('flex:0 0 30.00%');
    expect(html).toContain('flex:0 0 10.00%');
  });

  it('fits each row independently, which is where per-type emphasis comes from', () => {
    // "1.9%" is a shorter string than "$299/mo", so it fills the same row at a
    // larger size. Nobody configures a font size per offer type — the reason the
    // plate needs no per-type typography knob to make APR read bigger.
    for (const c of Object.values(CASES)) {
      const html = render(plateDoc(), c.data);
      expect((html.match(/data-fit /g) ?? []).length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('a plate declares which offer it shows', () => {
  it('reads the first offer by default and the o2_ set when asked', () => {
    expect(offerFieldPrefix({})).toBe('');
    expect(offerFieldPrefix({ offerIndex: 0 })).toBe('');
    expect(offerFieldPrefix({ offerIndex: 1 })).toBe('o2_');
  });

  it('renders two plates from two indexes — a dual with no twin elements', () => {
    const doc = plateDoc();
    doc.elements.push({ id: 'offer2', type: 'offer', offerIndex: 1, color: 'brand' });
    doc.layouts.square.offer2 = { x: 0.1, y: 0.66, w: 0.8, h: 0.3, z: 1 };
    const html = render(doc, {
      offerType: 'lease',
      monthlyPayment: '299',
      leaseTerm: '36',
      o2_offerType: 'apr',
      o2_aprRate: '2.9',
      o2_aprTerm: '72',
    });
    expect(html).toContain('$299/mo');
    expect(html).toContain('PER MONTH LEASE');
    expect(html).toContain('2.9%');
    expect(html).toContain('for 72 months');
  });

  it('tells the form which fields it needs — including the offer type', () => {
    // Without this a template whose only offer is a plate looks like it displays
    // no offer at all, and field prefs could hide the inputs that fill it.
    const keys = boundFieldKeys(plateDoc());
    expect(keys.has('offerType')).toBe(true);
    expect(keys.has('_offerMain')).toBe(true);
    expect(keys.has('_offerLabel')).toBe(true);
    expect(keys.has('_offerTerms')).toBe(true);

    const dual = plateDoc();
    dual.elements.push({ id: 'offer2', type: 'offer', offerIndex: 1 });
    const dualKeys = boundFieldKeys(dual);
    expect(dualKeys.has('o2_offerType')).toBe(true);
    expect(dualKeys.has('_o2_offerMain')).toBe(true);
  });
});

describe('a plate with no number behaves like every other element', () => {
  it('renders the em-dash placeholder, and leaves the blocking to preflight', () => {
    // `assembleOffer` reports a missing figure as "—", and a text element bound to
    // `_offerMain` renders that too. The plate follows the same convention rather
    // than inventing its own: what stops an ad shipping without a price is
    // preflight's `placeholder_value` check, not the renderer silently dropping
    // the offer — which would produce an ad with a hole in it and no complaint.
    const bare = { ...plateDoc(), defaults: {} } as TemplateDoc;
    const empty: AdData = { offerType: 'lease', monthlyPayment: '' };
    for (const preview of [true, false]) {
      const html = renderDoc(bare, enrichOfferFields(empty), SIZE, { preview });
      expect(html, `preview=${preview}`).toContain('data-el-id="offer"');
      expect(html, `preview=${preview}`).toContain('—');
    }
  });

  it('shows the plate on the canvas even with no offer type at all', () => {
    // A plate dropped onto a blank template has nothing to assemble yet. It must
    // still be visible and selectable, or a designer places an element that looks
    // like it does nothing. `enrichOfferFields` always supplies a fallback figure
    // and label for exactly this case, so the plate has something to draw.
    const bare = { ...plateDoc(), defaults: {} } as TemplateDoc;
    const html = renderDoc(bare, enrichOfferFields({}), SIZE, { preview: true });
    expect(html).toContain('data-el-id="offer"');
    expect(html).toContain('$X,XXX/mo'); // the engine's own placeholder figure
  });
});

describe('a layer that renders the offer must never be gated by offer type', () => {
  /**
   * `bindsOfferToken` is what withholds Show For in the builder. The offer engine
   * already resolves the label, figure and terms per type, so gating such a layer
   * to `lease` does not make a lease-specific layer — it blanks the ad for the
   * other three. That mechanism is what per-type plate copies were built out of.
   */
  it('is true for a plate', () => {
    expect(bindsOfferToken({ type: 'offer' })).toBe(true);
  });

  it('is true for any computed offer token, first offer or second', () => {
    for (const key of ['_offerMain', '_offerLabel', '_offerTerms', '_offerCurrency']) {
      expect(bindsOfferToken({ type: 'text', binding: { kind: 'field', key } }), key).toBe(true);
    }
    expect(bindsOfferToken({ type: 'text', binding: { kind: 'field', key: '_o2_offerMain' } })).toBe(true);
  });

  it('is true for typed text that interpolates one', () => {
    expect(
      bindsOfferToken({ type: 'text', binding: { kind: 'static', value: '{{_offerMain}} for 36 months' } }),
    ).toBe(true);
  });

  it('is FALSE for a per-type disclosure, which is what Show For is now for', () => {
    // The cost per $1,000 belongs on an APR ad and nowhere else, and no plate
    // renders it — so this layer keeps its gate.
    expect(bindsOfferToken({ type: 'text', binding: { kind: 'field', key: 'costPerThousand' } })).toBe(false);
    expect(bindsOfferToken({ type: 'text', binding: { kind: 'field', key: 'discountSource' } })).toBe(false);
  });

  it('is false for a raw offer figure bound directly', () => {
    // A hand-built per-type plate binds `monthlyPayment` itself. The engine is NOT
    // handling the per-type difference for it, so the gate is load-bearing until
    // the design is migrated — `show-for-survey.ts` is what reports those.
    expect(bindsOfferToken({ type: 'text', binding: { kind: 'field', key: 'monthlyPayment' } })).toBe(false);
  });

  it('is false for an unbound layer and for plain typed text', () => {
    expect(bindsOfferToken({ type: 'shape' })).toBe(false);
    expect(bindsOfferToken({ type: 'text', binding: { kind: 'static', value: 'Adventure Starts Here' } })).toBe(false);
  });
});
