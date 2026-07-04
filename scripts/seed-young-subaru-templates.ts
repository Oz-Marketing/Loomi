/**
 * Seed the Young Subaru dealer-branded Ad Generator templates (Dark + Light).
 *
 * The dealer's designed background plates (topographic brand pattern, white
 * content zone, baked Young | Subaru lockup) live in the prod media library;
 * these templates reference their public Spaces URLs statically, one background
 * element PER SIZE (each size's layout includes only its own plate — the
 * others are simply omitted from that layout map).
 *
 * Because the lockup is baked into the artwork there is NO logo element, and
 * the bottom strip of every layout is kept clear of content.
 *
 * Seeded as account-scoped DRAFTS — designers refine the layouts in the
 * builder, then publish.
 *
 * Run (droplet or local):
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/seed-young-subaru-templates.ts [accountKey]
 * accountKey defaults to "youngSubaru" (pass e.g. demoAccount001 for local testing).
 */
import { prisma } from '../src/lib/prisma';
import type { TemplateDoc, DocElement, DocLayoutBox } from '../src/lib/ad-generator/doc-types';
import { vehicleOffer } from '../src/lib/ad-generator/templates/vehicle-offer';

const CDN = 'https://loomi-media.sfo3.digitaloceanspaces.com/media/youngSubaru';

const PLATES = {
  dark: {
    square: `${CDN}/f03f13a2eac746d48951335220de807a/Subaru_FB-1080x1080-DarkBlue.png`,
    v600: `${CDN}/e6691775c15b48448047b8d80fa54ab3/Subaru_KSL-300x600-DarkBlue.png`,
    v850: `${CDN}/a4c8f52e3cb64d2ea7297999aa78d118/Subaru_KSL-300x850-DarkBlue.png`,
  },
  light: {
    square: `${CDN}/e585c62b9ee24264a7bb570f9517e938/Subaru_FB-1080x1080-LightBlue.png`,
    v600: `${CDN}/a04c3c3293ac4f859801a8a0af074388/Subaru_KSL-300x600-LightBlue.png`,
    v850: `${CDN}/c3d74ef8facb44e7b38a7583443fb9ac/Subaru_KSL-300x850-LightBlue.png`,
  },
} as const;

const SIZES = [
  { id: 'square', label: 'Social Square (1080×1080)', width: 1080, height: 1080 },
  { id: 'v600', label: 'KSL Vertical (300×600)', width: 300, height: 600 },
  { id: 'v850', label: 'KSL Tall (300×850)', width: 300, height: 850 },
];

// The generic vehicle-offer form fields carry over unchanged (offer types,
// enrichment, compliance) — the plates replace only the background field.
const FIELDS = vehicleOffer.fields.filter((f) => f.key !== 'backgroundImage');

const DARK_SLATE = '#0f172a';
const SLATE_600 = '#334155';

/**
 * Shared element set. Dark-text elements are positioned over each plate's
 * WHITE zone in every size; white-text elements over the pattern — an
 * element's color is doc-wide, so zone placement keeps contrast per size.
 */
function elements(theme: 'dark' | 'light'): DocElement[] {
  return [
    { id: 'bg_square', type: 'image', name: 'Plate 1080×1080', binding: { kind: 'static', value: PLATES[theme].square }, fit: 'cover' },
    { id: 'bg_v600', type: 'image', name: 'Plate 300×600', binding: { kind: 'static', value: PLATES[theme].v600 }, fit: 'cover' },
    { id: 'bg_v850', type: 'image', name: 'Plate 300×850', binding: { kind: 'static', value: PLATES[theme].v850 }, fit: 'cover' },
    { id: 'tagline', type: 'text', name: 'Tagline', binding: { kind: 'field', key: 'tagline' }, fontWeight: 800, color: DARK_SLATE, lineHeight: 1.02 },
    { id: 'offerLabel', type: 'text', name: 'Offer label', binding: { kind: 'field', key: '_offerLabel' }, fontWeight: 700, color: SLATE_600, uppercase: true, letterSpacing: 2 },
    { id: 'offerMain', type: 'text', name: 'Offer', binding: { kind: 'field', key: '_offerMain' }, fontWeight: 800, color: 'brand', lineHeight: 0.95, letterSpacing: -1 },
    { id: 'offerTerms', type: 'text', name: 'Terms', binding: { kind: 'field', key: '_offerTerms' }, fontWeight: 500, color: SLATE_600 },
    { id: 'vehicle', type: 'image', name: 'Vehicle', binding: { kind: 'field', key: 'vehicleImageUrl' }, fit: 'contain' },
    { id: 'vehicleName', type: 'text', name: 'Vehicle name', binding: { kind: 'field', key: 'vehicleName' }, fontWeight: 700, color: '#ffffff', align: 'center' },
    { id: 'expiration', type: 'text', name: 'Expiration', binding: { kind: 'field', key: 'expiration' }, fontWeight: 700, color: '#ffffff', bg: 'brand', radius: 999, padding: 12, align: 'center' },
    { id: 'disclaimer', type: 'text', name: 'Disclaimer', binding: { kind: 'field', key: 'disclaimer' }, fontWeight: 400, color: '#e2e8f0', lineHeight: 1.3 },
  ];
}

type Layout = Record<string, DocLayoutBox>;

/**
 * Square layout — both plates put the white content zone at the top (≈0–0.38)
 * with the pattern below, so one layout serves both themes. Bottom ≈12% stays
 * clear — the Young | Subaru lockup is baked into the plate there.
 */
function squareLayout(): Layout {
  return {
    bg_square: { x: 0, y: 0, w: 1, h: 1, z: 0 },
    tagline: { x: 0.06, y: 0.05, w: 0.88, h: 0.1, fontSize: 56, z: 5 },
    offerLabel: { x: 0.06, y: 0.17, w: 0.6, h: 0.04, fontSize: 24, z: 5 },
    offerMain: { x: 0.06, y: 0.215, w: 0.64, h: 0.1, fontSize: 92, z: 5 },
    offerTerms: { x: 0.06, y: 0.325, w: 0.6, h: 0.04, fontSize: 22, z: 5 },
    vehicle: { x: 0.24, y: 0.4, w: 0.68, h: 0.32, z: 4 },
    vehicleName: { x: 0.06, y: 0.745, w: 0.88, h: 0.045, fontSize: 28, z: 5 },
    expiration: { x: 0.29, y: 0.805, w: 0.42, h: 0.05, fontSize: 22, z: 6 },
    disclaimer: { x: 0.04, y: 0.87, w: 0.56, h: 0.055, fontSize: 14, z: 5 },
  };
}

/** Vertical layouts share one shape: dark text in the top white zone, vehicle
 *  mid, white text below, bottom-left lockup strip (≈0.82+) kept clear. */
function verticalLayout(sizeId: 'v600' | 'v850'): Layout {
  const tall = sizeId === 'v850';
  const bgKey = sizeId === 'v600' ? 'bg_v600' : 'bg_v850';
  return {
    [bgKey]: { x: 0, y: 0, w: 1, h: 1, z: 0 },
    tagline: { x: 0.07, y: 0.04, w: 0.86, h: tall ? 0.07 : 0.09, fontSize: tall ? 32 : 30, z: 5 },
    offerLabel: { x: 0.07, y: tall ? 0.13 : 0.15, w: 0.86, h: 0.03, fontSize: 15, z: 5 },
    offerMain: { x: 0.07, y: tall ? 0.165 : 0.185, w: 0.86, h: tall ? 0.06 : 0.075, fontSize: tall ? 48 : 44, z: 5 },
    offerTerms: { x: 0.07, y: tall ? 0.235 : 0.27, w: 0.86, h: tall ? 0.04 : 0.055, fontSize: 14, z: 5 },
    vehicle: { x: 0.05, y: tall ? 0.3 : 0.35, w: 0.9, h: tall ? 0.2 : 0.21, z: 4 },
    vehicleName: { x: 0.07, y: tall ? 0.53 : 0.58, w: 0.86, h: 0.03, fontSize: 16, z: 5 },
    expiration: { x: 0.15, y: tall ? 0.58 : 0.635, w: 0.7, h: tall ? 0.035 : 0.04, fontSize: 14, z: 6 },
    disclaimer: { x: 0.07, y: tall ? 0.64 : 0.7, w: 0.86, h: tall ? 0.09 : 0.08, fontSize: 10, z: 5 },
  };
}

function makeDoc(theme: 'dark' | 'light'): TemplateDoc {
  const name = `Young Subaru Offer — ${theme === 'dark' ? 'Dark' : 'Light'}`;
  return {
    id: `young-subaru-offer-${theme}`,
    name,
    description: `Vehicle offer on the Young Subaru ${theme} topographic plate (lockup baked in) — Social Square + KSL verticals.`,
    industries: ['Automotive'],
    sizes: SIZES,
    fields: FIELDS,
    background: { color: theme === 'dark' ? '#1e293b' : '#199fdb' },
    elements: elements(theme),
    layouts: {
      square: squareLayout(),
      v600: verticalLayout('v600'),
      v850: verticalLayout('v850'),
    },
    defaults: {
      ...vehicleOffer.defaults,
      dealerName: 'Young Subaru',
      vehicleName: '2026 Subaru Outback',
      tagline: 'Adventure Starts Here',
      financialInstitution: 'Subaru Motors Finance',
      vehicleImageUrl: '',
    },
  };
}

async function main() {
  const accountKey = process.argv[2]?.trim() || 'youngSubaru';
  for (const theme of ['dark', 'light'] as const) {
    const doc = makeDoc(theme);
    const row = await prisma.adTemplateDoc.upsert({
      where: { id: doc.id },
      create: {
        id: doc.id,
        name: doc.name,
        description: doc.description,
        doc: JSON.stringify(doc),
        status: 'draft',
        accountKey,
        createdBy: 'seed-young-subaru-templates',
      },
      update: {
        name: doc.name,
        description: doc.description,
        doc: JSON.stringify(doc),
        accountKey,
      },
    });
    console.log(`upserted ${row.id} (${row.status}, account=${accountKey})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
