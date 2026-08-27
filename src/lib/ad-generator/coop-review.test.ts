import { describe, it, expect } from 'vitest';
import {
  applyRuleReviews,
  pendingRules,
  changesEnforcement,
  groupPendingByKind,
  applyRequiredFieldReviews,
  pendingRequiredFields,
  foldRequiredFields,
  mergeMustInclude,
  findSupersededPhraseRules,
} from './coop-review';
import type { CoopRule, CoopRulePack, RequiredFieldEntry } from './coop-rules';

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
    // `required_element` is deliberately absent: it is reviewed in the merged
    // "must include" list, and appearing here too would ask the same question twice.
    expect(groups.map((g) => `${g.kind}:${g.rules.length}`)).toEqual([
      'banned_phrase:3',
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

describe('mergeMustInclude — one list, enforcement derived', () => {
  const FILLABLE = new Set(['msrp', 'expiration', 'vin', 'monthlyPayment']);

  const designRule = (field: string, id = field): CoopRule =>
    ({
      id,
      kind: 'required_element',
      field,
      severity: 'error',
      description: `The ad must show the ${field}.`,
      citation: 'SAF §6a, p.40',
      reviewState: 'proposed',
      origin: 'ai',
      sourcePage: 40,
      sourceQuote: `the ${field} must appear`,
    }) as CoopRule;

  const dataEntry = (field: string, offerTypes: string[] = []): RequiredFieldEntry => ({
    field,
    offerTypes,
    reason: `${field} must be stated on every ad.`,
    reviewState: 'proposed',
    origin: 'ai',
    sourcePage: 41,
    sourceQuote: `must state the ${field}`,
  });

  it('merges the two halves for the same field into ONE row', () => {
    const rows = mergeMustInclude([designRule('msrp')], [dataEntry('msrp')], FILLABLE);
    expect(rows).toHaveLength(1);
    expect(rows[0].enforcement).toBe('both');
    // Both underlying items are addressable, so accepting the row decides both.
    expect(rows[0].ruleId).toBe('msrp');
    expect(rows[0].fieldKey).toBe('msrp|');
  });

  it('a branding field is design-only — nobody fills a logo per ad', () => {
    const rows = mergeMustInclude([designRule('logoUrl')], [], FILLABLE);
    expect(rows[0].enforcement).toBe('design');
    expect(rows[0].fieldKey).toBeUndefined();
  });

  it('a fillable field with only a data requirement is data-only', () => {
    const rows = mergeMustInclude([], [dataEntry('expiration')], FILLABLE);
    expect(rows[0].enforcement).toBe('data');
    expect(rows[0].ruleId).toBeUndefined();
  });

  it('never claims a design check it has no evidence for', () => {
    // A non-fillable field arriving only as a data requirement is a modelling
    // mistake; the row claims the check it can actually run, not both.
    const rows = mergeMustInclude([], [dataEntry('brandColor')], FILLABLE);
    expect(rows[0].enforcement).toBe('design');
  });

  it('unions offer-type scopes, and an unscoped half wins', () => {
    const scoped = { ...designRule('vin'), scope: { offerTypes: ['lease'] } } as CoopRule;
    expect(mergeMustInclude([scoped], [dataEntry('vin', ['apr'])], FILLABLE)[0].offerTypes.sort()).toEqual([
      'apr',
      'lease',
    ]);
    // Unscoped means every offer type, so it cannot be narrowed by the other half.
    expect(mergeMustInclude([designRule('vin')], [dataEntry('vin', ['apr'])], FILLABLE)[0].offerTypes).toEqual([]);
  });

  it('ignores anything already decided', () => {
    const done = { ...designRule('msrp'), reviewState: 'accepted' } as CoopRule;
    expect(mergeMustInclude([done], [{ ...dataEntry('vin'), reviewState: 'rejected' }], FILLABLE)).toEqual([]);
  });

  it('keeps required_element out of the kind-grouped list, so it is asked once', () => {
    const groups = groupPendingByKind([
      designRule('msrp'),
      { id: 'b', kind: 'banned_phrase', severity: 'error', description: 'no', phrase: 'x', reviewState: 'proposed' } as CoopRule,
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['banned_phrase']);
  });
});

describe('findSupersededPhraseRules', () => {
  const single = (id: string, phrase: string, reviewState: CoopRule['reviewState'] = 'proposed'): CoopRule =>
    ({ id, kind: 'banned_phrase', severity: 'error', description: `no ${phrase}`, phrase, reviewState }) as CoopRule;
  const list = (id: string, phrases: string[], reviewState: CoopRule['reviewState']): CoopRule =>
    ({ id, kind: 'banned_phrase', severity: 'error', description: 'list', phrases, reviewState }) as CoopRule;
  const pack = (rules: CoopRule[]): CoopRulePack => ({ make: 'Subaru', version: '1', rules });

  it('finds a single-term proposal an ACCEPTED list already covers', () => {
    const r = findSupersededPhraseRules(
      pack([list('L', ['invoice', 'blowout'], 'accepted'), single('s1', 'blowout')]),
    );
    expect(r).toEqual([{ ruleId: 's1', phrase: 'blowout', coveredBy: 'L', coverState: 'accepted' }]);
  });

  it('leaves a term no list covers alone', () => {
    // It is the only thing covering that term; declining it drops the requirement.
    const r = findSupersededPhraseRules(pack([list('L', ['invoice'], 'accepted'), single('s1', 'clearance')]));
    expect(r).toEqual([]);
  });

  it('ignores a PROPOSED list by default', () => {
    // A proposed list could itself be declined, leaving the terms covered by nothing.
    const p = pack([list('L', ['blowout'], 'proposed'), single('s1', 'blowout')]);
    expect(findSupersededPhraseRules(p)).toEqual([]);
    expect(findSupersededPhraseRules(p, { includeProposedLists: true })).toHaveLength(1);
  });

  it('never touches a hand-written rule', () => {
    const hand = { ...single('h', 'blowout'), reviewState: undefined } as CoopRule;
    expect(findSupersededPhraseRules(pack([list('L', ['blowout'], 'accepted'), hand]))).toEqual([]);
  });

  it('never touches an already-decided proposal', () => {
    const done = single('s1', 'blowout', 'accepted');
    const gone = single('s2', 'invoice', 'rejected');
    const r = findSupersededPhraseRules(pack([list('L', ['blowout', 'invoice'], 'accepted'), done, gone]));
    expect(r).toEqual([]);
  });

  it('matches across punctuation and case', () => {
    const r = findSupersededPhraseRules(
      pack([list('L', ['“Employee Pricing”'], 'accepted'), single('s1', 'employee pricing')]),
    );
    expect(r).toHaveLength(1);
  });

  it('prefers an accepted cover over a proposed one when both exist', () => {
    const r = findSupersededPhraseRules(
      pack([
        list('P', ['blowout'], 'proposed'),
        list('A', ['blowout'], 'accepted'),
        single('s1', 'blowout'),
      ]),
      { includeProposedLists: true },
    );
    expect(r[0].coveredBy).toBe('A');
    expect(r[0].coverState).toBe('accepted');
  });

  it('does not report a list rule as superseding itself', () => {
    expect(findSupersededPhraseRules(pack([list('L', ['blowout'], 'accepted')]))).toEqual([]);
  });
});
