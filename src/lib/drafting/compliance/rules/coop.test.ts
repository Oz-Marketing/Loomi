import { describe, expect, it } from 'vitest';
import type { CoopRulePack } from '@/lib/ad-generator/coop-rules';
import { blockById, draft } from '../__fixtures__/drafts';
import type { DraftArtifact } from '../types';
import { coopBannedPhrasesRule } from './coop';

function pack(overrides: Partial<CoopRulePack> = {}, rule: Record<string, unknown> = {}): CoopRulePack {
  return {
    make: 'Subaru',
    version: 'test',
    verified: false,
    rules: [
      {
        id: 'subaru-banned-race-to-bottom',
        kind: 'banned_phrase',
        pattern: 'best price|we\'?ll (meet|beat|match)',
        severity: 'error',
        description: 'Race-to-the-bottom language is prohibited.',
        citation: '§6p p.42',
        ...rule,
      } as CoopRulePack['rules'][number],
    ],
    ...overrides,
  };
}

async function withCopy(patch: Partial<DraftArtifact>): Promise<DraftArtifact> {
  return draft((t) => {
    blockById(t, 'body').props.text = 'The best price on a 2026 Chevy Equinox ACTIV: $3,500 off at Young Chevrolet.';
  }, patch);
}

describe('coop.banned-phrases', () => {
  it('only warns on a request that isn’t co-op', async () => {
    const [f] = coopBannedPhrasesRule.check(await withCopy({ coop: false, coopPack: pack({ verified: true }) }));
    expect(f).toMatchObject({ severity: 'warning', where: 'block:body' });
    expect(f.message).toContain("isn't co-op");
  });

  it('warns on a co-op request while nobody has signed off the rule', async () => {
    const [f] = coopBannedPhrasesRule.check(await withCopy({ coop: true, coopPack: pack() }));
    expect(f.severity).toBe('warning');
    expect(f.message).toContain('until someone signs off this rule');
  });

  it('blocks a co-op request once the rule is accepted, or the pack verified', async () => {
    for (const p of [pack({}, { reviewState: 'accepted' }), pack({ verified: true })]) {
      const [f] = coopBannedPhrasesRule.check(await withCopy({ coop: true, coopPack: p }));
      expect(f.severity).toBe('error');
      expect(f.message).toBe('Subaru co-op: Race-to-the-bottom language is prohibited. (§6p p.42)');
    }
  });

  it('ignores proposed rules, and rules scoped to other offer types', async () => {
    expect(coopBannedPhrasesRule.check(await withCopy({ coop: true, coopPack: pack({}, { reviewState: 'proposed' }) }))).toEqual([]);
    const leaseOnly = pack({ verified: true }, { scope: { offerTypes: ['lease'] } });
    expect(coopBannedPhrasesRule.check(await withCopy({ coop: true, offerType: 'cash', coopPack: leaseOnly }))).toEqual([]);
    // An unknown offer type gets the rule rather than escaping it.
    expect(coopBannedPhrasesRule.check(await withCopy({ coop: true, offerType: null, coopPack: leaseOnly }))).toHaveLength(1);
  });

  it('never judges the manufacturer’s own disclaimer', async () => {
    const a = await draft(undefined, { coop: true, coopPack: pack({ verified: true }) });
    const withHit = { ...a, disclaimer: { ...a.disclaimer!, text: `${a.disclaimer!.text} Best price guaranteed.` } };
    blockById(withHit.template, 'disclaimer').props.text = withHit.disclaimer.text;
    expect(coopBannedPhrasesRule.check(withHit)).toEqual([]);
  });
});
