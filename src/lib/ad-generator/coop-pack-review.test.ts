import { describe, it, expect } from 'vitest';
import { splitByReviewState } from './coop-pack-store';
import type { CoopRule, CoopRulePack } from './coop-rules';

function rule(id: string, extra: Partial<CoopRule> = {}): CoopRule {
  return {
    id,
    kind: 'banned_phrase',
    severity: 'error',
    description: `no ${id}`,
    phrase: id,
    ...extra,
  } as CoopRule;
}

const pack = (rules: CoopRule[]): CoopRulePack => ({
  make: 'Mazda',
  version: 'mcap-2025-08',
  verified: true,
  rules,
});

describe('splitByReviewState', () => {
  it('treats an absent reviewState as accepted', () => {
    // Every hand-transcribed rule predates the field. Reading absence as
    // "unreviewed" would silently switch off the only packs that exist.
    const r = splitByReviewState(pack([rule('a'), rule('b')]));
    expect(r.accepted.rules).toHaveLength(2);
    expect(r.proposedCount).toBe(0);
  });

  it('withholds proposals from the accepted pack and only counts them', () => {
    const r = splitByReviewState(
      pack([
        rule('kept', { reviewState: 'accepted' }),
        rule('draft1', { reviewState: 'proposed' }),
        rule('draft2', { reviewState: 'proposed' }),
        rule('binned', { reviewState: 'rejected' }),
      ]),
    );
    expect(r.accepted.rules.map((x) => x.id)).toEqual(['kept']);
    expect(r.proposedCount).toBe(2);
    expect(r.rejectedCount).toBe(1);
  });

  it('carries make, version and verified onto the filtered pack', () => {
    const r = splitByReviewState(pack([rule('a', { reviewState: 'proposed' })]));
    expect(r.accepted.make).toBe('Mazda');
    expect(r.accepted.version).toBe('mcap-2025-08');
    expect(r.accepted.verified).toBe(true);
    // An all-proposed pack yields an EMPTY accepted pack, not a null one: "nothing
    // to check yet" is a real verdict and must not read as "no pack on file".
    expect(r.accepted.rules).toEqual([]);
  });

  it('keeps provenance on the rules it passes through', () => {
    const r = splitByReviewState(
      pack([
        rule('a', {
          reviewState: 'accepted',
          origin: 'ai',
          sourceDocId: 'doc_1',
          sourcePage: 12,
          sourceQuote: 'the dealer must identify itself',
        }),
      ]),
    );
    expect(r.accepted.rules[0].sourcePage).toBe(12);
    expect(r.accepted.rules[0].origin).toBe('ai');
  });
});

describe('the counts must not be reconstructed by subtraction', () => {
  it('a rejected rule is neither accepted nor pending', () => {
    const r = splitByReviewState(
      pack([
        rule('kept', { reviewState: 'accepted' }),
        rule('draft', { reviewState: 'proposed' }),
        rule('binned', { reviewState: 'rejected' }),
        rule('binned2', { reviewState: 'rejected' }),
      ]),
    );
    const total = 4;
    // The tempting-but-wrong derivation, spelled out so it can't creep back in:
    // total - accepted would report 3 pending when only 1 awaits review.
    expect(total - r.accepted.rules.length).toBe(3);
    expect(r.proposedCount).toBe(1);
    expect(r.rejectedCount).toBe(2);
  });
});
