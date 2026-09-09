/**
 * How far past the artboard things may be pushed.
 *
 * Elements bleed on purpose: the renderer CLIPS overflow rather than squashing
 * it, so a background or a hero shot hanging off the edge is a normal design,
 * not a mistake. The recurring bug is not the bleed itself — it is two code
 * paths disagreeing about it. One allows the overhang and another, further down,
 * re-clamps to the artboard and quietly takes it away. That has now happened on
 * the single-element drag, on group drag, on group resize, and on arrow-key
 * nudge, each found separately.
 *
 * This module exists so the range is written once and the rule is testable
 * without standing up the builder. Pure: no React, no DOM.
 */

/** Fraction of the board an element may hang past each edge. */
export const BLEED = 0.5;

/** Smallest element edge, as a fraction of the board. */
export const MIN_FRAC = 0.03;

export interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface MoveRange {
  minDx: number;
  maxDx: number;
  minDy: number;
  maxDy: number;
}

/**
 * How far a group of elements may be dragged, as a delta on its bounding box.
 *
 * The group's bounding box stands in for a single element's box, so a lockup
 * obeys exactly the rule one element does — `clamp(x, -w - BLEED, 1 + BLEED)`:
 * it may travel fully off the board and parks `BLEED` beyond the far edge.
 *
 * Going fully off is not a separate state to guard against. `isDetached` is
 * derived from the box, so a group dragged off means precisely what dragging
 * each of its members off individually already meant.
 *
 * These used to be `-left` / `1 - right`, which pinned the bounding box flush
 * inside the artboard. The effect was that a bleeding lockup could be built one
 * element at a time but never moved as a unit, and grouping a design that
 * already bled snapped it back on the first drag.
 */
export function groupMoveRange(b: Bounds, bleed: number = BLEED): MoveRange {
  return {
    minDx: -b.right - bleed,
    maxDx: 1 + bleed - b.left,
    minDy: -b.bottom - bleed,
    maxDy: 1 + bleed - b.top,
  };
}

/**
 * Clamp one coordinate into the bleed range for an element of size `extent`.
 *
 * The move-time rule, matching `computeBox`'s `move` branch. Idempotent —
 * clamping an already-clamped value changes nothing — which is the property the
 * old artboard clamp lacked and the reason a second pass could undo the first.
 */
export function clampToBleed(v: number, extent: number, bleed: number = BLEED): number {
  const lo = -extent - bleed;
  const hi = 1 + bleed;
  return Math.min(hi, Math.max(lo, v));
}
