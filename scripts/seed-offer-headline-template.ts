/**
 * Seed the "Offer Headline" ad template — the modern replacement for the older
 * Vehicle Offer plates.
 *
 * Design: a white field with a brand-colour band across the bottom, an oversized
 * brand-colour price with its label stacked immediately to the right, the vehicle
 * straddling the white/band boundary, and the disclaimer + dealer lockup on the
 * band. Built to be brand-colour driven rather than art-plate driven, so one
 * template serves every automotive sub-account.
 *
 * TWO THINGS THIS TEMPLATE DOES DELIBERATELY, both learned the hard way:
 *
 *  1. It binds to the DERIVED offer fields (`_offerValue`, `_offerCurrency`,
 *     `_offerPercent`, `_offerLabel`, `_offerTerms`) rather than raw ones, so the
 *     offer engine formats them and one template covers lease / APR / discount /
 *     sale price.
 *
 *  2. Every element whose field is only populated for SOME offer types carries a
 *     `visibleWhen`. The predecessor template omitted this on `costPerThousand`
 *     — a field only computed for APR — so preflight correctly refused every
 *     lease ad built from it. An element that can be empty must be conditional.
 *
 * There is intentionally no expiration element: the raw offer end date arrives as
 * an ISO string and would render as "2026-09-08" on the artwork. It still appears
 * in the disclaimer, where prose formatting is expected.
 *
 * Seeded as a DRAFT so it can be reviewed in the builder before publishing.
 * Autonomous generation only ever resolves PUBLISHED templates.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/seed-offer-headline-template.ts [accountKey]
 * Omit accountKey to seed it GLOBAL (offered to every automotive sub-account).
 */
import { prisma } from '../src/lib/prisma';
import type { DocElement, DocLayoutBox, TemplateDoc } from '../src/lib/ad-generator/doc-types';
import { SYSTEM_FIELDS, SYSTEM_FIELD_DEFAULTS } from '../src/lib/ad-generator/system-fields';

const TEMPLATE_ID = 'offer-headline-v1';

const SIZES = [
  { id: 'square', label: 'Social Square (1080×1080)', width: 1080, height: 1080 },
  { id: 'v600', label: 'KSL Vertical (300×600)', width: 300, height: 600 },
  { id: 'v850', label: 'KSL Tall (300×850)', width: 300, height: 850 },
];

/** Near-black navy for headline copy — softer than pure black on white. */
const INK = '#0d1b3e';
/** Disclaimer sits on the brand band, so it needs to be light. */
const ON_BAND = '#e8eef7';

/** Money-style offers carry a leading "$"; APR carries a trailing "%" instead. */
const MONEY_TYPES = ['lease', 'discount', 'sales_price'];

function elements(): DocElement[] {
  return [
    // ── the band ──
    {
      id: 'band',
      type: 'shape',
      name: 'Brand band',
      shapeKind: 'rect',
      fill: 'brand',
    },

    // ── price cluster ──
    // Currency and percent are SEPARATE elements from the number so each can be
    // sized and positioned independently (the "$" reads best smaller and raised),
    // and so each can be hidden for the offer types where it doesn't apply.
    {
      id: 'offerCurrency',
      type: 'text',
      name: 'Currency mark',
      binding: { kind: 'field', key: '_offerCurrency' },
      fontWeight: 800,
      color: 'brand',
      align: 'right',
      vAlign: 'top',
      shrink: true,
      visibleWhen: { field: 'offerType', in: MONEY_TYPES },
    },
    {
      id: 'offerValue',
      type: 'text',
      name: 'Offer number',
      binding: { kind: 'field', key: '_offerValue' },
      fontWeight: 800,
      color: 'brand',
      align: 'left',
      vAlign: 'middle',
      letterSpacing: -6,
      lineHeight: 0.9,
      shrink: true,
    },
    {
      id: 'offerPercent',
      type: 'text',
      name: 'Percent mark',
      binding: { kind: 'field', key: '_offerPercent' },
      fontWeight: 800,
      color: 'brand',
      align: 'left',
      vAlign: 'middle',
      shrink: true,
      visibleWhen: { field: 'offerType', in: ['apr'] },
    },
    {
      id: 'offerLabel',
      type: 'text',
      name: 'Offer label',
      binding: { kind: 'field', key: '_offerLabel' },
      fontWeight: 800,
      color: INK,
      uppercase: true,
      lineHeight: 1.0,
      letterSpacing: 0,
      align: 'left',
      vAlign: 'middle',
      shrink: true,
    },

    // ── vehicle + terms ──
    {
      id: 'vehicleName',
      type: 'text',
      name: 'Vehicle name',
      binding: { kind: 'field', key: 'vehicleName' },
      fontWeight: 800,
      color: INK,
      align: 'left',
      vAlign: 'middle',
      shrink: true,
    },
    {
      id: 'offerTerms',
      type: 'text',
      name: 'Terms line',
      binding: { kind: 'field', key: '_offerTerms' },
      fontWeight: 700,
      color: INK,
      uppercase: true,
      align: 'left',
      vAlign: 'middle',
      shrink: true,
    },
    {
      id: 'vehicle',
      type: 'image',
      name: 'Vehicle',
      binding: { kind: 'field', key: 'vehicleImageUrl' },
      fit: 'contain',
    },

    // ── band contents ──
    {
      id: 'disclaimer',
      type: 'text',
      name: 'Disclaimer',
      binding: { kind: 'field', key: 'disclaimer' },
      fontWeight: 400,
      color: ON_BAND,
      lineHeight: 1.35,
      align: 'left',
      vAlign: 'bottom',
      shrink: true,
    },
    {
      id: 'logo',
      type: 'logo',
      name: 'Dealer logo',
      binding: { kind: 'brand', key: 'logoUrl' },
      fit: 'contain',
    },
  ];
}

type Layout = Record<string, DocLayoutBox>;

/**
 * Square — the reference proportions. The band starts at 63% and the vehicle
 * overlaps it, which is what gives the composition its depth; the vehicle's `z`
 * is therefore above the band.
 */
function squareLayout(): Layout {
  return {
    band: { x: 0, y: 0.63, w: 1, h: 0.37, z: 1 },

    // The price cluster reads left-to-right: $ · number · % · label. Each mark
    // gets its OWN horizontal lane, because a layout box is per-size and cannot
    // vary by offer type — overlapping the % and the label meant they collided on
    // every APR ad while looking fine on every lease ad.
    offerCurrency: { x: 0.05, y: 0.115, w: 0.09, h: 0.1, fontSize: 118, z: 5 },
    offerValue: { x: 0.14, y: 0.09, w: 0.36, h: 0.19, fontSize: 232, z: 5 },
    offerPercent: { x: 0.50, y: 0.115, w: 0.09, h: 0.12, fontSize: 118, z: 5 },
    // Stacked words in their own lane, clear of the % even when it's showing.
    offerLabel: { x: 0.60, y: 0.10, w: 0.33, h: 0.17, fontSize: 54, z: 5 },

    vehicleName: { x: 0.05, y: 0.295, w: 0.9, h: 0.06, fontSize: 52, z: 5 },
    offerTerms: { x: 0.05, y: 0.355, w: 0.9, h: 0.042, fontSize: 31, z: 5 },

    // Straddles the boundary — above the band, below the type.
    vehicle: { x: 0.11, y: 0.40, w: 0.82, h: 0.42, z: 3 },

    disclaimer: { x: 0.05, y: 0.895, w: 0.46, h: 0.06, fontSize: 15, z: 5 },
    logo: { x: 0.62, y: 0.885, w: 0.33, h: 0.07, z: 5 },
  };
}

/**
 * Verticals — the same reading order, restacked. At 300px wide the label can't
 * sit beside the number, so it goes above it and the number gets the full width.
 * A first pass to be refined on the builder canvas.
 */
function verticalLayout(sizeId: 'v600' | 'v850'): Layout {
  const tall = sizeId === 'v850';
  const bandTop = tall ? 0.66 : 0.62;
  return {
    band: { x: 0, y: bandTop, w: 1, h: 1 - bandTop, z: 1 },

    offerLabel: { x: 0.08, y: tall ? 0.05 : 0.06, w: 0.84, h: tall ? 0.05 : 0.06, fontSize: tall ? 20 : 18, z: 5 },
    offerCurrency: { x: 0.08, y: tall ? 0.105 : 0.125, w: 0.13, h: 0.05, fontSize: tall ? 34 : 30, z: 5 },
    offerValue: { x: 0.21, y: tall ? 0.095 : 0.115, w: 0.55, h: tall ? 0.085 : 0.095, fontSize: tall ? 82 : 72, z: 5 },
    offerPercent: { x: 0.76, y: tall ? 0.105 : 0.125, w: 0.16, h: 0.06, fontSize: tall ? 34 : 30, z: 5 },

    vehicleName: { x: 0.08, y: tall ? 0.20 : 0.225, w: 0.84, h: tall ? 0.05 : 0.055, fontSize: tall ? 19 : 17, z: 5 },
    offerTerms: { x: 0.08, y: tall ? 0.255 : 0.285, w: 0.84, h: tall ? 0.04 : 0.045, fontSize: tall ? 13 : 12, z: 5 },

    vehicle: { x: 0.05, y: tall ? 0.32 : 0.35, w: 0.9, h: tall ? 0.30 : 0.28, z: 3 },

    disclaimer: { x: 0.08, y: tall ? 0.86 : 0.83, w: 0.84, h: tall ? 0.08 : 0.09, fontSize: 8, z: 5 },
    logo: { x: 0.28, y: tall ? 0.955 : 0.945, w: 0.44, h: 0.03, z: 5 },
  };
}

function makeDoc(): TemplateDoc {
  return {
    id: TEMPLATE_ID,
    name: 'Offer Headline',
    description:
      'Oversized price on white with a brand-colour band, vehicle straddling the boundary. Covers lease, APR, discount and sale price from one design.',
    industries: ['Automotive', 'Powersports'],
    category: 'Vehicle Offer',
    tags: ['offer', 'automation-safe'],
    sizes: SIZES,
    // The fixed system-field schema — designers bind to these, never invent fields.
    fields: SYSTEM_FIELDS,
    background: { color: '#ffffff' },
    elements: elements(),
    layouts: {
      square: squareLayout(),
      v600: verticalLayout('v600'),
      v850: verticalLayout('v850'),
    },
    // Placeholder-ish defaults so the canvas reads real without looking like a
    // configured offer. The offer NUMBERS keep the canonical "XXX" scaffolding,
    // which preflight will refuse to render — that is the intended safety net.
    defaults: {
      ...SYSTEM_FIELD_DEFAULTS,
      offerType: 'lease',
      vehicleName: 'New 2026 Subaru Crosstrek AWD',
      tagline: '',
      vehicleImageUrl: '',
    },
  };
}

async function main() {
  const accountKey = process.argv[2]?.trim() || null;
  const doc = makeDoc();

  const row = await prisma.adTemplateDoc.upsert({
    where: { id: doc.id },
    create: {
      id: doc.id,
      name: doc.name,
      description: doc.description,
      doc: JSON.stringify(doc),
      // Draft on purpose: generation only resolves PUBLISHED templates, so this
      // cannot start producing ads until someone has looked at it.
      status: 'draft',
      isActive: true,
      accountKey,
      category: doc.category,
      tags: JSON.stringify(doc.tags ?? []),
      createdByName: 'Seed script',
    },
    update: {
      name: doc.name,
      description: doc.description,
      doc: JSON.stringify(doc),
      accountKey,
      category: doc.category,
      tags: JSON.stringify(doc.tags ?? []),
    },
  });

  console.log(`✔ ${row.name} (${row.id})`);
  console.log(`  scope : ${accountKey ?? 'GLOBAL — every automotive sub-account'}`);
  console.log(`  status: ${row.status} — publish it in the builder to let automation use it`);
  console.log(`  sizes : ${SIZES.map((s) => s.id).join(', ')}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('seed failed', err);
  await prisma.$disconnect();
  process.exit(1);
});
