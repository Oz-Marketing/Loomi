import type { AdTemplate, AdData } from '../types';
import type { TemplateDoc } from '../doc-types';
import { renderDoc } from '../doc-renderer';
import { enrichOfferFields } from '../offer-text';
import { vehicleOffer } from './vehicle-offer';

/**
 * The Vehicle Offer template expressed as a data-driven TemplateDoc — the
 * proof that the doc model + renderer can reproduce a hand-coded template.
 * It reuses the code template's fields + defaults verbatim (same form), so the
 * ONLY difference is the renderer: this one interprets the doc, which is what
 * the visual builder will edit. Registered alongside the code template so the
 * two can be rendered side-by-side for a parity check.
 *
 * The structured offer block (label / big number / terms) is assembled into
 * `_offer*` computed fields the doc binds to — keeping `renderDoc` generic
 * (it only knows about fields, not offer math).
 */
export const vehicleOfferDoc: TemplateDoc = {
  id: 'vehicle-offer-doc',
  name: 'Vehicle Offer (Builder)',
  description: 'Data-driven Vehicle Offer authored as a TemplateDoc (the builder renderer).',
  sizes: vehicleOffer.sizes,
  fields: vehicleOffer.fields,
  defaults: vehicleOffer.defaults,
  background: { gradient: ['#ffffff', '#f1f5f9'], accentBar: true },
  elements: [
    { id: 'logo', type: 'logo', binding: { kind: 'brand', key: 'logoUrl' }, fit: 'contain' },
    { id: 'dealer', type: 'text', binding: { kind: 'brand', key: 'dealerName' }, fontWeight: 700, color: '#0f172a' },
    { id: 'tagline', type: 'text', binding: { kind: 'field', key: 'tagline' }, fontWeight: 800, color: '#0f172a', lineHeight: 1.05 },
    { id: 'offerLabel', type: 'text', binding: { kind: 'field', key: '_offerLabel' }, fontWeight: 700, color: 'brand', uppercase: true, letterSpacing: 2 },
    { id: 'offerMain', type: 'text', binding: { kind: 'field', key: '_offerMain' }, fontWeight: 800, color: '#0f172a', lineHeight: 0.95, letterSpacing: -1 },
    { id: 'offerTerms', type: 'text', binding: { kind: 'field', key: '_offerTerms' }, fontWeight: 500, color: '#475569' },
    { id: 'expiration', type: 'text', binding: { kind: 'field', key: 'expiration' }, fontWeight: 700, color: '#ffffff', bg: 'brand', radius: 999, padding: 14, align: 'center' },
    { id: 'vehicle', type: 'image', binding: { kind: 'field', key: 'vehicleImageUrl' }, fit: 'contain' },
    { id: 'disclaimer', type: 'text', binding: { kind: 'field', key: 'disclaimer' }, fontWeight: 400, color: '#94a3b8', lineHeight: 1.3 },
  ],
  layouts: {
    square: {
      logo: { x: 0.06, y: 0.06, w: 0.14, h: 0.07, z: 2 },
      dealer: { x: 0.22, y: 0.06, w: 0.5, h: 0.07, fontSize: 30, z: 2 },
      tagline: { x: 0.06, y: 0.15, w: 0.88, h: 0.09, fontSize: 40, z: 2 },
      vehicle: { x: 0.12, y: 0.26, w: 0.76, h: 0.32, z: 1 },
      offerLabel: { x: 0.06, y: 0.61, w: 0.88, h: 0.045, fontSize: 26, z: 2 },
      offerMain: { x: 0.06, y: 0.655, w: 0.88, h: 0.13, fontSize: 108, z: 2 },
      offerTerms: { x: 0.06, y: 0.8, w: 0.88, h: 0.05, fontSize: 27, z: 2 },
      expiration: { x: 0.06, y: 0.87, w: 0.5, h: 0.06, fontSize: 22, z: 3 },
      disclaimer: { x: 0.06, y: 0.945, w: 0.88, h: 0.045, fontSize: 17, z: 2 },
    },
    landscape: {
      logo: { x: 0.04, y: 0.08, w: 0.1, h: 0.1, z: 2 },
      dealer: { x: 0.15, y: 0.08, w: 0.32, h: 0.1, fontSize: 18, z: 2 },
      tagline: { x: 0.04, y: 0.2, w: 0.44, h: 0.1, fontSize: 24, z: 2 },
      offerLabel: { x: 0.04, y: 0.34, w: 0.44, h: 0.06, fontSize: 15, z: 2 },
      offerMain: { x: 0.04, y: 0.4, w: 0.44, h: 0.2, fontSize: 64, z: 2 },
      offerTerms: { x: 0.04, y: 0.62, w: 0.44, h: 0.07, fontSize: 16, z: 2 },
      expiration: { x: 0.04, y: 0.74, w: 0.3, h: 0.1, fontSize: 13, z: 3 },
      vehicle: { x: 0.5, y: 0.12, w: 0.46, h: 0.7, z: 1 },
      disclaimer: { x: 0.04, y: 0.9, w: 0.92, h: 0.07, fontSize: 10, z: 2 },
    },
    story: {
      logo: { x: 0.07, y: 0.05, w: 0.16, h: 0.05, z: 2 },
      dealer: { x: 0.26, y: 0.05, w: 0.6, h: 0.05, fontSize: 32, z: 2 },
      tagline: { x: 0.07, y: 0.12, w: 0.86, h: 0.1, fontSize: 56, z: 2 },
      vehicle: { x: 0.1, y: 0.24, w: 0.8, h: 0.34, z: 1 },
      offerLabel: { x: 0.07, y: 0.62, w: 0.86, h: 0.035, fontSize: 30, z: 2 },
      offerMain: { x: 0.07, y: 0.655, w: 0.86, h: 0.1, fontSize: 130, z: 2 },
      offerTerms: { x: 0.07, y: 0.77, w: 0.86, h: 0.04, fontSize: 32, z: 2 },
      expiration: { x: 0.07, y: 0.83, w: 0.55, h: 0.05, fontSize: 26, z: 3 },
      disclaimer: { x: 0.07, y: 0.93, w: 0.86, h: 0.05, fontSize: 19, z: 2 },
    },
  },
};

/** Assemble the offer block into the `_offer*` fields the doc binds to.
 *  Delegates to the shared, generic enricher (kept as a named export for the
 *  builder preview + code template). */
export function enrichVehicleOffer(data: AdData): AdData {
  return enrichOfferFields(data);
}

/** Fully-populated example data (defaults + assembled offer block) — what the
 *  builder canvas renders so every element shows realistic content. */
export const vehicleOfferPreviewData: AdData = enrichVehicleOffer(vehicleOfferDoc.defaults);

export const vehicleOfferDocTemplate: AdTemplate = {
  id: vehicleOfferDoc.id,
  name: vehicleOfferDoc.name,
  description: vehicleOfferDoc.description ?? '',
  sizes: vehicleOfferDoc.sizes,
  fields: vehicleOfferDoc.fields,
  defaults: vehicleOfferDoc.defaults,
  render: (data, size) => renderDoc(vehicleOfferDoc, enrichVehicleOffer(data), size),
};
