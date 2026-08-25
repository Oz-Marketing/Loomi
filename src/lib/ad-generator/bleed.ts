/**
 * How far an element may hang off its artboard, and the two clamps every
 * builder path that moves a box has to go through.
 *
 * THE BUG BEHIND THIS MODULE. An element's position is a fraction of the board,
 * and almost every move path used to bound it to `[0, 1 - w]` — flush inside the
 * artboard. That is wrong twice over. A full bleed IS an element hanging off the
 * edge (the renderer clips the overflow; it does not squash the element), and a
 * board-flush clamp is not idempotent with a hand-typed value: an X of -120px
 * survived being typed and then snapped to 0 on the next drag, nudge, align or
 * duplicate. Designers hit that as "negative X doesn't stick".
 *
 * Bounding against BLEED instead keeps both: an element can be pushed off any
 * edge (or parked entirely beside the board, where the builder shows it as
 * detached), and a position already off the board is left where it is.
 */

/** The overhang allowance, as a fraction of the board's own width/height. */
export const BLEED = 0.5;

/**
 * Clamp a box ORIGIN to the bleed range.
 *
 * `extent` is the box's own `w` (for an x) or `h` (for a y): the lower bound is
 * `-extent - BLEED` so the element can pass fully off the near edge, the upper
 * `1 + BLEED` so it can pass fully off the far one.
 */
export function clampPos(v: number, extent: number): number {
  return Math.max(-extent - BLEED, Math.min(1 + BLEED, v));
}

/**
 * A DISPLACEMENT, bounded so whatever it moves lands inside the same range.
 *
 * `start`/`extent` describe the thing being moved — one box, or a multi-select's
 * whole bounding box. Bounding the displacement (rather than each member) is what
 * keeps a lockup together when it runs into the limit.
 */
export function clampShift(d: number, start: number, extent: number): number {
  return clampPos(start + d, extent) - start;
}
