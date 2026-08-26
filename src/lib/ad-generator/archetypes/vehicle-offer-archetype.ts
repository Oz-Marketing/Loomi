import type { AdSize } from '../types';
import { disclaimerTargetPx } from '../template-audit';
import { vehicleOffer } from '../templates/vehicle-offer';
import { vehicleDualOffer } from '../templates/vehicle-dual-offer';
import type { Archetype, ArchetypeSlot, SlotBoxes } from './types';
import { FULL, box, column, pad, type Rect, type Row } from './layout';

/**
 * THE VEHICLE OFFER starting point — the blocks for one or two vehicle offers,
 * on every board.
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 *
 * Not a design. It was one: two arrangements chosen by aspect ratio, a brand band
 * with the car straddling its edge, a backdrop with a fade, shed rules, and a set
 * of weights measured off a designer's hand-built square. All of it is gone, on
 * that designer's own call — "forget trying to lay this all out to look nice, I
 * just need all required blocks to be placed on the artboards... JUST GIVE ME THE
 * PLAIN TEXT BOXES AND IMAGE SLOTS."
 *
 * The lesson worth keeping: a composition is a guess at an arrangement the
 * designer redoes anyway, and styling it is worse than useless — a themed block is
 * something they have to UNDO before they can start. Every hour spent tuning this
 * was spent on the part of the file with no lasting value.
 *
 * ── WHAT IT IS ─────────────────────────────────────────────────────────────
 *
 * Plain text boxes and image slots. Each one:
 *   - bound to the field the offer engine actually fills,
 *   - named so it is findable in the Layers panel,
 *   - grouped into a per-offer lockup so it drags as a unit,
 *   - placed, unstyled, in one plain stack on every board.
 *
 * No fills, no colours, no fonts, no weights, no background, no band, no rules.
 * The renderer's defaults apply, and the designer takes it from there.
 *
 * ── OFFERS ARE A LIST, NOT A SECOND IMPLEMENTATION ─────────────────────────
 *
 * `vehicleOfferArchetype(1)` and `(2)` are the same thing with a different offer
 * count. `offerPlate(i)` builds the blocks for offer i against the fields the
 * engine assembles under that offer's prefix — `_offerMain` for the first,
 * `_o2_offerMain` for the second. A third offer would be `offerPlate(2)`.
 *
 * ── ONE PLATE, FOUR OFFER TYPES ────────────────────────────────────────────
 *
 * A plate is label / figure / terms bound to values the offer engine has already
 * resolved, so there is no per-type duplication and not one `visibleWhen` here: a
 * lease renders "PER MONTH LEASE / $299/mo / 36-month lease · $2,999 due at
 * signing"; an APR renders "APR / 1.9% / for 60 months".
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

// ── the blocks ─────────────────────────────────────────────────────────────

/**
 * One offer's blocks: its vehicle image, then the three lines of the offer.
 *
 * They share a GROUP, which is the one piece of structure worth handing over —
 * a designer moving "the offer" drags one thing instead of marquee-selecting four
 * and hoping they stay in step.
 */
function offerPlate(i: number): ArchetypeSlot[] {
  const p = prefixFor(i);
  const who = i === 0 ? 'Offer' : `Offer ${i + 1}`;
  const group = `${slotId(i, 'offer')}|${who}`;

  return [
    {
      id: slotId(i, 'vehicle'),
      role: 'vehicle',
      group,
      build: () => ({
        id: slotId(i, 'vehicle'),
        type: 'image',
        name: `${who} vehicle image`,
        binding: { kind: 'field', key: `${p}vehicleImageUrl` },
        fit: 'contain',
      }),
    },
    {
      id: slotId(i, 'vehicleName'),
      role: 'vehicleName',
      group,
      build: () => ({
        id: slotId(i, 'vehicleName'),
        type: 'text',
        name: `${who} vehicle name`,
        binding: { kind: 'field', key: `${p}vehicleName` },
      }),
    },
    {
      id: slotId(i, 'offerLabel'),
      role: 'offer',
      group,
      build: () => ({
        id: slotId(i, 'offerLabel'),
        type: 'text',
        name: `${who} label`,
        binding: { kind: 'field', key: `_${p}offerLabel` },
      }),
    },
    {
      id: slotId(i, 'offerMain'),
      role: 'offer',
      group,
      build: () => ({
        id: slotId(i, 'offerMain'),
        type: 'text',
        name: `${who} figure`,
        binding: { kind: 'field', key: `_${p}offerMain` },
      }),
    },
    {
      id: slotId(i, 'offerTerms'),
      role: 'offer',
      group,
      build: () => ({
        id: slotId(i, 'offerTerms'),
        type: 'text',
        name: `${who} terms`,
        binding: { kind: 'field', key: `_${p}offerTerms` },
      }),
    },
  ];
}

function slotsFor(offers: OfferCount): ArchetypeSlot[] {
  return [
    {
      id: 'logo',
      role: 'logo',
      build: () => ({
        id: 'logo',
        type: 'logo',
        name: 'Logo',
        binding: { kind: 'brand', key: 'logoUrl' },
        fit: 'contain',
      }),
    },
    ...Array.from({ length: offers }, (_, i) => offerPlate(i)).flat(),
    {
      id: 'disclaimer',
      role: 'disclaimer',
      build: () => ({
        id: 'disclaimer',
        type: 'text',
        name: 'Disclaimer',
        binding: { kind: 'field', key: 'disclaimer' },
        // The one flag on any block here, and it is about CONTENT rather than
        // looks: legal text is a paragraph of unknown length, so it reflows to
        // fit rather than being set to fill whatever box it lands in. It works
        // with the `fontSize` ceiling the layout stamps on — `shrink` alone is
        // inert, because the renderer reads its cap from that.
        shrink: true,
      }),
    },
  ];
}

/** A block's minimum height in real pixels — enough to see and grab, no more. */
const GRAB_MIN_PX = 12;
/** Images want more than a line of text, so they are worth a taller floor. */
const IMAGE_MIN_PX = 32;

const Z = { art: 1, copy: 2 } as const;

/** Stamp a z onto every rect a column produced, dropping layout-only bands. */
function boxesFrom(rects: Record<string, Rect>, z: number): SlotBoxes {
  return Object.fromEntries(
    Object.entries(rects)
      .filter(([id]) => !id.startsWith('_'))
      .map(([id, r]) => [id, box(r, z)]),
  );
}

/**
 * WHERE EACH BLOCK LANDS — one plain stack, and deliberately nothing else.
 *
 * Reading order down the board: logo, then each offer's blocks, then the
 * disclaimer. Every block spans the content width, gets a floor so it is big
 * enough to grab, and a gap so none of them touch.
 *
 * NO TWO-COLUMN SPLIT for the dual, and that was a real decision rather than an
 * omission. It had one, on the reasoning that "there are two offers" is a fact
 * rather than a taste — but a designer looking at it still called it formatted,
 * and they were right: choosing that the two offers sit side by side IS an
 * arrangement, and arranging is their job. A single stack is the only genuinely
 * neutral answer, and it makes the dual behave exactly like the single.
 */
function layoutFor(offers: OfferCount, size: AdSize, present: Set<string>): SlotBoxes {
  const marginPx = Math.max(8, Math.round(Math.min(size.width, size.height) * 0.04));
  const gapPx = Math.max(4, Math.round(Math.min(size.width, size.height) * 0.02));
  const body = pad(FULL, size, marginPx);
  const has = (id: string) => present.has(id);

  /** One offer's blocks, in reading order. */
  const plate = (i: number): Row[] =>
    ([
      ['vehicle', 2.4, IMAGE_MIN_PX],
      ['vehicleName', 1, GRAB_MIN_PX],
      ['offerLabel', 0.9, GRAB_MIN_PX],
      ['offerMain', 1.6, GRAB_MIN_PX],
      ['offerTerms', 1.2, GRAB_MIN_PX],
    ] as const)
      .filter(([base]) => has(slotId(i, base)))
      .map(([base, weight, minPx]) => ({ id: slotId(i, base), weight, minPx }));

  const rows: Row[] = [
    ...(has('logo') ? [{ id: 'logo', weight: 1, minPx: IMAGE_MIN_PX } as Row] : []),
    ...Array.from({ length: offers }, (_, i) => plate(i)).flat(),
    ...(has('disclaimer') ? [{ id: 'disclaimer', weight: 1.4, minPx: GRAB_MIN_PX } as Row] : []),
  ];

  const out = boxesFrom(column(body, size, rows, gapPx), Z.copy);
  for (const id of ['vehicle', 'o2_vehicle', 'logo']) {
    if (out[id]) out[id] = { ...out[id], z: Z.art };
  }

  // THE DISCLAIMER'S CEILING — the one number this file still states.
  //
  // Not styling: `shrink` alone is inert, because the renderer reads its cap from
  // the box's `fontSize` and falls back to filling the frame without one. So an
  // uncapped disclaimer sets a co-op paragraph at whatever size its box affords,
  // which on a big board is headline size. The cap keeps legal text as legal text
  // (16px ceiling, floor rising with the board) and it is the designer's own
  // instruction: "disclaimer text should never exceed 16px."
  if (out.disclaimer) {
    // Never larger than the frame it caps. On a small board carrying every block
    // the disclaimer's row can come out under the target, and a ceiling above its
    // own box is not a ceiling — it is a number that does nothing.
    const framePx = out.disclaimer.h * size.height;
    out.disclaimer = {
      ...out.disclaimer,
      fontSize: Math.max(1, Math.floor(Math.min(disclaimerTargetPx(size), framePx))),
    };
  }
  return out;
}

/**
 * EVERY block, on every board.
 *
 * The shed rules went with the composition. They existed to keep a FINISHED
 * design legible; nothing here is finished, so shedding would only hand the
 * designer a board missing pieces they then add back by hand.
 */
function presentFor(slots: ArchetypeSlot[]): Set<string> {
  return new Set(slots.map((s) => s.id));
}

/** The starting point for `offers` offers — 1 or 2 (or, later, more). */
export function vehicleOfferArchetype(offers: OfferCount = 1): Archetype {
  const dual = offers === 2;
  return {
    id: dual ? 'vehicle-dual-offer' : 'vehicle-offer',
    name: dual ? 'Two Vehicles' : 'Vehicle Offer',
    description: dual
      ? 'Every block for two vehicle offers — image, name, label, figure and terms for each, plus a logo and disclaimer.'
      : 'Every block for one vehicle offer — image, name, label, figure and terms, plus a logo and disclaimer.',
    slots: slotsFor(offers),
    fields: dual ? vehicleDualOffer.fields : vehicleOffer.fields,
    defaults: dual ? vehicleDualOffer.defaults : vehicleOffer.defaults,
    present: (_size, s) => presentFor(s),
    layout: (size, present) => layoutFor(offers, size, present),
  };
}
