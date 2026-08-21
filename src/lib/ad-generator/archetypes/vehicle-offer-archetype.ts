import type { AdSize } from '../types';
import type { DocElement, GradientFill } from '../doc-types';
import { vehicleOffer } from '../templates/vehicle-offer';
import type { Archetype, ArchetypeSlot, SlotBoxes, Theme } from './types';
import { shedOrder } from './types';
import { FULL, box, column, floorFrac, isWide, pad, splitH, type Rect, type Row } from './layout';

/**
 * THE VEHICLE OFFER archetype — one vehicle, one offer, on a themed background.
 *
 * This is the prototype for the automotive-specific direction, built against the
 * Young Subaru templates because those are real: five channel sizes Young
 * actually runs (Facebook, email, Google, two KSL formats), a real background
 * treatment, and all four offer types.
 *
 * ── ONE OFFER PLATE, FOUR TYPES ────────────────────────────────────────────
 *
 * The offer is three slots — label, figure, terms — bound to the values the offer
 * engine already assembles: `_offerLabel`, `_offerMain`, `_offerTerms`. There is
 * no per-type duplication and not one `visibleWhen` in this file, because the
 * engine has already decided what a lease says versus what an APR says. A lease
 * renders "PER MONTH LEASE / $299/mo / 36-month lease · $2,999 due at signing"
 * and an APR renders "APR / 1.9% APR / for 60 months" through the same three
 * elements.
 *
 * ── EVERY BOARD FROM ONE COMPOSITION ───────────────────────────────────────
 *
 * Wide boards put the copy beside the vehicle; tall boards stack it above. Rows
 * share the height by weight, with pixel floors where legibility demands one, so
 * the relationship between the label, the figure and the terms is the same on a
 * 1200×628 as on a 300×850 — at whatever size that board can afford. Nothing here
 * is per-size, so a sixth channel costs nothing.
 */

// ── the slots ──────────────────────────────────────────────────────────────

/** Full-bleed background: base fill, a drop-in texture slot, and a white fade. */
function backdropSlots(): ArchetypeSlot[] {
  return [
    {
      id: 'bgFill',
      role: 'backdrop',
      build: (t) => ({ id: 'bgFill', type: 'shape', name: 'Background fill', fill: t.base }),
    },
    {
      id: 'bgTexture',
      role: 'backdrop',
      // Deliberately empty: the designer drops the topo in once from Textures and
      // it reflows on every board, which is what replaced the per-size plates.
      build: () => ({ id: 'bgTexture', type: 'image', name: 'Background texture', binding: { kind: 'static', value: '' }, fit: 'cover' }),
    },
    {
      id: 'bgFade',
      role: 'backdrop',
      build: (t) => {
        const { angle, end } = t.fade ?? { angle: 135, end: 70 };
        const fade: GradientFill = {
          type: 'linear',
          angle,
          stops: [
            { color: '#ffffff', pos: 0 },
            { color: '#ffffff', pos: end, opacity: 0 },
          ],
        };
        return { id: 'bgFade', type: 'shape', name: 'Background fade', gradientFill: fade };
      },
    },
  ];
}

const SLOTS: ArchetypeSlot[] = [
  ...backdropSlots(),
  {
    id: 'logo',
    role: 'logo',
    build: () => ({ id: 'logo', type: 'logo', name: 'Logo', binding: { kind: 'brand', key: 'logoUrl' }, fit: 'contain' }),
  },
  {
    id: 'tagline',
    role: 'tagline',
    // First to go: a small board would rather spend its height on the offer, which
    // is what the hand-tuned 300×250 layout did by leaving it out.
    shedAt: 1,
    build: (t) => ({ id: 'tagline', type: 'text', name: 'Tagline', binding: { kind: 'field', key: 'tagline' }, fontWeight: 800, color: t.ink, lineHeight: 1.02, shrink: true }),
  },
  {
    id: 'offerLabel',
    role: 'offer',
    build: (t) => ({ id: 'offerLabel', type: 'text', name: 'Offer label', binding: { kind: 'field', key: '_offerLabel' }, fontWeight: 700, color: t.muted, uppercase: true, letterSpacing: 2, shrink: true }),
  },
  {
    id: 'offerMain',
    role: 'offer',
    build: (t) => ({ id: 'offerMain', type: 'text', name: 'Offer', binding: { kind: 'field', key: '_offerMain' }, fontWeight: 800, color: t.brand, lineHeight: 0.95, letterSpacing: -1 }),
  },
  {
    id: 'offerTerms',
    role: 'offer',
    build: (t) => ({ id: 'offerTerms', type: 'text', name: 'Terms', binding: { kind: 'field', key: '_offerTerms' }, fontWeight: 500, color: t.muted, shrink: true }),
  },
  {
    id: 'vehicle',
    role: 'vehicle',
    shedAt: 3,
    build: () => ({ id: 'vehicle', type: 'image', name: 'Vehicle', binding: { kind: 'field', key: 'vehicleImageUrl' }, fit: 'contain' }),
  },
  {
    id: 'vehicleName',
    role: 'vehicleName',
    shedAt: 2,
    build: (t) => ({ id: 'vehicleName', type: 'text', name: 'Vehicle name', binding: { kind: 'field', key: 'vehicleName' }, fontWeight: 700, color: t.ink, align: 'center', shrink: true }),
  },
  {
    id: 'expiration',
    role: 'expiration',
    shedAt: 4,
    build: (t) => ({ id: 'expiration', type: 'text', name: 'Expiration', binding: { kind: 'field', key: 'expiration' }, fontWeight: 700, color: t.onBrand, bg: t.brand, radius: 999, padding: 12, align: 'center', shrink: true }),
  },
  {
    id: 'disclaimer',
    role: 'disclaimer',
    // NOT shedable, at any size. An ad without a legible disclaimer cannot run,
    // so a board that can't fit one is a board this archetype must refuse.
    build: (t) => ({ id: 'disclaimer', type: 'text', name: 'Disclaimer', binding: { kind: 'field', key: 'disclaimer' }, fontWeight: 400, color: t.muted, lineHeight: 1.3, shrink: true }),
  },
];

// ── legibility floors, in real pixels ──────────────────────────────────────

/**
 * Legibility floors, in real pixels. The shed rule is defined against these: a
 * board carries as much as it can give every slot its floor, and not one slot more.
 *
 * They are the difference between this and the hand-tuned layouts, which stated
 * everything as a fraction and so had no way to know that 4.5% of a 250px board
 * is eleven pixels of disclaimer.
 */
/** The disclaimer's frame never gets less than this, so co-op text stays readable. */
const DISCLAIMER_MIN_PX = 22;
/** Below this, the offer figure is too small to be the point of the ad. */
const OFFER_MIN_PX = 34;
/** Any other line of copy. */
const ROW_MIN_PX = 14;
/** A vehicle smaller than this is a smudge, not a product shot. */
const VEHICLE_MIN_PX = 44;
/**
 * Below this short edge, a board carries a price and a car — not a story.
 *
 * A DENSITY rule, separate from the legibility floors, and the one thing here
 * that is a judgement rather than arithmetic. A 300×250 can fit a tagline that
 * clears its floor; it still shouldn't have one, and the hand-tuned layouts agree
 * — Google's dropped the tagline and the vehicle name while the 300×600 KSL, which
 * is the same width but has the height to carry them, kept both. Short edge is
 * what separates those two cases; area doesn't (a 600×400 email has less area
 * than a 300×850 KSL and comfortably carries everything).
 */
const NARRATIVE_MIN_SHORT_EDGE_PX = 280;
/** Slots that are narrative rather than offer: the first to go on a small board. */
const NARRATIVE_SHED_AT = 2;

/** The floor each slot must clear on a board that claims to carry it. */
const FLOOR_PX: Record<string, number> = {
  logo: 16,
  tagline: ROW_MIN_PX,
  offerLabel: ROW_MIN_PX,
  offerMain: OFFER_MIN_PX,
  offerTerms: ROW_MIN_PX,
  vehicle: VEHICLE_MIN_PX,
  vehicleName: ROW_MIN_PX,
  expiration: 18,
  disclaimer: DISCLAIMER_MIN_PX,
};

const Z = { backdrop: 0, art: 4, copy: 5, pill: 6 } as const;

// ── which slots a board can carry ──────────────────────────────────────────

/** Every slot on this board that came out under its floor. */
function crushed(size: AdSize, keep: Set<string>): string[] {
  const boxes = layoutFor(size, keep);
  return Object.entries(FLOOR_PX)
    .filter(([id, floor]) => keep.has(id) && boxes[id] && boxes[id].h * size.height < floor - 0.01)
    .map(([id]) => id);
}

/**
 * Shed optional slots until everything left clears its legibility floor.
 *
 * The rule the hand-tuned layouts followed by eye, stated once: the offer and the
 * disclaimer are the ad, so when a board can't give every slot room, the tagline
 * goes first, then the vehicle name, then the vehicle, then the expiration pill.
 * It reproduces the 300×250 layout — which dropped the tagline and the vehicle
 * name — with nobody deciding that per board.
 *
 * A board that still can't carry the offer and the disclaimer after shedding
 * everything optional keeps them anyway: they degrade visibly, which is the
 * honest outcome, rather than the archetype quietly producing an ad with no price
 * on it.
 */
function presentFor(size: AdSize, slots: ArchetypeSlot[]): Set<string> {
  const keep = new Set(slots.map((s) => s.id));

  // Density first: a small board drops the narrative slots whether or not they
  // would technically have fitted.
  if (Math.min(size.width, size.height) < NARRATIVE_MIN_SHORT_EDGE_PX) {
    for (const s of slots) {
      if (s.shedAt != null && s.shedAt <= NARRATIVE_SHED_AT) keep.delete(s.id);
    }
  }

  if (crushed(size, keep).length === 0) return keep;

  // Then legibility: keep shedding while anything left is being crushed.
  for (const s of shedOrder(slots)) {
    if (!keep.has(s.id)) continue;
    keep.delete(s.id);
    if (crushed(size, keep).length === 0) return keep;
  }
  return keep;
}

// ── the composition ────────────────────────────────────────────────────────

/** The offer plate: label over figure over terms. THE lockup of this archetype. */
function offerRows(): Row[] {
  return [
    { id: 'offerLabel', weight: 0.8, minPx: ROW_MIN_PX },
    { id: 'offerMain', weight: 3.2, minPx: OFFER_MIN_PX },
    { id: 'offerTerms', weight: 0.9, minPx: ROW_MIN_PX },
  ];
}

function layoutFor(size: AdSize, present: Set<string>): SlotBoxes {
  const marginPx = Math.max(10, Math.round(Math.min(size.width, size.height) * 0.05));
  const gapPx = Math.max(4, Math.round(Math.min(size.width, size.height) * 0.02));
  const content = pad(FULL, size, marginPx);

  const out: SlotBoxes = {};
  // Backdrop layers are always full bleed, and always behind.
  out.bgFill = box(FULL, Z.backdrop);
  out.bgTexture = box(FULL, Z.backdrop + 1);
  out.bgFade = box(FULL, Z.backdrop + 2);

  // The disclaimer is a full-width strip pinned to the bottom, taken out of the
  // content box before anything else is placed — it is the one thing that cannot
  // be squeezed by whatever happens above it.
  const discH = Math.max(floorFrac(DISCLAIMER_MIN_PX, size.height), 0.05);
  const disc: Rect = { x: content.x, y: content.y + content.h - discH, w: content.w, h: discH };
  out.disclaimer = box(disc, Z.copy);
  const body: Rect = { x: content.x, y: content.y, w: content.w, h: content.h - discH - gapPx / size.height };

  const has = (id: string) => present.has(id);

  if (isWide(size)) {
    // ── wide: copy on the left, vehicle on the right ──
    const [left, right] = splitH(body, size, has('vehicle') ? 0.52 : 1, gapPx);

    const leftRows: Row[] = [
      { id: 'logo', weight: 1.1, minPx: 18 },
      ...(has('tagline') ? [{ id: 'tagline', weight: 1.6, minPx: 18 } as Row] : []),
      ...offerRows(),
      ...(has('expiration') ? [{ id: 'expiration', weight: 1, minPx: 20, widthFrac: 0.8 } as Row] : []),
    ];
    Object.assign(out, boxesFrom(column(left, size, leftRows, gapPx), Z.copy));

    if (has('vehicle')) {
      const rightRows: Row[] = [
        { id: 'vehicle', weight: 6 },
        ...(has('vehicleName') ? [{ id: 'vehicleName', weight: 1, minPx: 16 } as Row] : []),
      ];
      const r = column(right, size, rightRows, gapPx);
      if (r.vehicle) out.vehicle = box(r.vehicle, Z.art);
      if (r.vehicleName) out.vehicleName = box(r.vehicleName, Z.copy);
    }
  } else {
    // ── tall: one stacked column ──
    const rows: Row[] = [
      { id: 'logo', weight: 0.9, minPx: 16 },
      ...(has('tagline') ? [{ id: 'tagline', weight: 1.4, minPx: 18 } as Row] : []),
      ...offerRows(),
      ...(has('vehicle') ? [{ id: 'vehicle', weight: 3.4 } as Row] : []),
      ...(has('vehicleName') ? [{ id: 'vehicleName', weight: 0.7, minPx: 16 } as Row] : []),
      ...(has('expiration') ? [{ id: 'expiration', weight: 0.8, minPx: 20, widthFrac: 0.7, align: 'center' } as Row] : []),
    ];
    Object.assign(out, boxesFrom(column(body, size, rows, gapPx), Z.copy));
    if (out.vehicle) out.vehicle = { ...out.vehicle, z: Z.art };
  }

  if (out.expiration) out.expiration = { ...out.expiration, z: Z.pill };
  return out;
}

/** Stamp a z onto every rect a column produced. */
function boxesFrom(rects: Record<string, Rect>, z: number): SlotBoxes {
  return Object.fromEntries(Object.entries(rects).map(([id, r]) => [id, box(r, z)]));
}

export const vehicleOfferArchetype: Archetype = {
  id: 'vehicle-offer',
  name: 'Vehicle Offer',
  description: 'One vehicle, one offer — lease, APR, discount or sale price — on a themed background.',
  slots: SLOTS,
  fields: vehicleOffer.fields,
  defaults: vehicleOffer.defaults,
  present: presentFor,
  layout: layoutFor,
};

/** Elements this archetype places, for tests and for the slot inspector. */
export function slotIds(): string[] {
  return SLOTS.map((s) => s.id);
}

/** The role each slot fills — what a compliance check reads instead of guessing. */
export function slotRole(id: string): DocElement['type'] | undefined {
  return SLOTS.find((s) => s.id === id)?.build({ base: '', brand: '', ink: '', muted: '', onBrand: '' }).type;
}
