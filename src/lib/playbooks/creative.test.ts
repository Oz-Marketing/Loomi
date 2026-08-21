import { describe, it, expect } from 'vitest';
import {
  parseDefinition,
  definitionHash,
  detachedSteps,
  isFullySynced,
  applyDefinition,
  resetStep,
  resolveVersionBump,
  type CreativeDefinition,
  type ConfigCreative,
} from './creative';

const DEF: CreativeDefinition = {
  adTemplateId: 'tpl_offer',
  sizeIds: ['sq', 'story'],
  emailTemplateSlug: 'chevy-offers',
  emailMaxOffers: 6,
};

const synced: ConfigCreative = {
  adTemplateId: 'tpl_offer',
  sizeIds: ['sq', 'story'],
  emailTemplateSlug: 'chevy-offers',
  emailMaxOffers: 6,
};

describe('parseDefinition', () => {
  it('degrades to presetting nothing rather than throwing', () => {
    // A malformed definition must not take the settings page down mid-render.
    for (const bad of ['', 'not json', '[]', 'null', '{"sizeIds":"nope"}']) {
      expect(() => parseDefinition(bad)).not.toThrow();
    }
    expect(parseDefinition('not json')).toEqual({
      adTemplateId: '',
      sizeIds: [],
      emailTemplateSlug: '',
      emailMaxOffers: 6,
    });
  });

  it('drops non-string size ids rather than trusting the blob', () => {
    const def = parseDefinition(JSON.stringify({ sizeIds: ['sq', 3, null, 'story'] }));
    expect(def.sizeIds).toEqual(['sq', 'story']);
  });

  it('refuses a zero offer cap, which would produce an empty email', () => {
    expect(parseDefinition('{"emailMaxOffers":0}').emailMaxOffers).toBe(6);
    expect(parseDefinition('{"emailMaxOffers":-2}').emailMaxOffers).toBe(6);
    expect(parseDefinition('{"emailMaxOffers":3}').emailMaxOffers).toBe(3);
  });
});

describe('definitionHash', () => {
  it('ignores size order, so re-saving does not mark every rooftop behind', () => {
    expect(definitionHash(DEF)).toBe(
      definitionHash({ ...DEF, sizeIds: ['story', 'sq'] }),
    );
  });

  it('changes when the bundle actually changes', () => {
    expect(definitionHash(DEF)).not.toBe(definitionHash({ ...DEF, adTemplateId: 'other' }));
    expect(definitionHash(DEF)).not.toBe(definitionHash({ ...DEF, emailMaxOffers: 4 }));
  });
});

describe('detachedSteps', () => {
  it('reports nothing when the account matches', () => {
    expect(detachedSteps(synced, DEF)).toEqual([]);
    expect(isFullySynced(synced, DEF)).toBe(true);
  });

  it('is order-insensitive on sizes', () => {
    expect(detachedSteps({ ...synced, sizeIds: ['story', 'sq'] }, DEF)).toEqual([]);
  });

  it('names each diverged step', () => {
    expect(detachedSteps({ ...synced, adTemplateId: 'x' }, DEF)).toEqual(['adTemplate']);
    expect(detachedSteps({ ...synced, sizeIds: ['sq'] }, DEF)).toEqual(['sizes']);
    expect(detachedSteps({ ...synced, emailTemplateSlug: 'other' }, DEF)).toEqual([
      'emailTemplate',
    ]);
    expect(detachedSteps({ ...synced, emailMaxOffers: 3 }, DEF)).toEqual(['emailMaxOffers']);
  });

  it('reports several at once', () => {
    expect(detachedSteps({ ...synced, adTemplateId: 'x', emailMaxOffers: 3 }, DEF)).toEqual([
      'adTemplate',
      'emailMaxOffers',
    ]);
  });
});

describe('resetStep', () => {
  it('restores one step and leaves deliberate overrides alone', () => {
    const drifted: ConfigCreative = {
      adTemplateId: 'tpl_offer',
      sizeIds: ['sq'],
      emailTemplateSlug: 'custom',
      emailMaxOffers: 6,
    };
    const fixed = resetStep(drifted, DEF, 'sizes');
    expect(fixed.sizeIds).toEqual(['sq', 'story']);
    // The email override was not what the person clicked undo on.
    expect(fixed.emailTemplateSlug).toBe('custom');
  });

  it('clears the size selection when the ad template is reset', () => {
    // Sizes are a property of the design, so ids picked against another
    // template would silently render nothing.
    const drifted: ConfigCreative = { ...synced, adTemplateId: 'other', sizeIds: ['wide'] };
    expect(resetStep(drifted, DEF, 'adTemplate')).toMatchObject({
      adTemplateId: 'tpl_offer',
      sizeIds: ['sq', 'story'],
    });
  });

  it('leaves the config fully synced once every step is reset', () => {
    let config: ConfigCreative = {
      adTemplateId: 'x',
      sizeIds: ['a'],
      emailTemplateSlug: 'y',
      emailMaxOffers: 1,
    };
    for (const step of detachedSteps(config, DEF)) config = resetStep(config, DEF, step);
    expect(isFullySynced(config, DEF)).toBe(true);
  });
});

describe('applyDefinition', () => {
  it('returns the whole bundle, not a patch', () => {
    // save_config is a full replace; a partial object is how fields get reset.
    expect(applyDefinition(DEF)).toEqual(synced);
  });

  it('copies the size array rather than aliasing the definition', () => {
    const applied = applyDefinition(DEF);
    applied.sizeIds.push('leaked');
    expect(DEF.sizeIds).toEqual(['sq', 'story']);
  });
});

/**
 * The version number is the whole staleness story: "this rooftop is on v2, the
 * playbook is on v4" is the only thing that will ever tell someone their
 * creative is behind. So a bump that fires on a RENAME poisons the signal, and
 * a bump that fails to fire on a real edit hides it — and neither shows up on
 * screen until a rooftop has silently drifted for a month.
 */
describe('resolveVersionBump', () => {
  const at = (def: CreativeDefinition) => definitionHash(def);

  it('does not bump on a save that never touched the bundle (a rename)', () => {
    const out = resolveVersionBump({
      currentVersion: 3,
      currentHash: at(DEF),
      nextDefinition: undefined,
    });
    expect(out).toEqual({ version: 3, hash: at(DEF), bumped: false });
  });

  it('does not bump when the same definition is re-saved', () => {
    const out = resolveVersionBump({
      currentVersion: 3,
      currentHash: at(DEF),
      nextDefinition: { ...DEF },
    });
    expect(out.bumped).toBe(false);
    expect(out.version).toBe(3);
  });

  it('does not bump when only the SIZE ORDER changed', () => {
    // The hash normalizes order, and the settings form can hand back a
    // differently-ordered array for reasons that have nothing to do with intent.
    const out = resolveVersionBump({
      currentVersion: 3,
      currentHash: at(DEF),
      nextDefinition: { ...DEF, sizeIds: [...DEF.sizeIds].reverse() },
    });
    expect(out.bumped).toBe(false);
    expect(out.version).toBe(3);
  });

  it('bumps once for a real edit, and carries the new hash', () => {
    const next = { ...DEF, adTemplateId: 'tpl_other' };
    const out = resolveVersionBump({
      currentVersion: 3,
      currentHash: at(DEF),
      nextDefinition: next,
    });
    expect(out).toEqual({ version: 4, hash: at(next), bumped: true });
  });

  it('bumps for every field the bundle actually holds', () => {
    const edits: CreativeDefinition[] = [
      { ...DEF, adTemplateId: 'tpl_other' },
      { ...DEF, sizeIds: ['sq'] },
      { ...DEF, sizeIds: [...DEF.sizeIds, 'landscape'] },
      { ...DEF, emailTemplateSlug: 'ford-offers' },
      { ...DEF, emailMaxOffers: 4 },
    ];
    for (const next of edits) {
      const out = resolveVersionBump({
        currentVersion: 1,
        currentHash: at(DEF),
        nextDefinition: next,
      });
      expect(out.bumped, JSON.stringify(next)).toBe(true);
      expect(out.version).toBe(2);
    }
  });

  it('bumps by one, not to the edit count — two saves of the same edit land on the same version', () => {
    const next = { ...DEF, emailMaxOffers: 4 };
    const first = resolveVersionBump({
      currentVersion: 1,
      currentHash: at(DEF),
      nextDefinition: next,
    });
    const second = resolveVersionBump({
      currentVersion: first.version,
      currentHash: first.hash,
      nextDefinition: next,
    });
    expect(first.version).toBe(2);
    expect(second.version).toBe(2);
    expect(second.bumped).toBe(false);
  });

  it('bumps back up when an edit is reverted, rather than restoring the old number', () => {
    // A revert is a change too: rooftops sitting on the edited version need to
    // be told to come back, and versions must never move backwards.
    const edited = resolveVersionBump({
      currentVersion: 1,
      currentHash: at(DEF),
      nextDefinition: { ...DEF, emailMaxOffers: 4 },
    });
    const reverted = resolveVersionBump({
      currentVersion: edited.version,
      currentHash: edited.hash,
      nextDefinition: { ...DEF },
    });
    expect(reverted.version).toBe(3);
    expect(reverted.hash).toBe(at(DEF));
  });
});
