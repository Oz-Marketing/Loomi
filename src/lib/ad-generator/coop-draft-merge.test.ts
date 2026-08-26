import { describe, it, expect } from 'vitest';
import { mergeDraftedRules } from './coop-draft-merge';
import type { AcceptedRule } from './coop-draft';
import type { CoopRule, CoopRulePack } from './coop-rules';

function drafted(id: string, phrase: string, page = 12): AcceptedRule {
  return {
    // A citation is always present in practice — screening synthesizes it from the
    // verified page, and `toCoopRule` requires it.
    rule: {
      id,
      kind: 'banned_phrase',
      severity: 'error',
      description: `Do not say "${phrase}".`,
      phrase,
      citation: `MCAP §2a, p.${page}`,
    },
    origin: 'ai',
    source: {
      page,
      statedPage: page,
      pageCorrected: false,
      start: 0,
      end: 10,
      matchedPages: [page],
      matchType: 'exact',
      stretch: 1,
      quote: `the word ${phrase} is prohibited in all advertising`,
    },
  } as AcceptedRule;
}

const handWritten: CoopRule = {
  id: 'mazda-no-free',
  kind: 'banned_phrase',
  severity: 'error',
  description: 'Do not say "free".',
  phrase: 'free',
  citation: 'MCAP §2a, p.7',
};

const existing: CoopRulePack = {
  make: 'Mazda',
  version: 'mcap-2025-08',
  verified: true,
  rules: [handWritten],
};

const OPTS = { make: 'Mazda', version: 'mcap-2025-08', sourceDocId: 'doc_1' };

describe('mergeDraftedRules', () => {
  it('appends drafts as proposals and leaves existing rules untouched', () => {
    const r = mergeDraftedRules(existing, [drafted('a', 'clearance')], OPTS);
    expect(r.keptExisting).toBe(1);
    expect(r.added).toHaveLength(1);
    // The human's rule is still first, byte-identical.
    expect(r.pack.rules[0]).toEqual(handWritten);
    expect(r.pack.rules[1].reviewState).toBe('proposed');
    expect(r.pack.rules[1].origin).toBe('ai');
    expect(r.pack.rules[1].sourceDocId).toBe('doc_1');
    expect(r.pack.rules[1].sourcePage).toBe(12);
  });

  it('preserves the pack’s verified flag and version', () => {
    // Adding proposals must not disturb a pack's standing — verified means a human
    // checked the ACCEPTED rules, and a proposal does not change that.
    const r = mergeDraftedRules(existing, [drafted('a', 'clearance')], OPTS);
    expect(r.pack.verified).toBe(true);
    expect(r.pack.version).toBe('mcap-2025-08');
    expect(r.pack.make).toBe('Mazda');
  });

  it('creates a pack when the make has none', () => {
    const r = mergeDraftedRules(null, [drafted('a', 'clearance')], {
      make: 'Honda',
      version: 'ai-draft-2026-08-25',
      source: 'Honda DMA Program Overview',
    });
    expect(r.keptExisting).toBe(0);
    expect(r.pack.make).toBe('Honda');
    // A pack born from drafts is NOT verified.
    expect(r.pack.verified).toBe(false);
    expect(r.pack.rules).toHaveLength(1);
  });

  it('is idempotent on a re-run — same ids are skipped', () => {
    const once = mergeDraftedRules(existing, [drafted('a', 'clearance')], OPTS);
    const twice = mergeDraftedRules(once.pack, [drafted('a', 'clearance')], OPTS);
    expect(twice.added).toEqual([]);
    expect(twice.skipped[0].reason).toBe('duplicate_id');
    expect(twice.pack.rules).toHaveLength(2);
  });

  // The one that matters after a prompt change: the id is derived from the
  // description, so a re-draft yields a NEW id for the SAME rule.
  it('catches a re-drafted rule that arrived under a different id', () => {
    const once = mergeDraftedRules(existing, [drafted('mazda-clearance-v1', 'clearance')], OPTS);
    const redraft = drafted('mazda-clearance-v2', 'clearance');
    redraft.rule.description = 'The word "clearance" may not be used.';
    const twice = mergeDraftedRules(once.pack, [redraft], OPTS);
    expect(twice.added).toEqual([]);
    expect(twice.skipped[0].reason).toBe('duplicate_rule');
    expect(twice.skipped[0].existingId).toBe('mazda-clearance-v1');
  });

  it('will not re-propose a rule a human already wrote', () => {
    // Mazda's hand-written "free" rule. A drafting pass finds the same clause.
    const r = mergeDraftedRules(existing, [drafted('mazda-free-ai', 'free')], OPTS);
    expect(r.added).toEqual([]);
    expect(r.skipped[0].reason).toBe('duplicate_rule');
    expect(r.skipped[0].existingId).toBe('mazda-no-free');
  });

  it('adds nothing when given nothing, and returns the pack unchanged', () => {
    const r = mergeDraftedRules(existing, [], OPTS);
    expect(r.added).toEqual([]);
    expect(r.pack.rules).toEqual(existing.rules);
  });

  it('deduplicates within a single batch', () => {
    const r = mergeDraftedRules(existing, [drafted('a', 'clearance'), drafted('b', 'clearance')], OPTS);
    expect(r.added).toHaveLength(1);
    expect(r.skipped).toHaveLength(1);
  });

  it('reports a malformed rule instead of abandoning the batch', () => {
    const bad = drafted('bad', 'clearance');
    delete (bad.rule as { citation?: string }).citation;
    const good = drafted('good', 'blowout');
    const r = mergeDraftedRules(existing, [bad, good], OPTS);
    // The good rule still lands — one defect must not cost the other twenty-nine.
    expect(r.added.map((x) => x.id)).toEqual(['good']);
    expect(r.skipped[0].reason).toBe('malformed');
  });
});

describe('mergeDraftedRules — prohibited-terms lists', () => {
  const list = (id: string, phrases: string[]): AcceptedRule =>
    ({
      rule: { id, kind: 'banned_phrase', severity: 'error', description: `list ${id}`, citation: 'x', phrases },
      origin: 'ai',
      source: { page: 1, statedPage: 1, pageCorrected: false, start: 0, end: 5, matchedPages: [1], matchType: 'exact', stretch: 1, quote: 'q' },
    }) as unknown as AcceptedRule;

  const OPTS = { make: 'Subaru', version: 'v1', source: 'doc' };

  // The bug: a list carries no single `phrase`, so every list computed the same
  // signature and the first one made all the others look like duplicates. A real
  // Subaru run landed one of four.
  it('keeps several DIFFERENT lists in one merge', () => {
    const r = mergeDraftedRules(null, [
      list('a', ['invoice', 'blowout']),
      list('b', ['special purchase', 'employee pricing']),
      list('c', ['ADM', 'Market Adjustment']),
    ], OPTS);
    expect(r.added).toHaveLength(3);
    expect(r.skipped).toEqual([]);
  });

  it('still recognises the SAME list re-drafted', () => {
    const first = mergeDraftedRules(null, [list('a', ['invoice', 'blowout'])], OPTS);
    const again = mergeDraftedRules(first.pack, [list('z', ['blowout', 'invoice'])], OPTS);
    // Order is not identity: the same terms in a different order is one rule.
    expect(again.added).toEqual([]);
    expect(again.skipped[0].reason).toBe('duplicate_rule');
  });

  it('RENAMES a genuinely different rule that computed a taken id', () => {
    // Ids are slugs from the description, so a coincidence must not cost a real
    // requirement.
    const first = mergeDraftedRules(null, [list('shared', ['invoice'])], OPTS);
    const again = mergeDraftedRules(first.pack, [list('shared', ['bailout'])], OPTS);
    expect(again.added).toHaveLength(1);
    expect(again.added[0].id).toBe('shared-2');
    expect(again.pack.rules).toHaveLength(2);
  });

  it('skips a true duplicate that also shares its id', () => {
    const first = mergeDraftedRules(null, [list('same', ['invoice'])], OPTS);
    const again = mergeDraftedRules(first.pack, [list('same', ['invoice'])], OPTS);
    expect(again.added).toEqual([]);
    expect(again.skipped[0].reason).toBe('duplicate_id');
  });
});
