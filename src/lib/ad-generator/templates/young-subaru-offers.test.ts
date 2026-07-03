import { describe, it, expect } from 'vitest';
import { youngSubaruSingleOfferDoc, youngSubaruDualOfferDoc, YOUNG_SUBARU_SIZES } from './young-subaru-offers';
import { renderDoc } from '../doc-renderer';
import { enrichOfferFields } from '../offer-text';
import type { TemplateDoc } from '../doc-types';
import type { AdData } from '../types';

function render(doc: TemplateDoc, sizeId: string, extra: AdData = {}): string {
  const size = doc.sizes.find((s) => s.id === sizeId)!;
  return renderDoc(doc, enrichOfferFields({ ...doc.defaults, ...extra }), size, { preview: false });
}

describe('Young Subaru offer templates', () => {
  it('covers the Email / Facebook / Google / KSL channels', () => {
    const ids = YOUNG_SUBARU_SIZES.map((s) => s.id);
    expect(ids).toEqual(['fb', 'email', 'google', 'ksl600', 'ksl850']);
  });

  for (const doc of [youngSubaruSingleOfferDoc, youngSubaruDualOfferDoc]) {
    describe(doc.name, () => {
      it('renders every size without throwing', () => {
        for (const size of doc.sizes) {
          expect(() => render(doc, size.id)).not.toThrow();
          expect(render(doc, size.id)).toContain('<div class="ad">');
        }
      });

      it('builds the background from plain layers (fill Shape + white fade Shape), not a doc-level canvas fill or a background element', () => {
        const html = render(doc, 'fb');
        expect(doc.background).toBeUndefined(); // no legacy canvas fill
        expect(doc.elements.some((e) => e.type === 'background')).toBe(false); // no dedicated background element
        expect(html).toContain('background:#199fdb'); // base fill Shape layer
        expect(html).toContain('linear-gradient('); // the white fade Shape
        expect(html).toContain('#ffffff'); // fade stop
      });

      it('has a Young|Subaru logo element and an empty texture-slot Image', () => {
        const tex = doc.elements.find((e) => e.id === 'bgTexture')!;
        expect(tex.type).toBe('image');
        expect(tex.binding).toEqual({ kind: 'static', value: '' }); // empty texture slot
        expect(doc.elements.some((e) => e.type === 'logo')).toBe(true);
      });

      it('every layout box maps to a real element id (no typos)', () => {
        const ids = new Set(doc.elements.map((e) => e.id));
        for (const [sizeId, layout] of Object.entries(doc.layouts)) {
          for (const key of Object.keys(layout)) {
            expect(ids.has(key), `${doc.id} / ${sizeId} → "${key}" has no element`).toBe(true);
          }
        }
      });

      it('lays out the background layers full-bleed on every size', () => {
        for (const size of doc.sizes) {
          for (const layer of ['bgFill', 'bgTexture', 'bgFade']) {
            expect(doc.layouts[size.id][layer]).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
          }
        }
      });
    });
  }

  it('single offer renders each offer type (APR / Lease / Discount / Sales Price)', () => {
    const cases: AdData[] = [
      { offerType: 'lease', monthlyPayment: '319', leaseTerm: '36' },
      { offerType: 'apr', aprRate: '2.9', aprTerm: '60' },
      { offerType: 'discount', discountAmount: '3500', discountLabelStyle: 'off_msrp' },
      { offerType: 'sales_price', salePrice: '28995' },
    ];
    for (const c of cases) {
      const expectedMain = enrichOfferFields({ ...youngSubaruSingleOfferDoc.defaults, ...c })._offerMain as string;
      expect(expectedMain).toBeTruthy();
      expect(render(youngSubaruSingleOfferDoc, 'fb', c)).toContain(expectedMain);
    }
  });

  it('dual offer renders two independent offers (e.g. Lease + APR) side by side', () => {
    const data: AdData = { offerType: 'lease', monthlyPayment: '299', leaseTerm: '36', o2_offerType: 'apr', o2_aprRate: '0.9', o2_aprTerm: '60' };
    const enriched = enrichOfferFields({ ...youngSubaruDualOfferDoc.defaults, ...data });
    const html = render(youngSubaruDualOfferDoc, 'fb', data);
    expect(html).toContain(enriched._offerMain as string); // offer 1
    expect(html).toContain(enriched._o2_offerMain as string); // offer 2
    expect(enriched._offerMain).not.toBe(enriched._o2_offerMain);
  });

  it('dual offer supports Discount + Sales Price', () => {
    const data: AdData = { offerType: 'discount', discountAmount: '4000', discountLabelStyle: 'cash_back', o2_offerType: 'sales_price', o2_salePrice: '31995' };
    const enriched = enrichOfferFields({ ...youngSubaruDualOfferDoc.defaults, ...data });
    const html = render(youngSubaruDualOfferDoc, 'ksl600', data);
    expect(html).toContain(enriched._offerMain as string);
    expect(html).toContain(enriched._o2_offerMain as string);
  });
});
