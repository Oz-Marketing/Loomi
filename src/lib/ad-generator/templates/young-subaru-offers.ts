import type { TemplateDoc, DocElement, DocLayoutBox, GradientFill } from '../doc-types';
import { vehicleOffer } from './vehicle-offer';
import { vehicleDualOffer } from './vehicle-dual-offer';

/**
 * Young Subaru offer templates. The background is plain full-bleed LAYERS (no
 * dedicated element type): a base-fill Shape, an empty texture-slot Image (the
 * designer drops the topo in once from the Textures library), and a white fade
 * Shape — plus a Young|Subaru logo element. One background reflows across every
 * size, replacing the old per-size Illustrator plates.
 *
 * Two docs — Single Offer and Dual Offer (each offer being APR / Lease /
 * Discount / Sales Price via the shared offer engine; the dual runs a second
 * offer through the `o2_` fields). Light-blue Subaru theme. Sizes cover the
 * channels Young Subaru runs: Email, Facebook, Google, KSL.
 *
 * Pure data (no DB) so it's unit-testable + imported by the seed script.
 */

// ── palette (light-blue Subaru theme) ──
const BASE = '#199fdb'; // Subaru light blue — the Background base fill
const BRAND = '#0a3d8f'; // Subaru deep blue — offer accent + expiration pill
const INK = '#0f172a';
const SLATE = '#334155';

// ── channels / sizes ──
export const YOUNG_SUBARU_SIZES = [
  { id: 'fb', label: 'Facebook Feed (1200×628)', width: 1200, height: 628 },
  { id: 'email', label: 'Email Banner (600×400)', width: 600, height: 400 },
  { id: 'google', label: 'Google Med. Rectangle (300×250)', width: 300, height: 250 },
  { id: 'ksl600', label: 'KSL Vertical (300×600)', width: 300, height: 600 },
  { id: 'ksl850', label: 'KSL Tall (300×850)', width: 300, height: 850 },
];

/** Box helper. */
function b(x: number, y: number, w: number, h: number, z: number, fontSize?: number): DocLayoutBox {
  return fontSize != null ? { x, y, w, h, z, fontSize } : { x, y, w, h, z };
}

/** The background as plain full-bleed layers (no dedicated element type): a base
 *  fill Shape, an empty texture-slot Image (designer drops the topo in), and a
 *  white fade Shape on top. Fade angle/length differ by set (single = diagonal;
 *  dual = top band). */
function backgroundLayers(fadeAngle: number, fadeEnd: number): DocElement[] {
  const fade: GradientFill = { type: 'linear', angle: fadeAngle, stops: [{ color: '#ffffff', pos: 0 }, { color: '#ffffff', pos: fadeEnd, opacity: 0 }] };
  return [
    { id: 'bgFill', type: 'shape', name: 'Background fill', fill: BASE },
    { id: 'bgTexture', type: 'image', name: 'Background texture', binding: { kind: 'static', value: '' }, fit: 'cover' },
    { id: 'bgFade', type: 'shape', name: 'Background fade', gradientFill: fade },
  ];
}

/** Full-bleed boxes for the three background layers, at the back of every size. */
function backgroundBoxes(): Record<string, DocLayoutBox> {
  return { bgFill: b(0, 0, 1, 1, 0), bgTexture: b(0, 0, 1, 1, 1), bgFade: b(0, 0, 1, 1, 2) };
}

const logoEl: DocElement = { id: 'logo', type: 'logo', name: 'Young | Subaru logo', binding: { kind: 'brand', key: 'logoUrl' }, fit: 'contain' };

const SUBARU_DEFAULTS = { dealerName: 'Young Subaru', brandColor: BRAND, financialInstitution: 'Subaru Motors Finance' };

// ── SINGLE OFFER ──────────────────────────────────────────────────────────
function singleElements(): DocElement[] {
  return [
    ...backgroundLayers(135, 70),
    logoEl,
    { id: 'tagline', type: 'text', name: 'Tagline', binding: { kind: 'field', key: 'tagline' }, fontWeight: 800, color: INK, lineHeight: 1.02 },
    { id: 'offerLabel', type: 'text', name: 'Offer label', binding: { kind: 'field', key: '_offerLabel' }, fontWeight: 700, color: SLATE, uppercase: true, letterSpacing: 2 },
    { id: 'offerMain', type: 'text', name: 'Offer', binding: { kind: 'field', key: '_offerMain' }, fontWeight: 800, color: 'brand', lineHeight: 0.95, letterSpacing: -1 },
    { id: 'offerTerms', type: 'text', name: 'Terms', binding: { kind: 'field', key: '_offerTerms' }, fontWeight: 500, color: SLATE },
    { id: 'vehicle', type: 'image', name: 'Vehicle', binding: { kind: 'field', key: 'vehicleImageUrl' }, fit: 'contain' },
    { id: 'vehicleName', type: 'text', name: 'Vehicle name', binding: { kind: 'field', key: 'vehicleName' }, fontWeight: 700, color: INK, align: 'center' },
    { id: 'expiration', type: 'text', name: 'Expiration', binding: { kind: 'field', key: 'expiration' }, fontWeight: 700, color: '#ffffff', bg: 'brand', radius: 999, padding: 12, align: 'center' },
    { id: 'disclaimer', type: 'text', name: 'Disclaimer', binding: { kind: 'field', key: 'disclaimer' }, fontWeight: 400, color: SLATE, lineHeight: 1.3 },
  ];
}

const singleLayouts: Record<string, Record<string, DocLayoutBox>> = {
  fb: {
    ...backgroundBoxes(), logo: b(0.04, 0.08, 0.13, 0.12, 5),
    tagline: b(0.04, 0.24, 0.46, 0.12, 5, 40),
    offerLabel: b(0.04, 0.4, 0.44, 0.06, 5, 20), offerMain: b(0.04, 0.455, 0.46, 0.19, 5, 78), offerTerms: b(0.04, 0.65, 0.46, 0.07, 5, 18),
    vehicle: b(0.5, 0.22, 0.47, 0.58, 4), vehicleName: b(0.5, 0.82, 0.47, 0.07, 5, 22),
    expiration: b(0.04, 0.85, 0.32, 0.09, 6, 18), disclaimer: b(0.5, 0.92, 0.47, 0.06, 5, 11),
  },
  email: {
    ...backgroundBoxes(), logo: b(0.05, 0.07, 0.16, 0.13, 5),
    tagline: b(0.05, 0.24, 0.5, 0.13, 5, 22),
    offerLabel: b(0.05, 0.41, 0.46, 0.07, 5, 12), offerMain: b(0.05, 0.48, 0.5, 0.2, 5, 44), offerTerms: b(0.05, 0.69, 0.5, 0.08, 5, 11),
    vehicle: b(0.52, 0.2, 0.45, 0.6, 4), vehicleName: b(0.52, 0.82, 0.45, 0.08, 5, 13),
    expiration: b(0.05, 0.84, 0.4, 0.1, 6, 12), disclaimer: b(0.05, 0.93, 0.9, 0.06, 5, 8),
  },
  google: {
    ...backgroundBoxes(), logo: b(0.05, 0.06, 0.28, 0.13, 5),
    offerLabel: b(0.05, 0.28, 0.55, 0.09, 5, 13), offerMain: b(0.05, 0.37, 0.6, 0.26, 5, 50), offerTerms: b(0.05, 0.65, 0.6, 0.1, 5, 11),
    vehicle: b(0.55, 0.28, 0.42, 0.48, 4),
    expiration: b(0.05, 0.82, 0.5, 0.12, 6, 12), disclaimer: b(0.05, 0.95, 0.9, 0.045, 5, 7),
  },
  ksl600: {
    ...backgroundBoxes(), logo: b(0.07, 0.04, 0.3, 0.06, 5),
    tagline: b(0.07, 0.12, 0.86, 0.1, 5, 28),
    offerLabel: b(0.07, 0.24, 0.86, 0.035, 5, 15), offerMain: b(0.07, 0.28, 0.86, 0.09, 5, 54), offerTerms: b(0.07, 0.38, 0.86, 0.05, 5, 14),
    vehicle: b(0.06, 0.46, 0.88, 0.24, 4), vehicleName: b(0.07, 0.72, 0.86, 0.04, 5, 18),
    expiration: b(0.15, 0.79, 0.7, 0.05, 6, 15), disclaimer: b(0.07, 0.87, 0.86, 0.08, 5, 10),
  },
  ksl850: {
    ...backgroundBoxes(), logo: b(0.07, 0.03, 0.3, 0.045, 5),
    tagline: b(0.07, 0.09, 0.86, 0.08, 5, 30),
    offerLabel: b(0.07, 0.19, 0.86, 0.03, 5, 16), offerMain: b(0.07, 0.225, 0.86, 0.07, 5, 58), offerTerms: b(0.07, 0.31, 0.86, 0.04, 5, 15),
    vehicle: b(0.06, 0.37, 0.88, 0.24, 4), vehicleName: b(0.07, 0.63, 0.86, 0.035, 5, 18),
    expiration: b(0.15, 0.69, 0.7, 0.04, 6, 15), disclaimer: b(0.07, 0.76, 0.86, 0.09, 5, 11),
  },
};

// ── DUAL OFFER ──────────────────────────────────────────────────────────────
/** Text-only column (matches the generic dualOfferDoc): name / label / main / terms. */
function column(prefix: string, idp: string): DocElement[] {
  const who = idp === '' ? 'Offer 1' : 'Offer 2';
  return [
    { id: `${idp}name`, type: 'text', name: `${who} vehicle`, binding: { kind: 'field', key: `${prefix}vehicleName` }, fontWeight: 700, color: INK, align: 'center' },
    { id: `${idp}label`, type: 'text', name: `${who} label`, binding: { kind: 'field', key: `_${prefix}offerLabel` }, fontWeight: 700, color: SLATE, uppercase: true, letterSpacing: 2, align: 'center' },
    { id: `${idp}main`, type: 'text', name: `${who} offer`, binding: { kind: 'field', key: `_${prefix}offerMain` }, fontWeight: 800, color: INK, lineHeight: 0.95, align: 'center' },
    { id: `${idp}terms`, type: 'text', name: `${who} terms`, binding: { kind: 'field', key: `_${prefix}offerTerms` }, fontWeight: 500, color: SLATE, align: 'center' },
  ];
}

function dualElements(): DocElement[] {
  return [
    ...backgroundLayers(180, 45),
    logoEl,
    { id: 'tagline', type: 'text', name: 'Tagline', binding: { kind: 'field', key: 'tagline' }, fontWeight: 800, color: INK, lineHeight: 1.02, align: 'center' },
    ...column('', ''),
    ...column('o2_', 'o2_'),
    { id: 'expiration', type: 'text', name: 'Expiration', binding: { kind: 'field', key: 'expiration' }, fontWeight: 700, color: '#ffffff', bg: 'brand', radius: 999, padding: 12, align: 'center' },
    { id: 'disclaimer', type: 'text', name: 'Disclaimer', binding: { kind: 'field', key: 'disclaimer' }, fontWeight: 400, color: SLATE, lineHeight: 1.3, align: 'center' },
  ];
}

const dualLayouts: Record<string, Record<string, DocLayoutBox>> = {
  // Side-by-side: two columns.
  fb: {
    ...backgroundBoxes(), logo: b(0.04, 0.07, 0.11, 0.13, 5), tagline: b(0.17, 0.08, 0.66, 0.11, 5, 36),
    name: b(0.05, 0.32, 0.42, 0.08, 5, 30), label: b(0.05, 0.42, 0.42, 0.06, 5, 20), main: b(0.05, 0.48, 0.42, 0.19, 5, 72), terms: b(0.05, 0.68, 0.42, 0.08, 5, 18),
    o2_name: b(0.53, 0.32, 0.42, 0.08, 5, 30), o2_label: b(0.53, 0.42, 0.42, 0.06, 5, 20), o2_main: b(0.53, 0.48, 0.42, 0.19, 5, 72), o2_terms: b(0.53, 0.68, 0.42, 0.08, 5, 18),
    expiration: b(0.37, 0.85, 0.26, 0.09, 6, 18), disclaimer: b(0.05, 0.94, 0.9, 0.05, 5, 11),
  },
  email: {
    ...backgroundBoxes(), logo: b(0.05, 0.06, 0.14, 0.13, 5), tagline: b(0.2, 0.07, 0.6, 0.11, 5, 20),
    name: b(0.05, 0.28, 0.42, 0.08, 5, 16), label: b(0.05, 0.38, 0.42, 0.05, 5, 11), main: b(0.05, 0.44, 0.42, 0.2, 5, 42), terms: b(0.05, 0.65, 0.42, 0.08, 5, 10),
    o2_name: b(0.53, 0.28, 0.42, 0.08, 5, 16), o2_label: b(0.53, 0.38, 0.42, 0.05, 5, 11), o2_main: b(0.53, 0.44, 0.42, 0.2, 5, 42), o2_terms: b(0.53, 0.65, 0.42, 0.08, 5, 10),
    expiration: b(0.37, 0.84, 0.26, 0.1, 6, 12), disclaimer: b(0.05, 0.94, 0.9, 0.05, 5, 7),
  },
  // Compact — two columns, no label (space).
  google: {
    ...backgroundBoxes(), logo: b(0.36, 0.05, 0.28, 0.13, 5),
    name: b(0.04, 0.24, 0.44, 0.08, 5, 13), main: b(0.04, 0.34, 0.44, 0.22, 5, 34), terms: b(0.04, 0.57, 0.44, 0.11, 5, 9),
    o2_name: b(0.52, 0.24, 0.44, 0.08, 5, 13), o2_main: b(0.52, 0.34, 0.44, 0.22, 5, 34), o2_terms: b(0.52, 0.57, 0.44, 0.11, 5, 9),
    expiration: b(0.3, 0.8, 0.4, 0.12, 6, 11), disclaimer: b(0.04, 0.94, 0.92, 0.05, 5, 6),
  },
  // Stacked: offer 1 over offer 2.
  ksl600: {
    ...backgroundBoxes(), logo: b(0.07, 0.04, 0.3, 0.05, 5), tagline: b(0.07, 0.1, 0.86, 0.06, 5, 22),
    name: b(0.07, 0.19, 0.86, 0.05, 5, 20), label: b(0.07, 0.25, 0.86, 0.03, 5, 14), main: b(0.07, 0.285, 0.86, 0.08, 5, 50), terms: b(0.07, 0.375, 0.86, 0.045, 5, 13),
    o2_name: b(0.07, 0.48, 0.86, 0.05, 5, 20), o2_label: b(0.07, 0.54, 0.86, 0.03, 5, 14), o2_main: b(0.07, 0.575, 0.86, 0.08, 5, 50), o2_terms: b(0.07, 0.665, 0.86, 0.045, 5, 13),
    expiration: b(0.15, 0.77, 0.7, 0.05, 6, 15), disclaimer: b(0.07, 0.85, 0.86, 0.1, 5, 10),
  },
  ksl850: {
    ...backgroundBoxes(), logo: b(0.07, 0.03, 0.3, 0.04, 5), tagline: b(0.07, 0.08, 0.86, 0.05, 5, 24),
    name: b(0.07, 0.16, 0.86, 0.04, 5, 22), label: b(0.07, 0.21, 0.86, 0.025, 5, 15), main: b(0.07, 0.24, 0.86, 0.07, 5, 54), terms: b(0.07, 0.32, 0.86, 0.035, 5, 14),
    o2_name: b(0.07, 0.44, 0.86, 0.04, 5, 22), o2_label: b(0.07, 0.49, 0.86, 0.025, 5, 15), o2_main: b(0.07, 0.52, 0.86, 0.07, 5, 54), o2_terms: b(0.07, 0.6, 0.86, 0.035, 5, 14),
    expiration: b(0.15, 0.7, 0.7, 0.04, 6, 16), disclaimer: b(0.07, 0.78, 0.86, 0.12, 5, 11),
  },
};

export const youngSubaruSingleOfferDoc: TemplateDoc = {
  id: 'young-subaru-single-offer',
  name: 'Young Subaru — Single Offer',
  description: 'One offer on the native Young Subaru background (base fill + fade + drop-in topo texture) — Email, Facebook, Google, KSL.',
  industries: ['Automotive'],
  sizes: YOUNG_SUBARU_SIZES,
  fields: vehicleOffer.fields,
  elements: singleElements(),
  layouts: singleLayouts,
  defaults: { ...vehicleOffer.defaults, ...SUBARU_DEFAULTS, vehicleName: '2026 Subaru Outback', tagline: 'Adventure Starts Here', vehicleImageUrl: '' },
};

export const youngSubaruDualOfferDoc: TemplateDoc = {
  id: 'young-subaru-dual-offer',
  name: 'Young Subaru — Dual Offer',
  description: 'Two offers (each APR / Lease / Discount / Sales Price) on the native Young Subaru background — Email, Facebook, Google, KSL.',
  industries: ['Automotive'],
  sizes: YOUNG_SUBARU_SIZES,
  fields: vehicleDualOffer.fields,
  elements: dualElements(),
  layouts: dualLayouts,
  defaults: {
    ...vehicleDualOffer.defaults,
    ...SUBARU_DEFAULTS,
    tagline: 'Two Ways to Adventure',
    vehicleName: '2026 Outback',
    vehicleImageUrl: '',
    o2_vehicleName: '2026 Forester',
    o2_vehicleImageUrl: '',
    o2_financialInstitution: 'Subaru Motors Finance',
  },
};

export const youngSubaruOfferDocs = [youngSubaruSingleOfferDoc, youngSubaruDualOfferDoc];
