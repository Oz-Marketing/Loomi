import { describe, it, expect } from 'vitest';
import { keepContent, seedOwnership, stampSeeded, unstampedHash } from './seed-stamp';
import { docFromStart, ARCHETYPE_STARTS } from './registry';
import type { TemplateDoc } from '../doc-types';

/**
 * This is data-loss protection, so the bar is: a designer's work is never
 * rewritten, and anything the script cannot prove is untouched counts as theirs.
 */

const seeded = () => stampSeeded(docFromStart(ARCHETYPE_STARTS[0], { id: 'arch-vehicle-offer' }));
const stored = (doc: TemplateDoc) => JSON.stringify(doc);

describe('a freshly seeded row is the seed to rewrite', () => {
  it('stamps the doc with its own design hash', () => {
    const doc = seeded();
    expect(doc.archetype?.seedHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('recognises its own stamp', () => {
    expect(seedOwnership(stored(seeded()))).toEqual({ edited: false, reason: '' });
  });

  it('stamps identically on a re-run, so an untouched row stays untouched', () => {
    expect(seeded().archetype?.seedHash).toBe(seeded().archetype?.seedHash);
  });

  it('excludes the stamp from what it hashes', () => {
    // Otherwise stamping would change the thing being stamped and nothing would
    // ever match.
    const doc = seeded();
    expect(unstampedHash(doc)).toBe(doc.archetype!.seedHash);
  });
});

describe('a row a designer has touched is theirs', () => {
  it('refuses one whose layer moved', () => {
    const doc = seeded();
    const sizeId = doc.sizes[0].id;
    const elId = Object.keys(doc.layouts[sizeId])[0];
    const moved: TemplateDoc = {
      ...doc,
      layouts: {
        ...doc.layouts,
        [sizeId]: { ...doc.layouts[sizeId], [elId]: { ...doc.layouts[sizeId][elId], x: 0.42 } },
      },
    };
    const v = seedOwnership(stored(moved));
    expect(v.edited).toBe(true);
    expect(v.reason).toContain('edited since it was seeded');
  });

  it('refuses one whose colour changed', () => {
    const doc = seeded();
    const recoloured: TemplateDoc = {
      ...doc,
      elements: doc.elements.map((el, i) => (i === 0 ? { ...el, color: '#ff0055' } : el)),
    };
    expect(seedOwnership(stored(recoloured)).edited).toBe(true);
  });

  it('refuses one with an added layer', () => {
    const doc = seeded();
    const added: TemplateDoc = {
      ...doc,
      elements: [...doc.elements, { id: 'mine', type: 'text', binding: { kind: 'static', value: 'Hi' } }],
    };
    expect(seedOwnership(stored(added)).edited).toBe(true);
  });

  it('refuses a row with no stamp at all', () => {
    const doc = docFromStart(ARCHETYPE_STARTS[0], { id: 'x' });
    const v = seedOwnership(stored(doc));
    expect(v.edited).toBe(true);
    expect(v.reason).toContain('no seed stamp');
  });

  it('refuses a doc it cannot read, rather than assuming it is safe', () => {
    expect(seedOwnership('not json').edited).toBe(true);
    expect(seedOwnership('{}').edited).toBe(true);
    expect(seedOwnership('null').edited).toBe(true);
  });
});

describe('what a designer may change without losing the row', () => {
  it('ignores the template name and description', () => {
    // Those are the app's to edit and the seed rewrites them anyway; they are not
    // the design, so they must not read as an edit.
    const doc = seeded();
    const renamed: TemplateDoc = { ...doc, name: 'Spring Event', description: 'ours' };
    expect(seedOwnership(stored(renamed)).edited).toBe(false);
  });

  it('ignores the sample content on the fields', () => {
    // Editing the dealer name in the CONTENT panel writes doc.defaults. That is
    // the designer filling the template in, not redesigning it.
    const doc = seeded();
    const filled: TemplateDoc = { ...doc, defaults: { ...doc.defaults, dealerName: 'Young Subaru' } };
    expect(seedOwnership(stored(filled)).edited).toBe(false);
  });
});

describe('a doc no archetype produced', () => {
  it('is returned unstamped rather than given a fake archetype', () => {
    const hand = { id: 'h', name: 'Hand built', sizes: [], elements: [], layouts: {}, fields: [], defaults: {} } as unknown as TemplateDoc;
    expect(stampSeeded(hand).archetype).toBeUndefined();
  });
});

describe('rewriting a row keeps the content it already had', () => {
  it("prefers the row's values over the archetype's placeholders", () => {
    const next = docFromStart(ARCHETYPE_STARTS[0], { id: 'x' });
    const existing = {
      ...next,
      defaults: { ...next.defaults, dealerName: 'Young Subaru', tagline: 'Adventure Starts Here' },
    };
    const merged = keepContent(next, existing);
    expect(merged.defaults.dealerName).toBe('Young Subaru');
    expect(merged.defaults.tagline).toBe('Adventure Starts Here');
  });

  it('keeps the new design while doing it', () => {
    const next = docFromStart(ARCHETYPE_STARTS[0], { id: 'x' });
    const existing = { ...next, elements: [], layouts: {}, defaults: { dealerName: 'Theirs' } } as unknown as TemplateDoc;
    const merged = keepContent(next, existing);
    expect(merged.elements).toEqual(next.elements);
    expect(merged.defaults.dealerName).toBe('Theirs');
  });

  it('handles a row with no content at all', () => {
    const next = docFromStart(ARCHETYPE_STARTS[0], { id: 'x' });
    expect(keepContent(next, null).defaults).toEqual(next.defaults);
  });

  it('leaves a content-only edit rewritable, stamp intact', () => {
    // The whole point of excluding content from the stamp: filling the template in
    // must not cut it off from future archetype fixes.
    const doc = stampSeeded(docFromStart(ARCHETYPE_STARTS[0], { id: 'x' }));
    const filled = { ...doc, defaults: { ...doc.defaults, dealerName: 'Young Kia' } };
    expect(seedOwnership(JSON.stringify(filled)).edited).toBe(false);
  });
});
