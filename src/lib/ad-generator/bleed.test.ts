import { describe, expect, it } from 'vitest';
import { BLEED, clampPos, clampShift } from './bleed';

describe('clampPos', () => {
  it('leaves an on-board position alone', () => {
    expect(clampPos(0.3, 0.2)).toBe(0.3);
  });

  it('keeps a NEGATIVE origin — the whole point', () => {
    // The old `clamp(x, 0, 1 - w)` returned 0 here, which is why a hand-typed
    // negative X snapped back the moment the element was moved.
    expect(clampPos(-0.12, 0.6)).toBeCloseTo(-0.12, 9);
  });

  it('keeps an origin whose far edge runs past the board', () => {
    expect(clampPos(0.9, 0.6)).toBeCloseTo(0.9, 9); // right edge at 1.5
  });

  it('lets an element pass fully off the near edge, then stops', () => {
    expect(clampPos(-99, 0.2)).toBeCloseTo(-0.2 - BLEED, 9);
  });

  it('lets an element pass fully off the far edge, then stops', () => {
    expect(clampPos(99, 0.2)).toBeCloseTo(1 + BLEED, 9);
  });

  it('is idempotent, so repeated moves never drift', () => {
    const once = clampPos(-0.12, 0.6);
    expect(clampPos(once, 0.6)).toBeCloseTo(once, 9);
  });
});

describe('clampShift', () => {
  it('passes an in-range displacement through untouched', () => {
    expect(clampShift(0.05, 0.3, 0.2)).toBeCloseTo(0.05, 9);
  });

  it('moves a bleeding element further out rather than snapping it in', () => {
    // Starting at -0.12 and nudged left again: the old bounds (`-bb.left`,
    // `1 - bb.right`) inverted for a bleeding box and shoved it the other way.
    expect(clampShift(-0.05, -0.12, 0.6)).toBeCloseTo(-0.05, 9);
  });

  it('caps the displacement at the bleed limit, not at the board edge', () => {
    expect(clampShift(-99, 0.3, 0.2)).toBeCloseTo(-0.2 - BLEED - 0.3, 9);
  });
});
