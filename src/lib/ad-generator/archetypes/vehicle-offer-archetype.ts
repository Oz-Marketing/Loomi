import type { AdSize } from '../types';
import type { GradientFill } from '../doc-types';
import { vehicleOffer } from '../templates/vehicle-offer';
import { vehicleDualOffer } from '../templates/vehicle-dual-offer';
import type { Archetype, ArchetypeSlot, SlotBoxes } from './types';
import { shedOrder } from './types';
import { FULL, box, column, floorFrac, isWide, pad, splitH, type Rect, type Row } from './layout';

/**
 * THE VEHICLE OFFER archetype — one or two vehicles, each with an offer, on a
 * themed background.
 *
 * Built against the Young Subaru templates because those are real: five channel
 * sizes Young actually runs (Facebook, email, Google, two KSL formats), a real
 * background treatment, all four offer types, and single AND dual variants.
 *
 * ── OFFERS ARE A LIST, NOT A SECOND IMPLEMENTATION ─────────────────────────
 *
 * `vehicleOfferArchetype(1)` and `vehicleOfferArchetype(2)` are the same
 * archetype with a different offer count. One `offerPlate(i)` builds the slots
 * for offer i, reading the fields the engine already assembles under that
 * offer's prefix — `_offerMain` for the first, `_o2_offerMain` for the second. A
 * third offer would be `offerPlate(2)` and a prefix, not a new template.
 *
 * That is the shape the `o2_` twin fields were simulating: the hand-built dual
 * doc declares a parallel set of elements, its own five layouts, and its own name
 * for every piece. Here the difference between single and dual is the number 2.
 *
 * ── ONE OFFER PLATE, FOUR TYPES ────────────────────────────────────────────
 *
 * A plate is label / figure / terms, bound to the values the offer engine
 * assembles. No per-type duplication and not one `visibleWhen` in this file,
 * because the engine has already decided what a lease says versus what an APR
 * says. A lease renders "PER MONTH LEASE / $299/mo / 36-month lease · $2,999 due
 * at signing"; an APR renders "APR / 1.9% / for 60 months".
 *
 * ── EVERY BOARD FROM ONE COMPOSITION ───────────────────────────────────────
 *
 * Wide boards put the copy beside the vehicle (single) or the plates side by side
 * (dual); tall boards stack. Rows share height by weight over pixel floors, so a
 * plate holds its proportions on a 1200×628 and on a 300×850 alike. Nothing here
 * is per-size, so a sixth channel costs nothing.
 */

export type OfferCount = 1 | 2;

/** The field prefix for offer `i` — '' for the first, 'o2_' for the second. */
function prefixFor(i: number): string {
  return i === 0 ? '' : `o${i + 1}_`;
}

/** Slot id for a per-offer piece. Offer 0 keeps the bare ids the single uses. */
function slotId(i: number, base: string): string {
  return i === 0 ? base : `${prefixFor(i)}${base}`;
}

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

/**
 * One offer's slots. `dual` centres them, because two plates side by side read as
 * a comparison and a comparison wants a shared axis.
 */
function offerPlate(i: number, dual: boolean): ArchetypeSlot[] {
  const p = prefixFor(i);
  const who = i === 0 ? 'Offer' : `Offer ${i + 1}`;
  const align = dual ? ('center' as const) : undefined;
  return [
    {
      id: slotId(i, 'vehicleName'),
      role: 'vehicleName',
      // In a SINGLE it is narrative — a caption under a product shot that already
      // shows you the car, so it goes early. In a DUAL it is the SUBJECT: two
      // prices with nothing saying which car each belongs to is not a comparison,
      // it is a riddle. So it outranks even the expiration pill there.
      //
      // The hand-tuned layouts drew the same distinction. Their 300×250 single
      // dropped the vehicle name; their 300×250 dual kept both names and dropped
      // the offer labels instead.
      shedAt: dual ? 6 : 2,
      build: (t) => ({ id: slotId(i, 'vehicleName'), type: 'text', name: `${who} vehicle`, binding: { kind: 'field', key: `${p}vehicleName` }, fontWeight: 700, color: t.ink, align: align ?? 'center', shrink: true }),
    },
    {
      id: slotId(i, 'offerLabel'),
      role: 'offer',
      // Last thing shed before the pill: two plates on a 300×250 cannot carry
      // "PER MONTH LEASE" as well as the number, and the hand-tuned dual layout
      // dropped exactly this. The single keeps it, because it has the room.
      shedAt: 4,
      build: (t) => ({ id: slotId(i, 'offerLabel'), type: 'text', name: `${who} label`, binding: { kind: 'field', key: `_${p}offerLabel` }, fontWeight: 700, color: t.muted, uppercase: true, letterSpacing: 2, align, shrink: true }),
    },
    {
      id: slotId(i, 'offerMain'),
      role: 'offer',
      build: (t) => ({ id: slotId(i, 'offerMain'), type: 'text', name: `${who} figure`, binding: { kind: 'field', key: `_${p}offerMain` }, fontWeight: 800, color: t.brand, lineHeight: 0.95, letterSpacing: -1, align }),
    },
    {
      id: slotId(i, 'offerTerms'),
      role: 'offer',
      build: (t) => ({ id: slotId(i, 'offerTerms'), type: 'text', name: `${who} terms`, binding: { kind: 'field', key: `_${p}offerTerms` }, fontWeight: 500, color: t.muted, align, shrink: true }),
    },
  ];
}

function slotsFor(offers: OfferCount): ArchetypeSlot[] {
  const dual = offers === 2;
  return [
    ...backdropSlots(),
    {
      id: 'logo',
      role: 'logo',
      build: () => ({ id: 'logo', type: 'logo', name: 'Logo', binding: { kind: 'brand', key: 'logoUrl' }, fit: 'contain' }),
    },
    {
      id: 'tagline',
      role: 'tagline',
      // First to go: a small board would rather spend its height on the offer,
      // which is what the hand-tuned 300×250 layouts did by leaving it out.
      shedAt: 1,
      build: (t) => ({ id: 'tagline', type: 'text', name: 'Tagline', binding: { kind: 'field', key: 'tagline' }, fontWeight: 800, color: t.ink, lineHeight: 1.02, align: dual ? 'center' : undefined, shrink: true }),
    },
    // A single offer gets the product shot; two offers are a comparison, and two
    // cars in a 300×250 is mush — which is why the hand-built dual is text-only.
    ...(dual
      ? []
      : [
          {
            id: 'vehicle',
            role: 'vehicle' as const,
            shedAt: 3,
            build: () => ({ id: 'vehicle', type: 'image' as const, name: 'Vehicle', binding: { kind: 'field' as const, key: 'vehicleImageUrl' }, fit: 'contain' as const }),
          },
        ]),
    ...Array.from({ length: offers }, (_, i) => offerPlate(i, dual)).flat(),
    {
      id: 'expiration',
      role: 'expiration',
      shedAt: 5,
      // NO `padding`. An element's padding is emitted as literal pixels on every
      // board, so a 12px pill inset is comfortable inside a 72px pill on Facebook
      // and eats 24 of the 30 pixels the same pill gets on a 300×250 — which left
      // the expiration date rendering at six pixels. Omitting it lets the renderer
      // apply its board-relative inset instead (see doc-renderer `fitPad`).
      build: (t) => ({ id: 'expiration', type: 'text', name: 'Expiration', binding: { kind: 'field', key: 'expiration' }, fontWeight: 700, color: t.onBrand, bg: t.brand, radius: 999, align: 'center', shrink: true }),
    },
    {
      id: 'disclaimer',
      role: 'disclaimer',
      // NOT shedable, at any size. An ad without a legible disclaimer cannot run,
      // so a board that cannot fit one is a board this archetype must refuse.
      build: (t) => ({ id: 'disclaimer', type: 'text', name: 'Disclaimer', binding: { kind: 'field', key: 'disclaimer' }, fontWeight: 400, color: t.muted, lineHeight: 1.3, align: dual ? 'center' : undefined, shrink: true }),
    },
  ];
}

// ── legibility floors, in real pixels ──────────────────────────────────────

/**
 * The shed rule is defined against these: a board carries as much as it can give
 * every slot its floor, and not one slot more.
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
 * clears its floor; it still should not have one, and the hand-tuned layouts
 * agree — Google's dropped the tagline and the vehicle name while the 300×600
 * KSL, the same width but with the height to carry them, kept both. Short edge is
 * what separates those two cases; area does not (a 600×400 email has less area
 * than a 300×850 KSL and comfortably carries everything).
 */
const NARRATIVE_MIN_SHORT_EDGE_PX = 280;
/** Slots that are narrative rather than offer: the first to go on a small board. */
const NARRATIVE_SHED_AT = 2;
/**
 * More offers on the same board is a denser ad, so it sheds further.
 *
 * Two plates halve the width each one gets, and an uppercase label with
 * letter-spacing in a 130px column shrinks to noise even though its FRAME clears
 * the height floor. The hand-tuned dual made exactly this call — its 300×250
 * comment reads "Compact — two columns, no label (space)" — while its 300×600,
 * the same width with room to breathe, keeps the labels. The single keeps its
 * label on the 300×250 because it isn't sharing the board with a second plate.
 */
const DENSE_SHED_AT = 4;

/** The floor a slot must clear on a board that claims to carry it, by role. */
const ROLE_FLOOR_PX: Record<string, number> = {
  logo: 16,
  tagline: ROW_MIN_PX,
  offer: ROW_MIN_PX,
  vehicle: VEHICLE_MIN_PX,
  vehicleName: ROW_MIN_PX,
  expiration: 18,
  disclaimer: DISCLAIMER_MIN_PX,
};

/** The offer FIGURE is the one slot with a floor of its own. */
function floorFor(slot: ArchetypeSlot): number {
  if (slot.role === 'offer' && /offerMain$/.test(slot.id)) return OFFER_MIN_PX;
  return ROLE_FLOOR_PX[slot.role] ?? ROW_MIN_PX;
}

const Z = { backdrop: 0, art: 4, copy: 5, pill: 6 } as const;

// ── the composition ────────────────────────────────────────────────────────

/** A plate's rows: the vehicle name, then label over figure over terms. */
function plateRows(i: number, has: (id: string) => boolean): Row[] {
  const rows: Row[] = [];
  if (has(slotId(i, 'vehicleName'))) rows.push({ id: slotId(i, 'vehicleName'), weight: 1, minPx: ROW_MIN_PX });
  if (has(slotId(i, 'offerLabel'))) rows.push({ id: slotId(i, 'offerLabel'), weight: 0.8, minPx: ROW_MIN_PX });
  rows.push({ id: slotId(i, 'offerMain'), weight: 3.2, minPx: OFFER_MIN_PX });
  rows.push({ id: slotId(i, 'offerTerms'), weight: 0.9, minPx: ROW_MIN_PX });
  return rows;
}

/** Logo beside the tagline across the top — the dual's header band. */
function placeHead(out: SlotBoxes, band: Rect | undefined, size: AdSize, gapPx: number, has: (id: string) => boolean): void {
  if (!band) return;
  if (!has('tagline')) {
    // Logo alone, centred, as the hand-tuned compact dual does.
    const w = band.w * 0.34;
    out.logo = box({ x: band.x + (band.w - w) / 2, y: band.y, w, h: band.h }, Z.copy);
    return;
  }
  const [l, r] = splitH(band, size, 0.2, gapPx);
  out.logo = box(l, Z.copy);
  out.tagline = box(r, Z.copy);
}

/** Stamp a z onto every rect a column produced, dropping layout-only bands. */
function boxesFrom(rects: Record<string, Rect>, z: number): SlotBoxes {
  return Object.fromEntries(
    Object.entries(rects)
      .filter(([id]) => !id.startsWith('_'))
      .map(([id, r]) => [id, box(r, z)]),
  );
}

function layoutFor(offers: OfferCount, size: AdSize, present: Set<string>): SlotBoxes {
  const marginPx = Math.max(10, Math.round(Math.min(size.width, size.height) * 0.05));
  const gapPx = Math.max(4, Math.round(Math.min(size.width, size.height) * 0.02));
  const content = pad(FULL, size, marginPx);
  const has = (id: string) => present.has(id);

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

  const wide = isWide(size);
  const plateFloor = OFFER_MIN_PX + 2 * ROW_MIN_PX;

  if (offers === 2) {
    // ── two plates: side by side on a wide board, stacked on a tall one ──
    if (wide) {
      const bands = column(
        body,
        size,
        [
          { id: '_head', weight: 1.3, minPx: 20 },
          { id: '_plates', weight: 5, minPx: plateFloor },
          ...(has('expiration') ? [{ id: 'expiration', weight: 1, minPx: 18, widthFrac: 0.34, align: 'center' } as Row] : []),
        ],
        gapPx,
      );
      placeHead(out, bands._head, size, gapPx, has);
      if (bands.expiration) out.expiration = box(bands.expiration, Z.pill);

      const [left, right] = splitH(bands._plates, size, 0.5, gapPx * 2);
      Object.assign(out, boxesFrom(column(left, size, plateRows(0, has), gapPx), Z.copy));
      Object.assign(out, boxesFrom(column(right, size, plateRows(1, has), gapPx), Z.copy));
    } else {
      const bands = column(
        body,
        size,
        [
          { id: 'logo', weight: 0.8, minPx: 16 },
          ...(has('tagline') ? [{ id: 'tagline', weight: 1.1, minPx: ROW_MIN_PX } as Row] : []),
          { id: '_plate0', weight: 4, minPx: plateFloor },
          { id: '_plate1', weight: 4, minPx: plateFloor },
          ...(has('expiration') ? [{ id: 'expiration', weight: 0.8, minPx: 18, widthFrac: 0.7, align: 'center' } as Row] : []),
        ],
        gapPx * 2,
      );
      if (bands.logo) out.logo = box(bands.logo, Z.copy);
      if (bands.tagline) out.tagline = box(bands.tagline, Z.copy);
      if (bands.expiration) out.expiration = box(bands.expiration, Z.pill);
      Object.assign(out, boxesFrom(column(bands._plate0, size, plateRows(0, has), gapPx), Z.copy));
      Object.assign(out, boxesFrom(column(bands._plate1, size, plateRows(1, has), gapPx), Z.copy));
    }
    return out;
  }

  // ── one offer: the plate's vehicle name captions the product shot instead ──
  const plate = (id: string) => has(id) && id !== 'vehicleName';

  if (wide) {
    const [left, right] = splitH(body, size, has('vehicle') ? 0.52 : 1, gapPx);
    const leftRows: Row[] = [
      { id: 'logo', weight: 1.1, minPx: 18 },
      ...(has('tagline') ? [{ id: 'tagline', weight: 1.6, minPx: 18 } as Row] : []),
      ...plateRows(0, plate),
      ...(has('expiration') ? [{ id: 'expiration', weight: 1, minPx: 20, widthFrac: 0.8 } as Row] : []),
      // With no product shot there is nothing to caption, so the name joins the copy.
      ...(!has('vehicle') && has('vehicleName') ? [{ id: 'vehicleName', weight: 1, minPx: ROW_MIN_PX } as Row] : []),
    ];
    Object.assign(out, boxesFrom(column(left, size, leftRows, gapPx), Z.copy));

    if (has('vehicle')) {
      const r = column(
        right,
        size,
        [
          { id: 'vehicle', weight: 6 },
          ...(has('vehicleName') ? [{ id: 'vehicleName', weight: 1, minPx: ROW_MIN_PX } as Row] : []),
        ],
        gapPx,
      );
      if (r.vehicle) out.vehicle = box(r.vehicle, Z.art);
      if (r.vehicleName) out.vehicleName = box(r.vehicleName, Z.copy);
    }
  } else {
    const rows: Row[] = [
      { id: 'logo', weight: 0.9, minPx: 16 },
      ...(has('tagline') ? [{ id: 'tagline', weight: 1.4, minPx: 18 } as Row] : []),
      ...plateRows(0, plate),
      ...(has('vehicle') ? [{ id: 'vehicle', weight: 3.4 } as Row] : []),
      ...(has('vehicleName') ? [{ id: 'vehicleName', weight: 0.7, minPx: ROW_MIN_PX } as Row] : []),
      ...(has('expiration') ? [{ id: 'expiration', weight: 0.8, minPx: 20, widthFrac: 0.7, align: 'center' } as Row] : []),
    ];
    Object.assign(out, boxesFrom(column(body, size, rows, gapPx), Z.copy));
    if (out.vehicle) out.vehicle = { ...out.vehicle, z: Z.art };
  }

  if (out.expiration) out.expiration = { ...out.expiration, z: Z.pill };
  return out;
}

// ── which slots a board can carry ──────────────────────────────────────────

/** Every slot on this board that came out under its floor. */
function crushed(offers: OfferCount, slots: ArchetypeSlot[], size: AdSize, keep: Set<string>): string[] {
  const boxes = layoutFor(offers, size, keep);
  return slots
    .filter((s) => keep.has(s.id) && s.role !== 'backdrop' && boxes[s.id])
    .filter((s) => boxes[s.id].h * size.height < floorFor(s) - 0.01)
    .map((s) => s.id);
}

/**
 * Shed optional slots until everything left clears its legibility floor.
 *
 * The rule the hand-tuned layouts followed by eye, stated once: the offer figure
 * and the disclaimer are the ad, so when a board cannot give every slot room, the
 * tagline goes first, then the vehicle name, then the product shot, then the
 * offer label, then the expiration pill.
 *
 * It reproduces BOTH hand-tuned templates without anyone deciding per board: the
 * single's 300×250 drops the tagline and the vehicle name, and the dual's — two
 * plates competing for the same space — also drops the offer label.
 *
 * Slots sharing a shed rank go together. Dropping offer 1's label while offer 2
 * kept its own would make two plates that are meant to be compared disagree.
 *
 * A board that still cannot carry the offer and the disclaimer after shedding
 * everything optional keeps them anyway: they degrade visibly, which is the
 * honest outcome, rather than the archetype quietly producing an ad with no price
 * on it.
 */
function presentFor(offers: OfferCount, size: AdSize, slots: ArchetypeSlot[]): Set<string> {
  const keep = new Set(slots.map((s) => s.id));

  // Density first: a small board drops the narrative slots whether or not they
  // would technically have fitted, and drops more of them the more offers it is
  // being asked to carry.
  if (Math.min(size.width, size.height) < NARRATIVE_MIN_SHORT_EDGE_PX) {
    const cutoff = offers > 1 ? DENSE_SHED_AT : NARRATIVE_SHED_AT;
    for (const s of slots) {
      if (s.shedAt != null && s.shedAt <= cutoff) keep.delete(s.id);
    }
  }

  if (crushed(offers, slots, size, keep).length === 0) return keep;

  const ranks = [...new Set(shedOrder(slots).map((s) => s.shedAt as number))].sort((a, b) => a - b);
  for (const rank of ranks) {
    for (const s of slots) if (s.shedAt === rank) keep.delete(s.id);
    if (crushed(offers, slots, size, keep).length === 0) return keep;
  }
  return keep;
}

/** The archetype for `offers` offers — 1 or 2 (or, later, more). */
export function vehicleOfferArchetype(offers: OfferCount = 1): Archetype {
  const slots = slotsFor(offers);
  const dual = offers === 2;
  return {
    id: dual ? 'vehicle-dual-offer' : 'vehicle-offer',
    name: dual ? 'Two Vehicles' : 'Vehicle Offer',
    description: dual
      ? 'Two vehicles side by side, each with its own offer — lease, APR, discount or sale price.'
      : 'One vehicle, one offer — lease, APR, discount or sale price — on a themed background.',
    slots,
    fields: dual ? vehicleDualOffer.fields : vehicleOffer.fields,
    defaults: dual ? vehicleDualOffer.defaults : vehicleOffer.defaults,
    present: (size, s) => presentFor(offers, size, s),
    layout: (size, present) => layoutFor(offers, size, present),
  };
}
