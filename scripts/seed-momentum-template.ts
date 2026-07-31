/**
 * Seed the "Momentum" offer template — one design that carries every offer type.
 *
 *   npx tsx scripts/seed-momentum-template.ts [accountKey]
 *
 * ── THE DESIGN ──
 *
 * A white stage for the vehicle sitting on a solid brand-colour plinth that holds
 * the offer. The vehicle overlaps the plinth's top edge so the two read as one
 * object rather than two stacked boxes — that overlap is the whole idea, and it's
 * why the image sits above the band in z-order with a transparent EVOX cut-out.
 *
 * Brand colour drives it: every dealer gets the same structure in their own colour,
 * so a Chevrolet ad and a Subaru ad are recognisably the same family without
 * anyone editing a layout.
 *
 * ── WHY IT WORKS FOR ALL FOUR OFFER TYPES ──
 *
 * The headline binds `_offerMain`, which `assembleOffer` composes per type:
 *
 *     lease         $399/mo        PER MONTH LEASE   36-month lease · $3,999 due…
 *     apr           2.9% APR       APR               for 60 months
 *     discount      $5,000         OFF MSRP          MSRP of $34,995
 *     sales_price   $28,995        SALES PRICE       MSRP of $34,995
 *
 * So one element is correct for every type with NO conditional visibility. The
 * predecessor split the number from its $ and % into separate conditional elements
 * for finer typography, and that bought a whole class of bugs: the `%` and the
 * label shared a lane and collided on APR, and each hidden piece left a gap to
 * reason about. Composing the string upstream is worth more than styling the
 * currency symbol a size smaller.
 *
 * `shrink: true` on the headline means the chosen size is a CAP — "$28,995" and
 * "2.9% APR" both fit their frame without anyone tuning per-offer sizes.
 *
 * ── EVENT MARK ──
 *
 * `eventLogoUrl` has a permanent slot even though it's empty most weeks; generation
 * refuses to build an ad when a REQUIRED manufacturer event has nowhere to render,
 * and preflight exempts the key so an ordinary week isn't treated as a hole.
 *
 * Idempotent upsert, seeded as `draft` — publish it in the builder before
 * automation will pick it up.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { SYSTEM_FIELDS, SYSTEM_FIELD_DEFAULTS } from '../src/lib/ad-generator/system-fields';
import type { DocElement, DocLayoutBox } from '../src/lib/ad-generator/doc-types';

const TEMPLATE_ID = 'momentum-offer-v1';

const SIZES = [
  { id: 'square', label: 'Square 1080×1080', width: 1080, height: 1080 },
  { id: 'story', label: 'Story 1080×1920', width: 1080, height: 1920 },
  { id: 'landscape', label: 'Landscape 1200×628', width: 1200, height: 628 },
];

function elements(): DocElement[] {
  return [
    // ── stage ──
    {
      id: 'bg',
      type: 'background',
      name: 'Stage',
      fill: '#ffffff',
      gradientFill: {
        type: 'linear',
        angle: 180,
        stops: [
          { color: '#ffffff', pos: 0 },
          { color: '#f2f4f7', pos: 100 },
        ],
      },
    },

    // ── the brand plinth the offer sits on ──
    //
    // FLAT, deliberately. The first version added a black stop at 18% opacity to
    // deepen the bottom corner, which rendered as a wash to near-WHITE: a gradient
    // stop's opacity is its alpha, so interpolating toward it makes the shape
    // transparent and the white stage shows through. A solid darkening colour would
    // work, but the fill is `brand` — unknown at design time — so any fixed second
    // colour is a guess that will clash for some dealer. Flat reads clean in every
    // brand colour, which is the point of the template.
    {
      id: 'plinth',
      type: 'shape',
      name: 'Brand plinth',
      shapeKind: 'rect',
      fill: 'brand',
      radiusTL: 44,
      radiusTR: 44,
    },

    // ── identity ──
    {
      id: 'logo',
      type: 'logo',
      name: 'Dealer + OEM lockup',
      binding: { kind: 'brand', key: 'logoUrl' },
      fit: 'contain',
    },
    {
      id: 'eventLogo',
      type: 'image',
      name: 'Sales event mark',
      binding: { kind: 'field', key: 'eventLogoUrl' },
      fit: 'contain',
    },

    // ── hero ──
    {
      id: 'vehicle',
      type: 'image',
      name: 'Vehicle',
      binding: { kind: 'field', key: 'vehicleImageUrl' },
      fit: 'contain',
    },

    // ── offer ──
    {
      id: 'vehicleName',
      type: 'text',
      name: 'Vehicle',
      binding: { kind: 'field', key: 'vehicleName' },
      color: '#ffffff',
      fontWeight: 600,
      uppercase: true,
      letterSpacing: 2.2,
      align: 'center',
      vAlign: 'middle',
      shrink: true,
      opacity: 82,
    },
    {
      id: 'offerMain',
      type: 'text',
      name: 'Offer',
      // One binding for every offer type — see the header.
      binding: { kind: 'field', key: '_offerMain' },
      color: '#ffffff',
      fontWeight: 800,
      letterSpacing: -2,
      lineHeight: 0.95,
      align: 'center',
      vAlign: 'middle',
      shrink: true,
    },
    {
      id: 'offerLabel',
      type: 'text',
      name: 'Offer label',
      binding: { kind: 'field', key: '_offerLabel' },
      // Hidden on APR only. `_offerMain` already ends in "APR" there ("2.9% APR"),
      // and the label is the literal word again — the one offer type where the two
      // collide. Lease keeps it: "PER MONTH LEASE" under "$399/mo" says the thing
      // the number doesn't, which is that it's a lease.
      visibleWhen: { field: 'offerType', in: ['lease', 'discount', 'sales_price'] },
      color: '#ffffff',
      fontWeight: 700,
      uppercase: true,
      letterSpacing: 3,
      align: 'center',
      vAlign: 'middle',
      shrink: true,
      opacity: 90,
    },
    {
      id: 'offerTerms',
      type: 'text',
      name: 'Terms',
      binding: { kind: 'field', key: '_offerTerms' },
      color: '#ffffff',
      fontWeight: 500,
      align: 'center',
      vAlign: 'middle',
      shrink: true,
      opacity: 78,
    },

    // ── fine print ──
    {
      id: 'disclaimer',
      type: 'text',
      name: 'Disclaimer',
      binding: { kind: 'field', key: 'disclaimer' },
      color: '#ffffff',
      fontWeight: 400,
      lineHeight: 1.25,
      align: 'center',
      vAlign: 'top',
      shrink: true,
      opacity: 62,
    },
    {
      id: 'dealerName',
      type: 'text',
      name: 'Dealer',
      // Required by GM and Subaru independently — the dealer has to be named on
      // the face of the ad, not only inside the logo lockup.
      binding: { kind: 'brand', key: 'dealerName' },
      // White, not grey: it sits low on the brand plinth, not on the white stage.
      color: '#ffffff',
      fontWeight: 600,
      uppercase: true,
      letterSpacing: 1.6,
      align: 'center',
      vAlign: 'middle',
      shrink: true,
      opacity: 70,
    },
  ];
}

type Layout = Record<string, DocLayoutBox>;

/** 1080×1080 — the workhorse. */
function square(): Layout {
  return {
    bg: { x: 0, y: 0, w: 1, h: 1 },
    plinth: { x: 0, y: 0.545, w: 1, h: 0.455 },
    logo: { x: 0.07, y: 0.055, w: 0.34, h: 0.085 },
    eventLogo: { x: 0.63, y: 0.05, w: 0.3, h: 0.095 },
    // Overlaps the plinth's top edge by ~4% — the move the whole design rests on.
    vehicle: { x: 0.05, y: 0.16, w: 0.9, h: 0.43 },
    vehicleName: { x: 0.08, y: 0.605, w: 0.84, h: 0.05, fontSize: 27 },
    offerMain: { x: 0.06, y: 0.655, w: 0.88, h: 0.135, fontSize: 150 },
    offerLabel: { x: 0.1, y: 0.795, w: 0.8, h: 0.042, fontSize: 26 },
    offerTerms: { x: 0.1, y: 0.845, w: 0.8, h: 0.038, fontSize: 23 },
    disclaimer: { x: 0.075, y: 0.888, w: 0.85, h: 0.06, fontSize: 15 },
    dealerName: { x: 0.1, y: 0.955, w: 0.8, h: 0.03, fontSize: 18 },
  };
}

/** 1080×1920 — the vertical gets a taller stage, not just a stretched square. */
function story(): Layout {
  return {
    bg: { x: 0, y: 0, w: 1, h: 1 },
    plinth: { x: 0, y: 0.56, w: 1, h: 0.44 },
    logo: { x: 0.07, y: 0.075, w: 0.36, h: 0.055 },
    eventLogo: { x: 0.63, y: 0.07, w: 0.3, h: 0.062 },
    vehicle: { x: 0.04, y: 0.235, w: 0.92, h: 0.35 },
    vehicleName: { x: 0.08, y: 0.615, w: 0.84, h: 0.032, fontSize: 30 },
    offerMain: { x: 0.06, y: 0.655, w: 0.88, h: 0.095, fontSize: 168 },
    offerLabel: { x: 0.1, y: 0.762, w: 0.8, h: 0.026, fontSize: 29 },
    offerTerms: { x: 0.1, y: 0.793, w: 0.8, h: 0.024, fontSize: 25 },
    disclaimer: { x: 0.09, y: 0.83, w: 0.82, h: 0.05, fontSize: 15 },
    dealerName: { x: 0.1, y: 0.895, w: 0.8, h: 0.022, fontSize: 19 },
  };
}

/**
 * 1200×628 — side by side, because stacking into a letterbox leaves the vehicle
 * a sliver. Vehicle left on the stage, offer right on a brand panel.
 */
function landscape(): Layout {
  return {
    bg: { x: 0, y: 0, w: 1, h: 1 },
    plinth: { x: 0.48, y: 0, w: 0.52, h: 1 },
    logo: { x: 0.045, y: 0.07, w: 0.3, h: 0.11 },
    eventLogo: { x: 0.045, y: 0.79, w: 0.24, h: 0.12 },
    vehicle: { x: 0.015, y: 0.24, w: 0.53, h: 0.5 },
    vehicleName: { x: 0.52, y: 0.14, w: 0.44, h: 0.075, fontSize: 24 },
    offerMain: { x: 0.5, y: 0.24, w: 0.48, h: 0.24, fontSize: 104 },
    offerLabel: { x: 0.51, y: 0.5, w: 0.46, h: 0.06, fontSize: 22 },
    offerTerms: { x: 0.51, y: 0.565, w: 0.46, h: 0.055, fontSize: 19 },
    disclaimer: { x: 0.51, y: 0.64, w: 0.46, h: 0.17, fontSize: 11 },
    dealerName: { x: 0.51, y: 0.87, w: 0.46, h: 0.05, fontSize: 15 },
  };
}

async function main() {
  const accountKey = process.argv[2] || null;

  const doc = {
    id: TEMPLATE_ID,
    name: 'Momentum — Offer',
    description:
      'Vehicle on a white stage over a brand-colour plinth. One layout carries lease, APR, discount and sale price.',
    category: 'Vehicle Offer',
    tags: ['offer', 'automotive', 'brand-color'],
    sizes: SIZES,
    fields: SYSTEM_FIELDS,
    defaults: SYSTEM_FIELD_DEFAULTS,
    background: { color: '#ffffff' },
    elements: elements(),
    layouts: { square: square(), story: story(), landscape: landscape() },
  };

  const row = await prisma.adTemplateDoc.upsert({
    where: { id: doc.id },
    create: {
      id: doc.id,
      name: doc.name,
      description: doc.description,
      doc: JSON.stringify(doc),
      status: 'draft',
      isActive: true,
      accountKey,
      category: doc.category,
      tags: JSON.stringify(doc.tags),
      createdByName: 'Seed script',
    },
    update: {
      name: doc.name,
      description: doc.description,
      doc: JSON.stringify(doc),
      category: doc.category,
      tags: JSON.stringify(doc.tags),
    },
  });

  console.log(`seeded template ${row.id} — "${row.name}"`);
  console.log(`  scope : ${accountKey ?? 'GLOBAL (every sub-account)'}`);
  console.log(`  status: ${row.status} — publish it in the builder before automation uses it`);
  console.log(`  sizes : ${SIZES.map((s) => s.id).join(', ')}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('seed failed', err);
  await prisma.$disconnect();
  process.exit(1);
});
