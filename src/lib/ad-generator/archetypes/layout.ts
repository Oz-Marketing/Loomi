import type { AdSize } from '../types';
import type { DocLayoutBox } from '../doc-types';

/**
 * Layout primitives for archetypes — the geometry an automotive offer ad is
 * actually composed of.
 *
 * WHY THESE AND NOT A CONSTRAINT ENGINE. A general design tool needs anchors and
 * stacks because it cannot know what it is laying out. An archetype knows: a
 * logo, a headline, an offer plate, a vehicle, an expiration pill and a
 * disclaimer, arranged one of two ways depending on whether the board is wider
 * than it is tall. Three helpers cover every board Young runs, and the whole file
 * is testable arithmetic with no rendering in it.
 *
 * Everything here works in the 0–1 fractions `DocLayoutBox` stores, but takes the
 * board's PIXEL size wherever a decision depends on real size — legibility does.
 * A fraction is not a size: 4% of a 1200px board is 48px of headroom and 4% of a
 * 250px board is ten, which is the whole reason the hand-tuned layouts drifted
 * apart from each other.
 */

/** A rectangle in board fractions. The unit every helper speaks. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

/** A board's aspect: > 1 is wider than tall. */
export function aspect(size: AdSize): number {
  return size.width / size.height;
}

/**
 * Whether this board gets the two-column treatment (copy beside the vehicle) or
 * the stacked one (copy above it).
 *
 * The threshold is the one the dual-offer template already uses — `w/h < 0.9`
 * stacks — widened slightly so a 300×250 rectangle still reads as a landscape
 * board, which is how the hand-tuned Google layout treated it.
 */
export function isWide(size: AdSize): boolean {
  return aspect(size) >= 0.95;
}

/**
 * Inset a rect by a margin expressed in PIXELS of the board's short edge.
 *
 * Margins are the one thing that must not scale with the board: a 4% margin is
 * comfortable on a 1200px board and cramped on a 300px one, so the archetypes
 * ask for a real inset and this converts it per axis.
 */
export function pad(r: Rect, size: AdSize, px: number): Rect {
  const mx = px / size.width;
  const my = px / size.height;
  return { x: r.x + mx, y: r.y + my, w: Math.max(0, r.w - mx * 2), h: Math.max(0, r.h - my * 2) };
}

/** Split a rect into left and right, `ratio` going to the left, with a pixel gutter. */
export function splitH(r: Rect, size: AdSize, ratio: number, gutterPx = 0): [Rect, Rect] {
  const g = gutterPx / size.width;
  const leftW = Math.max(0, r.w * ratio - g / 2);
  const rightW = Math.max(0, r.w - leftW - g);
  return [
    { x: r.x, y: r.y, w: leftW, h: r.h },
    { x: r.x + leftW + g, y: r.y, w: rightW, h: r.h },
  ];
}

/** One row of a {@link column}: a weight, plus the pixel floor it must clear. */
export interface Row {
  id: string;
  /** Share of the leftover height, after gaps. Relative to its siblings. */
  weight: number;
  /** Never render this row shorter than this many pixels. */
  minPx?: number;
  /** Fraction of the column's WIDTH this row occupies (default: all of it). */
  widthFrac?: number;
  /** Where the row sits across the column when narrower than it. */
  align?: 'start' | 'center';
}

/**
 * Stack rows down a rect, sharing its height by weight with pixel gaps between.
 *
 * This is where a lockup's internal proportions come from: the offer plate is a
 * column of label / number / terms, so those three keep the same relationship to
 * each other on every board, at whatever size the board affords. It is the same
 * rule the block-insert lockup follows, one level up.
 */
export function column(r: Rect, size: AdSize, rows: Row[], gapPx = 0): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  if (rows.length === 0) return out;

  // Floors are paid first, then the rest of the height is shared by weight.
  //
  // When the floors alone don't fit — too many rows for the board — everything
  // shrinks proportionally rather than overflowing. That degradation is
  // deliberate and is what `presentFor` watches for: a row that came out under
  // its floor is the signal that this board needs to carry less, not that the
  // layout should spill off the bottom.
  const gap = gapPx / size.height;
  const gaps = gap * (rows.length - 1);
  const floors = rows.map((row) => (row.minPx ? row.minPx / size.height : 0));
  const need = floors.reduce((a, b) => a + b, 0) + gaps;
  const squeeze = need > r.h && need > 0 ? r.h / need : 1;

  const paidGap = gap * squeeze;
  const paidFloors = floors.map((f) => f * squeeze);
  const free = Math.max(0, r.h - paidFloors.reduce((a, b) => a + b, 0) - paidGap * (rows.length - 1));
  const weightTotal = rows.reduce((a, row) => a + row.weight, 0) || 1;

  // Positions are QUANTIZED to the same 1e-4 grid the boxes are stored on, and
  // each row's height is derived from its neighbour's quantized top.
  //
  // Without this, contiguous rows overlap. `box` rounds x/y/w/h independently, so
  // a row whose top rounds down and whose height rounds up ends fractionally past
  // the next row's top — 0.03px on a 250px board. It never showed while every
  // caller passed a gap, because a 4px gutter swallows the error; the reference
  // composition stacks its rows flush, and the overlap invariant caught it
  // immediately.
  const tops: number[] = [];
  let cursor = r.y;
  rows.forEach((row, i) => {
    tops.push(cursor);
    cursor += paidFloors[i] + (free * row.weight) / weightTotal + paidGap;
  });
  const lastBottom = cursor - paidGap;

  rows.forEach((row, i) => {
    const top = round(tops[i]);
    const bottom = round(i + 1 < rows.length ? tops[i + 1] - paidGap : lastBottom);
    const w = r.w * (row.widthFrac ?? 1);
    const x = row.align === 'center' ? r.x + (r.w - w) / 2 : r.x;
    out[row.id] = { x, y: top, w, h: Math.max(0, round(bottom - top)) };
  });
  return out;
}

/** A rect as a stored box, with its stacking order. */
export function box(r: Rect, z: number): DocLayoutBox {
  return { x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h), z };
}

/** Boxes are compared in tests and diffed in saved docs — keep them tidy. */
export function round(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

/**
 * A pixel floor as a fraction, rounded UP to the precision boxes are stored at.
 *
 * Rounding a fraction to 4dp can cost a fraction of a pixel, which is enough to
 * put a 22px minimum at 21.996 on a 90px-tall board. Ceiling it means a floor
 * stated in pixels is still true after the box is written down.
 */
export function floorFrac(px: number, extent: number): number {
  return Math.ceil((px / extent) * 1e4) / 1e4;
}

/** How tall a rect is in real pixels on this board. */
export function heightPx(r: Rect, size: AdSize): number {
  return r.h * size.height;
}
