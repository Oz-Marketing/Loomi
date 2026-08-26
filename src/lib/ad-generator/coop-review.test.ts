import { describe, it, expect } from 'vitest';
import {
  applyRuleReviews,
  pendingRules,
  changesEnforcement,
  groupPendingByKind,
  applyRequiredFieldReviews,
  pendingRequiredFields,
  foldRequiredFields,
} from './coop-review';
import type { CoopRule, CoopRulePack } from './coop-rules';

const NOW = new Date('2026-08-25T12:00:00.000Z');

function rule(id: string, reviewState?: 'proposed' | 'accepted' | 'rejected'): CoopRule {
  return {
    id,
    kind: 'banned_phrase',
    severity: 'error',
    description: `no ${id}`,
    phrase: id,
    citation: 'MCAP §2a, p.7',
    ...(reviewState ? { reviewState, origin: 'ai' as const } : {}),
  } as CoopRule;
}

const pack: CoopRulePack = {
  make: 'Mazda',
  version: 'mcap-2025-08',
  verified: true,
  rules: [rule('hand-written'), rule('draft-a', 'proposed'), rule('draft-b', 'proposed'), rule('binned', 'rejected')],
};

describe('applyRuleReviews', () => {
  it('accepts a proposal and attributes the decision', () => {
    const r = applyRuleReviews(pack, [{ ruleId: 'draft-a', state: 'accepted' }], 'Dana', NOW);
    const got = r.pack.rules.find((x) => x.id === 'draft-a')!;
    expect(got.reviewState).toBe('accepted');
    expect(got.reviewedBy).toBe('Dana');
    expect(got.reviewedAt).toBe('2026-08-25T12:00:00.000Z');
    expect(r.applied).toEqual([{ ruleId: 'draft-a', from: 'proposed', to: 'accepted' }]);
  });

  it('handles a bulk decision across many rules', () => {
    const r = applyRuleReviews(
      pack,
      [
        { ruleId: 'draft-a', state: 'accepted' },
        { ruleId: 'draft-b', state: 'accepted' },
      ],
      'Dana',
      NOW,
    );
    expect(r.applied).toHaveLength(2);
    expect(pendingRules(r.pack)).toEqual([]);
  });

  // The one that protects years of human work from a stray id in a bulk request.
  it('REFUSES to decide a hand-written rule', () => {
    const r = applyRuleReviews(pack, [{ ruleId: 'hand-written', state: 'rejected' }], 'Dana', NOW);
    expect(r.notInReview).toEqual(['hand-written']);
    expect(r.applied).toEqual([]);
    const got = r.pack.rules.find((x) => x.id === 'hand-written')!;
    expect(got.reviewState).toBeUndefined();
    expect(got.reviewedBy).toBeUndefined();
  });

  it('keeps a rejected rule in the pack rather than deleting it', () => {
    // So a later drafting pass sees it as already-decided instead of re-proposing
    // it every month.
    const r = applyRuleReviews(pack, [{ ruleId: 'draft-a', state: 'rejected' }], 'Dana', NOW);
    expect(r.pack.rules).toHaveLength(4);
    expect(r.pack.rules.find((x) => x.id === 'draft-a')!.reviewState).toBe('rejected');
  });

  it('can reopen a rejected rule', () => {
    const r = applyRuleReviews(pack, [{ ruleId: 'binned', state: 'accepted' }], 'Dana', NOW);
    expect(r.applied).toEqual([{ ruleId: 'binned', from: 'rejected', to: 'accepted' }]);
  });

  it('reports an unknown id without touching anything', () => {
    const r = applyRuleReviews(pack, [{ ruleId: 'nope', state: 'accepted' }], 'Dana', NOW);
    expect(r.notFound).toEqual(['nope']);
    expect(r.applied).toEqual([]);
    expect(r.pack.rules).toEqual(pack.rules);
  });

  it('treats a no-op decision as unchanged, not an error', () => {
    const r = applyRuleReviews(pack, [{ ruleId: 'binned', state: 'rejected' }], 'Dana', NOW);
    expect(r.unchanged).toEqual(['binned']);
    expect(r.applied).toEqual([]);
  });

  it('leaves the pack’s own fields alone', () => {
    const r = applyRuleReviews(pack, [{ ruleId: 'draft-a', state: 'accepted' }], 'Dana', NOW);
    expect(r.pack.verified).toBe(true);
    expect(r.pack.version).toBe('mcap-2025-08');
    expect(r.pack.rules).toHaveLength(4);
  });
});

describe('changesEnforcement', () => {
  it('is true when a rule becomes accepted', () => {
    expect(changesEnforcement([{ ruleId: 'a', from: 'proposed', to: 'accepted' }])).toBe(true);
  });

  it('is true when an accepted rule is withdrawn', () => {
    expect(changesEnforcement([{ ruleId: 'a', from: 'accepted', to: 'rejected' }])).toBe(true);
  });

  it('is FALSE when a proposal is merely rejected', () => {
    // A proposal enforced nothing, so declining it cannot invalidate a cached
    // template verdict — and dropping every verdict on each rejection would mean
    // recomputing the whole library to record a "no".
    expect(changesEnforcement([{ ruleId: 'a', from: 'proposed', to: 'rejected' }])).toBe(false);
  });

  it('is false for no decisions at all', () => {
    expect(changesEnforcement([])).toBe(false);
  });
});

describe('groupPendingByKind', () => {
  function kindRule(id: string, kind: string): CoopRule {
    return { id, kind, severity: 'error', description: id, citation: 'c', reviewState: 'proposed' } as CoopRule;
  }

  it('puts the biggest group first — the prohibited-terms list', () => {
    const groups = groupPendingByKind([
      kindRule('z1', 'min_font_size'),
      kindRule('a1', 'banned_phrase'),
      kindRule('a2', 'banned_phrase'),
      kindRule('a3', 'banned_phrase'),
      kindRule('r1', 'required_element'),
      kindRule('r2', 'required_element'),
    ]);
    expect(groups.map((g) => `${g.kind}:${g.rules.length}`)).toEqual([
      'banned_phrase:3',
      'required_element:2',
      'min_font_size:1',
    ]);
  });

  it('breaks ties by kind name so the order is stable across renders', () => {
    const groups = groupPendingByKind([kindRule('b', 'required_phrase'), kindRule('a', 'banned_phrase')]);
    expect(groups.map((g) => g.kind)).toEqual(['banned_phrase', 'required_phrase']);
  });

  it('ignores anything not awaiting review', () => {
    const accepted = { ...kindRule('done', 'banned_phrase'), reviewState: 'accepted' } as CoopRule;
    const handWritten = { id: 'hand', kind: 'banned_phrase', severity: 'error', description: 'h', citation: 'c' } as CoopRule;
    expect(groupPendingByKind([accepted, handWritten])).toEqual([]);
  });
});

describe('required fields — review and fold', () => {
  const pack: CoopRulePack = {
    make: 'Subaru',
    version: 'saf-2026-04',
    verified: true,
    rules: [],
    requiredFields: [
      { field: 'vin', offerTypes: [], reason: 'VIN must appear.', reviewState: 'proposed', origin: 'ai' },
      { field: 'expiration', offerTypes: ['lease'], reason: 'End date.', reviewState: 'proposed', origin: 'ai' },
      { field: 'msrp', offerTypes: [], reason: 'Typed by a person.' },
    ],
  };

  it('accepts a proposal and attributes it', () => {
    const r = applyRequiredFieldReviews(pack, [{ key: 'vin|', state: 'accepted' }], 'Dana', NOW);
    const got = r.pack.requiredFields!.find((e) => e.field === 'vin')!;
    expect(got.reviewState).toBe('accepted');
    expect(got.reviewedBy).toBe('Dana');
    expect(r.applied).toEqual([{ key: 'vin|', from: 'proposed', to: 'accepted' }]);
  });

  it('refuses to decide a hand-written entry', () => {
    const r = applyRequiredFieldReviews(pack, [{ key: 'msrp|', state: 'rejected' }], 'Dana', NOW);
    expect(r.applied).toEqual([]);
    expect(r.pack.requiredFields!.find((e) => e.field === 'msrp')!.reviewState).toBeUndefined();
  });

  it('keys an entry by field AND scope, so the same field can differ per offer type', () => {
    const r = applyRequiredFieldReviews(pack, [{ key: 'expiration|lease', state: 'accepted' }], 'Dana', NOW);
    expect(r.applied).toHaveLength(1);
    // The unscoped vin entry is untouched by a scoped decision.
    expect(r.pack.requiredFields!.find((e) => e.field === 'vin')!.reviewState).toBe('proposed');
  });

  it('folds only ACCEPTED entries, and an empty scope means every offer type', () => {
    const accepted = applyRequiredFieldReviews(
      pack,
      [
        { key: 'vin|', state: 'accepted' },
        { key: 'expiration|lease', state: 'accepted' },
      ],
      'Dana',
      NOW,
    ).pack;
    const folded = foldRequiredFields(accepted, ['lease', 'apr']);
    expect(folded.lease.sort()).toEqual(['expiration', 'vin']);
    expect(folded.apr).toEqual(['vin']);
  });

  it('leaves a proposal out of the fold entirely', () => {
    expect(foldRequiredFields(pack, ['lease', 'apr'])).toEqual({});
  });

  it('is ADDITIVE — it never drops what a person already required', () => {
    // Two makes have hand-maintained lists and no rule pack. A derived list that
    // replaced them would delete requirements with no recorded source.
    const accepted = applyRequiredFieldReviews(pack, [{ key: 'vin|', state: 'accepted' }], 'Dana', NOW).pack;
    const folded = foldRequiredFields(accepted, ['lease'], { lease: ['securityDeposit'], apr: ['aprTerm'] });
    expect(folded.lease.sort()).toEqual(['securityDeposit', 'vin']);
    expect(folded.apr).toEqual(['aprTerm']);
  });

  it('does not duplicate a field a person already required', () => {
    const accepted = applyRequiredFieldReviews(pack, [{ key: 'vin|', state: 'accepted' }], 'Dana', NOW).pack;
    const folded = foldRequiredFields(accepted, ['lease'], { lease: ['vin'] });
    expect(folded.lease).toEqual(['vin']);
  });

  it('reports pending entries and nothing else', () => {
    expect(pendingRequiredFields(pack).map((e) => e.field)).toEqual(['vin', 'expiration']);
  });
});
