import type { AdTemplate } from '../types';
import type { TemplateDoc, DocElement } from '../doc-types';
import { adTemplateFromDoc } from '../doc-template';
import { vehicleOffer } from './vehicle-offer';
import { vehicleDualOffer } from './vehicle-dual-offer';

/**
 * Offer templates built on the background-as-layer system: a full-bleed photo is
 * a real `image` element at the back (bound to a `backgroundImage` field, framed
 * per size via its focal point), a semi-transparent `scrim` shape sits above it
 * for legibility, and the offer/logo/CTA overlay on top in white. No doc-level
 * background image — everything is a layer.
 *
 * Single = one offer; Dual = two offers side-by-side (stacked on Story). The
 * offer block binds to the `_offer*` fields the renderer enriches from the
 * structured offer fields, same as the rest of the generator.
 */

const SIZES = [
  { id: 'square', label: 'Square 1:1 (1080×1080)', width: 1080, height: 1080 },
  { id: 'landscape', label: 'Landscape (1200×628)', width: 1200, height: 628 },
  { id: 'story', label: 'Story 9:16 (1080×1920)', width: 1080, height: 1920 },
];

const BG_FIELD = { key: 'backgroundImage', label: 'Background image', type: 'image' as const, group: 'Background', help: 'Full-bleed photo behind the ad (EVOX or a lifestyle shot).' };

/** Background image + darkening scrim — shared by both offer docs. */
function backdropElements(): DocElement[] {
  return [
    { id: 'bg', type: 'image', name: 'Background', binding: { kind: 'field', key: 'backgroundImage' }, fit: 'cover' },
    { id: 'scrim', type: 'shape', name: 'Scrim', fill: '#0b1220a6' }, // ~65% navy for legibility
  ];
}
/** Full-bleed box for the backdrop layers at the back of every size. */
function backdropBoxes() {
  return {
    bg: { x: 0, y: 0, w: 1, h: 1, z: 0, objectX: 0.5, objectY: 0.5 },
    scrim: { x: 0, y: 0, w: 1, h: 1, z: 1 },
  };
}

// ── Single offer ──────────────────────────────────────────────────────────
export const singleOfferDoc: TemplateDoc = {
  id: 'single-offer',
  name: 'Vehicle Offer',
  description: 'One offer over a full-bleed background photo — price, terms, expiration, disclaimer.',
  industries: ['Automotive', 'Powersports'],
  sizes: SIZES,
  fields: [BG_FIELD, ...vehicleOffer.fields],
  background: { color: '#0b1220' },
  elements: [
    ...backdropElements(),
    { id: 'logo', type: 'logo', name: 'Logo', binding: { kind: 'brand', key: 'logoUrl' }, fit: 'contain' },
    { id: 'dealer', type: 'text', name: 'Dealer', binding: { kind: 'brand', key: 'dealerName' }, fontWeight: 700, color: '#ffffff' },
    { id: 'tagline', type: 'text', name: 'Tagline', binding: { kind: 'field', key: 'tagline' }, fontWeight: 800, color: '#ffffff', lineHeight: 1.04 },
    { id: 'offerLabel', type: 'text', name: 'Offer label', binding: { kind: 'field', key: '_offerLabel' }, fontWeight: 700, color: '#ffffff', uppercase: true, letterSpacing: 2 },
    { id: 'offerMain', type: 'text', name: 'Offer', binding: { kind: 'field', key: '_offerMain' }, fontWeight: 800, color: '#ffffff', lineHeight: 0.95, letterSpacing: -1 },
    { id: 'offerTerms', type: 'text', name: 'Terms', binding: { kind: 'field', key: '_offerTerms' }, fontWeight: 500, color: '#e2e8f0' },
    { id: 'expiration', type: 'text', name: 'Expiration', binding: { kind: 'field', key: 'expiration' }, fontWeight: 700, color: '#ffffff', bg: 'brand', radius: 999, padding: 14, align: 'center' },
    { id: 'disclaimer', type: 'text', name: 'Disclaimer', binding: { kind: 'field', key: 'disclaimer' }, fontWeight: 400, color: '#cbd5e1', lineHeight: 1.3 },
  ],
  layouts: {
    square: {
      ...backdropBoxes(),
      logo: { x: 0.06, y: 0.06, w: 0.16, h: 0.08, z: 5 },
      dealer: { x: 0.24, y: 0.06, w: 0.5, h: 0.08, fontSize: 30, z: 5 },
      tagline: { x: 0.06, y: 0.17, w: 0.88, h: 0.12, fontSize: 52, z: 5 },
      offerLabel: { x: 0.06, y: 0.62, w: 0.88, h: 0.05, fontSize: 28, z: 5 },
      offerMain: { x: 0.06, y: 0.665, w: 0.88, h: 0.13, fontSize: 120, z: 5 },
      offerTerms: { x: 0.06, y: 0.8, w: 0.88, h: 0.05, fontSize: 28, z: 5 },
      expiration: { x: 0.06, y: 0.88, w: 0.55, h: 0.06, fontSize: 24, z: 6 },
      disclaimer: { x: 0.06, y: 0.95, w: 0.88, h: 0.04, fontSize: 16, z: 5 },
    },
    landscape: {
      ...backdropBoxes(),
      logo: { x: 0.04, y: 0.08, w: 0.12, h: 0.12, z: 5 },
      dealer: { x: 0.17, y: 0.1, w: 0.4, h: 0.1, fontSize: 22, z: 5 },
      tagline: { x: 0.04, y: 0.26, w: 0.6, h: 0.16, fontSize: 40, z: 5 },
      offerLabel: { x: 0.55, y: 0.18, w: 0.42, h: 0.08, fontSize: 20, z: 5 },
      offerMain: { x: 0.55, y: 0.26, w: 0.42, h: 0.28, fontSize: 92, z: 5 },
      offerTerms: { x: 0.55, y: 0.56, w: 0.42, h: 0.1, fontSize: 20, z: 5 },
      expiration: { x: 0.55, y: 0.72, w: 0.4, h: 0.12, fontSize: 18, z: 6 },
      disclaimer: { x: 0.04, y: 0.9, w: 0.92, h: 0.07, fontSize: 11, z: 5 },
    },
    story: {
      ...backdropBoxes(),
      logo: { x: 0.07, y: 0.05, w: 0.18, h: 0.06, z: 5 },
      dealer: { x: 0.28, y: 0.05, w: 0.6, h: 0.06, fontSize: 32, z: 5 },
      tagline: { x: 0.07, y: 0.13, w: 0.86, h: 0.12, fontSize: 64, z: 5 },
      offerLabel: { x: 0.07, y: 0.62, w: 0.86, h: 0.04, fontSize: 32, z: 5 },
      offerMain: { x: 0.07, y: 0.66, w: 0.86, h: 0.1, fontSize: 140, z: 5 },
      offerTerms: { x: 0.07, y: 0.78, w: 0.86, h: 0.04, fontSize: 34, z: 5 },
      expiration: { x: 0.07, y: 0.85, w: 0.55, h: 0.05, fontSize: 28, z: 6 },
      disclaimer: { x: 0.07, y: 0.93, w: 0.86, h: 0.05, fontSize: 19, z: 5 },
    },
  },
  defaults: { ...vehicleOffer.defaults },
};

// ── Dual offer ────────────────────────────────────────────────────────────
/** A single offer column's elements for a given prefix (''/'o2_'). */
function columnElements(prefix: string, idPrefix: string): DocElement[] {
  return [
    { id: `${idPrefix}name`, type: 'text', name: `${idPrefix === '' ? 'Offer 1' : 'Offer 2'} vehicle`, binding: { kind: 'field', key: `${prefix}vehicleName` }, fontWeight: 700, color: '#ffffff', align: 'center' },
    { id: `${idPrefix}label`, type: 'text', name: `${idPrefix === '' ? 'Offer 1' : 'Offer 2'} label`, binding: { kind: 'field', key: `_${prefix}offerLabel` }, fontWeight: 700, color: '#ffffff', uppercase: true, letterSpacing: 2, align: 'center' },
    { id: `${idPrefix}main`, type: 'text', name: `${idPrefix === '' ? 'Offer 1' : 'Offer 2'} price`, binding: { kind: 'field', key: `_${prefix}offerMain` }, fontWeight: 800, color: '#ffffff', lineHeight: 0.95, align: 'center' },
    { id: `${idPrefix}terms`, type: 'text', name: `${idPrefix === '' ? 'Offer 1' : 'Offer 2'} terms`, binding: { kind: 'field', key: `_${prefix}offerTerms` }, fontWeight: 500, color: '#e2e8f0', align: 'center' },
  ];
}

export const dualOfferDoc: TemplateDoc = {
  id: 'dual-offer',
  name: 'Dual Offer',
  description: 'Two offers over a full-bleed background photo — side-by-side, stacked on Story.',
  industries: ['Automotive', 'Powersports'],
  sizes: SIZES,
  fields: [BG_FIELD, ...vehicleDualOffer.fields],
  background: { color: '#0b1220' },
  elements: [
    ...backdropElements(),
    { id: 'logo', type: 'logo', name: 'Logo', binding: { kind: 'brand', key: 'logoUrl' }, fit: 'contain' },
    { id: 'dealer', type: 'text', name: 'Dealer', binding: { kind: 'brand', key: 'dealerName' }, fontWeight: 700, color: '#ffffff', align: 'center' },
    { id: 'tagline', type: 'text', name: 'Tagline', binding: { kind: 'field', key: 'tagline' }, fontWeight: 800, color: '#ffffff', lineHeight: 1.04, align: 'center' },
    ...columnElements('', ''),
    ...columnElements('o2_', 'o2_'),
    { id: 'expiration', type: 'text', name: 'Expiration', binding: { kind: 'field', key: 'expiration' }, fontWeight: 700, color: '#ffffff', bg: 'brand', radius: 999, padding: 14, align: 'center' },
    { id: 'disclaimer', type: 'text', name: 'Disclaimer', binding: { kind: 'field', key: 'disclaimer' }, fontWeight: 400, color: '#cbd5e1', lineHeight: 1.3, align: 'center' },
  ],
  layouts: {
    // Square / Landscape — two columns side by side.
    square: {
      ...backdropBoxes(),
      logo: { x: 0.42, y: 0.05, w: 0.16, h: 0.07, z: 5 },
      tagline: { x: 0.06, y: 0.14, w: 0.88, h: 0.1, fontSize: 46, z: 5 },
      name: { x: 0.06, y: 0.3, w: 0.42, h: 0.06, fontSize: 30, z: 5 },
      label: { x: 0.06, y: 0.38, w: 0.42, h: 0.04, fontSize: 22, z: 5 },
      main: { x: 0.06, y: 0.43, w: 0.42, h: 0.1, fontSize: 76, z: 5 },
      terms: { x: 0.06, y: 0.55, w: 0.42, h: 0.06, fontSize: 22, z: 5 },
      o2_name: { x: 0.52, y: 0.3, w: 0.42, h: 0.06, fontSize: 30, z: 5 },
      o2_label: { x: 0.52, y: 0.38, w: 0.42, h: 0.04, fontSize: 22, z: 5 },
      o2_main: { x: 0.52, y: 0.43, w: 0.42, h: 0.1, fontSize: 76, z: 5 },
      o2_terms: { x: 0.52, y: 0.55, w: 0.42, h: 0.06, fontSize: 22, z: 5 },
      dealer: { x: 0.06, y: 0.78, w: 0.88, h: 0.05, fontSize: 24, z: 5 },
      expiration: { x: 0.3, y: 0.85, w: 0.4, h: 0.06, fontSize: 24, z: 6 },
      disclaimer: { x: 0.06, y: 0.94, w: 0.88, h: 0.04, fontSize: 16, z: 5 },
    },
    landscape: {
      ...backdropBoxes(),
      logo: { x: 0.45, y: 0.06, w: 0.1, h: 0.12, z: 5 },
      tagline: { x: 0.1, y: 0.22, w: 0.8, h: 0.12, fontSize: 34, z: 5 },
      name: { x: 0.06, y: 0.4, w: 0.42, h: 0.08, fontSize: 22, z: 5 },
      label: { x: 0.06, y: 0.48, w: 0.42, h: 0.06, fontSize: 16, z: 5 },
      main: { x: 0.06, y: 0.53, w: 0.42, h: 0.18, fontSize: 60, z: 5 },
      terms: { x: 0.06, y: 0.72, w: 0.42, h: 0.08, fontSize: 16, z: 5 },
      o2_name: { x: 0.52, y: 0.4, w: 0.42, h: 0.08, fontSize: 22, z: 5 },
      o2_label: { x: 0.52, y: 0.48, w: 0.42, h: 0.06, fontSize: 16, z: 5 },
      o2_main: { x: 0.52, y: 0.53, w: 0.42, h: 0.18, fontSize: 60, z: 5 },
      o2_terms: { x: 0.52, y: 0.72, w: 0.42, h: 0.08, fontSize: 16, z: 5 },
      dealer: { x: 0.1, y: 0.07, w: 0.35, h: 0.1, fontSize: 20, z: 5 },
      expiration: { x: 0.35, y: 0.85, w: 0.3, h: 0.1, fontSize: 16, z: 6 },
      disclaimer: { x: 0.04, y: 0.92, w: 0.92, h: 0.06, fontSize: 11, z: 5 },
    },
    // Story — stacked.
    story: {
      ...backdropBoxes(),
      logo: { x: 0.41, y: 0.04, w: 0.18, h: 0.05, z: 5 },
      tagline: { x: 0.07, y: 0.11, w: 0.86, h: 0.1, fontSize: 56, z: 5 },
      name: { x: 0.07, y: 0.26, w: 0.86, h: 0.05, fontSize: 34, z: 5 },
      label: { x: 0.07, y: 0.32, w: 0.86, h: 0.04, fontSize: 26, z: 5 },
      main: { x: 0.07, y: 0.36, w: 0.86, h: 0.09, fontSize: 110, z: 5 },
      terms: { x: 0.07, y: 0.46, w: 0.86, h: 0.04, fontSize: 26, z: 5 },
      o2_name: { x: 0.07, y: 0.56, w: 0.86, h: 0.05, fontSize: 34, z: 5 },
      o2_label: { x: 0.07, y: 0.62, w: 0.86, h: 0.04, fontSize: 26, z: 5 },
      o2_main: { x: 0.07, y: 0.66, w: 0.86, h: 0.09, fontSize: 110, z: 5 },
      o2_terms: { x: 0.07, y: 0.76, w: 0.86, h: 0.04, fontSize: 26, z: 5 },
      dealer: { x: 0.07, y: 0.84, w: 0.86, h: 0.05, fontSize: 30, z: 5 },
      expiration: { x: 0.25, y: 0.9, w: 0.5, h: 0.05, fontSize: 26, z: 6 },
      disclaimer: { x: 0.07, y: 0.96, w: 0.86, h: 0.03, fontSize: 18, z: 5 },
    },
  },
  defaults: { ...vehicleDualOffer.defaults },
};

export const singleOfferTemplate: AdTemplate = adTemplateFromDoc(singleOfferDoc.id, singleOfferDoc);
export const dualOfferTemplate: AdTemplate = adTemplateFromDoc(dualOfferDoc.id, dualOfferDoc);
