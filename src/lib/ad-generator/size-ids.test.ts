import { describe, expect, it } from 'vitest';
import { addSizesToDoc, dedupeSizeIds, uniqueSizeId } from './size-ids';
import type { TemplateDoc } from './doc-types';

/** The three catalog entries that share 1080×1920 — the collision in the wild. */
const STORY_SIZES = [
  { label: 'Facebook Story', width: 1080, height: 1920 },
  { label: 'Instagram Story / Reels', width: 1080, height: 1920 },
  { label: 'TikTok Video', width: 1080, height: 1920 },
];

function doc(partial: Partial<TemplateDoc> = {}): TemplateDoc {
  return {
    id: 'tmpl',
    name: 'Test',
    fields: [],
    elements: [{ id: 'headline', type: 'text', text: 'Hi' }],
    sizes: [{ id: '1080x1080', label: 'Instagram Square 1080×1080', width: 1080, height: 1080 }],
    layouts: { '1080x1080': { headline: { x: 0.1, y: 0.1, w: 0.5, h: 0.2 } } },
    defaults: {},
    ...partial,
  } as TemplateDoc;
}

describe('uniqueSizeId', () => {
  it('uses the plain dimensions when free', () => {
    expect(uniqueSizeId([], 1080, 1920)).toBe('1080x1920');
  });

  it('suffixes past every id already taken', () => {
    expect(uniqueSizeId(['1080x1920'], 1080, 1920)).toBe('1080x1920-2');
    expect(uniqueSizeId(['1080x1920', '1080x1920-2'], 1080, 1920)).toBe('1080x1920-3');
  });
});

describe('addSizesToDoc', () => {
  it('gives same-dimension sizes added together distinct ids', () => {
    const { doc: next, addedIds } = addSizesToDoc(doc(), STORY_SIZES);

    expect(addedIds).toEqual(['1080x1920', '1080x1920-2', '1080x1920-3']);
    expect(new Set(next.sizes.map((s) => s.id)).size).toBe(next.sizes.length);
  });

  it('gives each new board its own layout, seeded from the source size', () => {
    const { doc: next, addedIds } = addSizesToDoc(doc(), STORY_SIZES, '1080x1080');

    for (const id of addedIds) {
      expect(next.layouts[id]).toEqual(next.layouts['1080x1080']);
      // Its OWN copy — editing one board must not move the others.
      expect(next.layouts[id]).not.toBe(next.layouts['1080x1080']);
    }
  });

  it('labels each size with its dimensions and leaves existing sizes alone', () => {
    const { doc: next } = addSizesToDoc(doc(), [STORY_SIZES[0]]);

    expect(next.sizes).toHaveLength(2);
    expect(next.sizes[0]).toEqual(doc().sizes[0]);
    expect(next.sizes[1].label).toBe('Facebook Story 1080×1920');
  });

  it('is a no-op for an empty batch', () => {
    const before = doc();
    const { doc: next, addedIds } = addSizesToDoc(before, []);
    expect(next).toBe(before);
    expect(addedIds).toEqual([]);
  });
});

describe('dedupeSizeIds', () => {
  /** A doc as saved by the old one-at-a-time add: three boards, one id. */
  const collided = () =>
    doc({
      sizes: [
        { id: '1200x628', label: 'Facebook Feed 1200×628', width: 1200, height: 628 },
        { id: '1080x1920', label: 'Facebook Story 1080×1920', width: 1080, height: 1920 },
        { id: '1080x1920', label: 'Instagram Story / Reels 1080×1920', width: 1080, height: 1920 },
        { id: '1080x1920', label: 'TikTok Video 1080×1920', width: 1080, height: 1920 },
      ],
      layouts: {
        '1200x628': { headline: { x: 0, y: 0, w: 1, h: 0.3 } },
        '1080x1920': { headline: { x: 0.2, y: 0.4, w: 0.6, h: 0.1 } },
      },
    });

  it('separates the twins, keeping the first id', () => {
    const { doc: fixed, changed } = dedupeSizeIds(collided());

    expect(changed).toBe(true);
    expect(fixed.sizes.map((s) => s.id)).toEqual(['1200x628', '1080x1920', '1080x1920-2', '1080x1920-3']);
  });

  it('keeps the labels and dimensions attached to the right boards', () => {
    const { doc: fixed } = dedupeSizeIds(collided());
    expect(fixed.sizes.map((s) => s.label)).toEqual(collided().sizes.map((s) => s.label));
  });

  it('copies the shared layout onto each board it was standing in for', () => {
    const { doc: fixed } = dedupeSizeIds(collided());
    const shared = collided().layouts['1080x1920'];

    for (const id of ['1080x1920', '1080x1920-2', '1080x1920-3']) {
      expect(fixed.layouts[id]).toEqual(shared);
    }
    // Separate objects, so editing one board no longer edits its twins.
    expect(fixed.layouts['1080x1920-2']).not.toBe(fixed.layouts['1080x1920-3']);
  });

  it('leaves a healthy doc untouched, by identity', () => {
    const before = doc();
    const { doc: after, changed } = dedupeSizeIds(before);
    expect(changed).toBe(false);
    expect(after).toBe(before);
  });

  it('is idempotent', () => {
    const once = dedupeSizeIds(collided()).doc;
    const twice = dedupeSizeIds(once);
    expect(twice.changed).toBe(false);
    expect(twice.doc).toBe(once);
  });

  it('lets a pager walk every board once ids are unique', () => {
    // The reported symptom: `findIndex` by id resolves a duplicate to the FIRST
    // twin, so "next" from the second 1080×1920 board jumped backwards and the
    // pager could never reach the boards past it.
    const { doc: fixed } = dedupeSizeIds(collided());
    const visited: string[] = [];
    let id = fixed.sizes[0].id;
    for (let i = 0; i < fixed.sizes.length; i += 1) {
      visited.push(id);
      const idx = fixed.sizes.findIndex((s) => s.id === id);
      id = fixed.sizes[(idx + 1) % fixed.sizes.length].id;
    }
    expect(visited).toEqual(fixed.sizes.map((s) => s.id));
  });
});
