import type { SlotRole } from './types';

/**
 * What each role IS, in a designer's words — the copy behind the slot inspector.
 *
 * The generic builder could only ever tell a designer what a layer was bound to:
 * "text, {{_offerMain}}". That is the implementation, not the intent, and it is
 * why the same lockup got rebuilt four times, once per offer type. A role can be
 * explained once: this is THE OFFER, it is the largest thing on the board, and it
 * carries whichever of lease / APR / discount / sale price the ad is running.
 *
 * `floor` is stated in real pixels because that is what legibility is measured
 * in. It mirrors `ROLE_FLOOR_PX` in `vehicle-offer-archetype.ts`, which is where
 * the layout enforces it — this file only explains it.
 */
export interface RoleNote {
  /** What to call it in the inspector. */
  label: string;
  /** One sentence: what it is for. */
  what: string;
  /** The rule the layout applies to it, when there is one worth saying. */
  rule?: string;
  /** Never shown shorter than this many real pixels, when it has a floor. */
  floorPx?: number;
}

export const ROLE_NOTES: Record<SlotRole, RoleNote> = {
  backdrop: {
    label: 'Backdrop',
    what: 'The base fill, the brand fade over it, and any texture. Everything else sits on top.',
    rule: 'Covers the whole board on every size, with bleed, so a wide board never shows an edge.',
  },
  band: {
    label: 'Brand band',
    what: 'The panel of brand colour along the bottom. The vehicle name and the disclaimer sit on it.',
    rule: 'Full-bleed across every board, and only as deep as the name and disclaimer need — so it is a brand block on a square and never a slab on a story.',
  },
  divider: {
    label: 'Plate divider',
    what: 'The hairline between the two offers. Only a two-offer design has one.',
    rule: 'Runs down the gutter on a wide board and across it on a tall one, so the two offers read as a pair of things rather than one long list.',
  },
  logo: {
    label: 'Logo lockup',
    what: 'The dealership and OEM marks. Sized in pixels, not as a share of the board.',
    rule: 'Keeps its pixel size across boards, so it never inflates on a wide one.',
    floorPx: 16,
  },
  tagline: {
    label: 'Tagline',
    what: 'The campaign line. The first thing dropped when a board runs out of room.',
    rule: 'Shed on any board whose short edge is under 280px — a small board has room for the offer or the narrative, not both.',
    floorPx: 14,
  },
  offer: {
    label: 'The offer',
    what: 'The point of the ad: the figure, the label above it, the terms below. One plate serves lease, APR, discount and sale price — the offer type decides what it says, not which layer is visible.',
    rule: 'The figure is never smaller than 34px, and the plate keeps its label / figure / terms proportions on every board.',
    floorPx: 34,
  },
  vehicle: {
    label: 'Vehicle shot',
    what: 'The product photo. Fitted inside its frame, never cropped to fill it.',
    rule: 'Shed rather than shown under 44px, where a car is a smudge instead of a product.',
    floorPx: 44,
  },
  vehicleName: {
    label: 'Vehicle name',
    what: 'Year, make and model. In a two-offer ad this is the subject, so it holds on boards where a single-offer ad would drop it.',
    floorPx: 14,
  },
  expiration: {
    label: 'Expiration',
    what: 'When the offer ends, as a pill in the brand colour.',
    rule: 'Its inset is a share of the pill, not a pixel count, so the date stays readable on a 300×250.',
    floorPx: 18,
  },
  disclaimer: {
    label: 'Disclaimer',
    what: 'The co-op and legal text. Composed from the offer, not typed.',
    rule: 'Never shed, at any size, and never given a frame under 22px — a board that cannot fit a legible disclaimer is a board this composition will not claim to support.',
    floorPx: 22,
  },
};

/** The note for an element's `role`, if it has one this build knows about. */
export function roleNote(role: string | undefined): RoleNote | undefined {
  return role ? ROLE_NOTES[role as SlotRole] : undefined;
}
