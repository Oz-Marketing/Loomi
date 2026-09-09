import { describe, expect, it } from 'vitest';
import { BLEED, clampToBleed, groupMoveRange } from './bleed';

describe('groupMoveRange', () => {
  // A lockup sitting in the middle of the board.
  const mid = { left: 0.4, right: 0.6, top: 0.4, bottom: 0.6 };

  it('lets a group hang off the left edge', () => {
    const r = groupMoveRange(mid);
    // Moving by minDx puts the group's LEFT edge fully off plus the bleed.
    expect(mid.left + r.minDx).toBeLessThan(0);
    expect(mid.right + r.minDx).toBeCloseTo(-BLEED, 10);
  });

  it('lets a group hang off the right edge', () => {
    const r = groupMoveRange(mid);
    expect(mid.right + r.maxDx).toBeGreaterThan(1);
    expect(mid.left + r.maxDx).toBeCloseTo(1 + BLEED, 10);
  });

  it('does the same vertically', () => {
    const r = groupMoveRange(mid);
    expect(mid.bottom + r.minDy).toBeCloseTo(-BLEED, 10);
    expect(mid.top + r.maxDy).toBeCloseTo(1 + BLEED, 10);
  });

  it('is not the old artboard range', () => {
    // The regression this replaces: -left / 1 - right pinned the bounding box
    // flush inside the board, so a group could never bleed at all.
    const r = groupMoveRange(mid);
    expect(r.minDx).toBeLessThan(-mid.left);
    expect(r.maxDx).toBeGreaterThan(1 - mid.right);
  });

  it('gives a group already bleeding room to keep moving', () => {
    // The case that made this visible: grouping a design that already hangs off
    // must not snap it back on the first drag.
    const bleeding = { left: -0.3, right: 0.5, top: 0.1, bottom: 0.4 };
    const r = groupMoveRange(bleeding);
    expect(r.minDx).toBeLessThan(0); // can go further out
    expect(r.maxDx).toBeGreaterThan(0); // and can come back in
  });

  it('matches the single-element rule for a group of one', () => {
    // A group's bounding box should behave exactly like one element's box.
    const box = { x: 0.4, w: 0.2 };
    const r = groupMoveRange({ left: box.x, right: box.x + box.w, top: 0, bottom: 0.1 });
    expect(box.x + r.minDx).toBeCloseTo(-box.w - BLEED, 10);
    expect(box.x + r.maxDx).toBeCloseTo(1 + BLEED, 10);
  });
});

describe('clampToBleed', () => {
  it('allows a negative position', () => {
    expect(clampToBleed(-0.2, 0.3)).toBe(-0.2);
  });

  it('stops at the bleed limit rather than the board edge', () => {
    expect(clampToBleed(-99, 0.3)).toBeCloseTo(-0.3 - BLEED, 10);
    expect(clampToBleed(99, 0.3)).toBeCloseTo(1 + BLEED, 10);
  });

  it('is idempotent', () => {
    // THE property the old artboard clamp lacked. A second pass over an
    // already-clamped value is what silently undid the bleed the first pass
    // allowed, so this is the regression guard that matters most.
    for (const v of [-99, -0.4, 0, 0.5, 1.2, 99]) {
      const once = clampToBleed(v, 0.3);
      expect(clampToBleed(once, 0.3)).toBe(once);
    }
  });
});
