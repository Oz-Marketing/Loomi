import { describe, it, expect } from 'vitest';
import { planInlineFlagRepair } from './coop-pattern-repair';

// Shaped like the stored packs: drafted rules beside hand-written ones, review
// decisions on some, and a pack-level `requiredFields` list.
const proposed = {
  id: 'subaru-ads-must-not-contain-political-sexual-ra',
  kind: 'banned_phrase',
  origin: 'ai',
  pattern: '(?i)political|sexual|racial|religious',
  citation: 'SAF 2026 — §10a, p.47',
  severity: 'error',
  sourcePage: 47,
  description: 'Ads must not contain political, sexual, racial or religious content.',
  reviewState: 'proposed',
  sourceQuote: 'Advertisements are prohibited from use of political, sexual, racial and religious content.',
};
const accepted = {
  id: 'chevrolet-do-not-use-the-phrase-the-gm-store-or-th',
  kind: 'banned_phrase',
  origin: 'ai',
  pattern: '(?i)the GM (store|outlet)',
  severity: 'error',
  description: 'Do not use the phrase "The GM store".',
  reviewState: 'accepted',
  reviewedBy: 'Connor Kelly',
  reviewedAt: '2026-08-26T01:23:05.354Z',
};
const handWritten = {
  id: 'subaru-banned-markup',
  kind: 'banned_phrase',
  pattern: 'additional dealer markup|\\bADM\\b',
  severity: 'error',
  description: 'No dealer markup language.',
};

function stored(rules: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ make: 'Subaru', version: 'saf-2026-04', verified: false, rules, ...extra });
}

describe('planInlineFlagRepair', () => {
  it('repairs a proposal, changing ONLY its pattern', () => {
    const text = stored([handWritten, proposed], { requiredFields: [{ field: 'vin', offerTypes: [] }] });
    const plan = planInlineFlagRepair(text);
    expect(plan.repairs).toEqual([
      expect.objectContaining({
        index: 1,
        ruleId: proposed.id,
        reviewState: 'proposed',
        from: '(?i)political|sexual|racial|religious',
        to: 'political|sexual|racial|religious',
        action: 'repair',
      }),
    ]);
    const before = JSON.parse(text);
    const after = JSON.parse(plan.next!);
    expect(after.rules[1]).toEqual({ ...proposed, pattern: 'political|sexual|racial|religious' });
    // Everything else exactly as read — including the pack's own fields.
    expect(after.rules[0]).toEqual(before.rules[0]);
    expect({ ...after, rules: null }).toEqual({ ...before, rules: null });
    // Key order kept, so the stored text differs only in that one value.
    expect(plan.next).toBe(text.replace('"(?i)political', '"political'));
  });

  it('repairs a rejected rule too — it evaluates as nothing either way', () => {
    const plan = planInlineFlagRepair(stored([{ ...proposed, reviewState: 'rejected' }]));
    expect(plan.repairs[0].action).toBe('repair');
    expect(plan.next).not.toBeNull();
  });

  // Its pattern never compiled, so it never fired. Repairing it switches it on, at
  // error severity, for a regex nobody in review was shown.
  it('HOLDS an accepted rule unless asked, and writes nothing for it', () => {
    const plan = planInlineFlagRepair(stored([accepted]));
    expect(plan.repairs[0]).toMatchObject({ action: 'held', reviewState: 'accepted', severity: 'error' });
    expect(plan.next).toBeNull();
  });

  it('repairs an accepted rule when asked, leaving its review record alone', () => {
    const plan = planInlineFlagRepair(stored([accepted]), { includeAccepted: true });
    expect(plan.repairs[0].action).toBe('repair');
    expect(JSON.parse(plan.next!).rules[0]).toEqual({ ...accepted, pattern: 'the GM (store|outlet)' });
  });

  it('treats a rule with no review state as hand-written, and so as enforced', () => {
    const plan = planInlineFlagRepair(stored([{ ...handWritten, pattern: '(?i)\\bADM\\b' }]));
    expect(plan.repairs[0]).toMatchObject({ reviewState: 'hand-written', action: 'held' });
  });

  it('leaves a pattern that is still invalid without (?i) for a person', () => {
    const plan = planInlineFlagRepair(stored([{ ...proposed, pattern: '(?i)(?P<topic>political)' }]));
    expect(plan.repairs[0]).toMatchObject({ action: 'still_invalid', problem: 'Invalid group' });
    expect(plan.next).toBeNull();
  });

  it('will not turn a pattern of only (?i) into an empty one', () => {
    const plan = planInlineFlagRepair(stored([{ ...proposed, pattern: '(?i)' }]));
    expect(plan.repairs[0].action).toBe('still_invalid');
    expect(plan.next).toBeNull();
  });

  it('touches only a LEADING (?i) on a phrase rule', () => {
    const plan = planInlineFlagRepair(
      stored([
        { ...proposed, id: 'mid', pattern: 'free(?i)dom' },
        { ...proposed, id: 'other-flag', pattern: '(?s)a.b' },
        { id: 'zone', kind: 'element_zone', pattern: '(?i)x', reviewState: 'proposed' },
        { ...proposed, id: 'not-a-string', pattern: 42 },
        handWritten,
      ]),
    );
    expect(plan.repairs).toEqual([]);
    expect(plan.next).toBeNull();
  });

  // parseCoopPack drops entries like these. Writing its output back would delete them.
  it('keeps entries the pack parser would discard', () => {
    const odd = [null, { id: 'no-kind' }, 'stray'];
    const plan = planInlineFlagRepair(stored([...odd, proposed]));
    expect(JSON.parse(plan.next!).rules.slice(0, 3)).toEqual(odd);
  });

  it('repairs by position, so two rules sharing an id are each handled', () => {
    const plan = planInlineFlagRepair(stored([proposed, { ...proposed, pattern: '(?i)racial' }]));
    expect(plan.repairs.map((r) => r.index)).toEqual([0, 1]);
    expect(JSON.parse(plan.next!).rules.map((r: { pattern: string }) => r.pattern)).toEqual([
      'political|sexual|racial|religious',
      'racial',
    ]);
  });

  it('is idempotent: a repaired pack has nothing left to repair', () => {
    const once = planInlineFlagRepair(stored([handWritten, proposed, accepted]), { includeAccepted: true });
    expect(planInlineFlagRepair(once.next!, { includeAccepted: true })).toEqual({ repairs: [], next: null });
  });

  it('refuses text it cannot safely rewrite', () => {
    expect(planInlineFlagRepair('{not json').unreadable).toMatch(/not valid JSON/);
    expect(planInlineFlagRepair('{"make":"Subaru"}').unreadable).toMatch(/no rules array/);
    expect(planInlineFlagRepair('null').unreadable).toMatch(/no rules array/);
  });
});
