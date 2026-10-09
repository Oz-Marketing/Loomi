import { describe, expect, it } from 'vitest';
import { asAccount, draft } from './__fixtures__/drafts';
import { DRAFT_RULES, evaluateDraft, ruleApplies } from './registry';
import { dealerLogoRule, noFooterLogoRule, yagHelveticaRule } from './rules/brand';
import { hondaNameRule, hondaPaletteRule } from './rules/oem';
import type { DraftRule } from './types';

describe('the baseline fixture', () => {
  // Every other test breaks ONE thing in this draft, so it has to be clean.
  it('passes every rule with nothing to report', async () => {
    const result = evaluateDraft(await draft());
    expect(result.violations).toEqual([]);
    expect(result.blocked).toBe(false);
    expect(result.checked).toContain('claims.supported');
    expect(result.checked).toContain('fonts.yag-helvetica');
  });

  it('stays clean under the Kia and Honda palettes', async () => {
    const base = await draft();
    for (const oems of [['Kia'], ['Honda']]) {
      const result = evaluateDraft(asAccount(base, { oems: [...oems, 'Chevrolet'] }));
      expect(result.violations, oems.join()).toEqual([]);
    }
  });
});

describe('the rule list', () => {
  it('has unique ids and a summary for each rule', () => {
    const ids = DRAFT_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of DRAFT_RULES) expect(rule.summary.trim(), rule.id).not.toBe('');
  });
});

describe('scoping', () => {
  it('binds an OEM rule only to stores selling that make', async () => {
    const base = await draft();
    expect(ruleApplies(hondaPaletteRule, base)).toBe(false);
    expect(ruleApplies(hondaPaletteRule, asAccount(base, { oems: ['Honda'] }))).toBe(true);
    // Young Honda Powerhouse sells a different brand on purpose.
    expect(ruleApplies(hondaNameRule, asAccount(base, { oems: ['Honda Powersports'] }))).toBe(false);
  });

  it('binds a group rule to the group and every account under it', async () => {
    const base = await draft();
    expect(ruleApplies(yagHelveticaRule, base)).toBe(true);
    expect(ruleApplies(yagHelveticaRule, asAccount(base, { key: 'youngAutomotiveGroup', groupKeys: [] }))).toBe(true);
    expect(ruleApplies(yagHelveticaRule, asAccount(base, { groupKeys: ['youngPowersports'] }))).toBe(false);
  });

  it('applies exactly one of the two footer-logo rules to any store', async () => {
    const base = await draft();
    for (const oems of [['Chevrolet'], ['Hyundai'], ['Audi'], ['Volkswagen'], ['Hyundai', 'Genesis'], []]) {
      const a = asAccount(base, { oems });
      const applying = [dealerLogoRule, noFooterLogoRule].filter((r) => ruleApplies(r, a));
      expect(applying, oems.join() || 'no make').toHaveLength(1);
    }
  });
});

describe('evaluateDraft', () => {
  it('blocks on an error and not on a warning', async () => {
    const a = await draft();
    const warn: DraftRule = { id: 't.warn', scope: {}, summary: 't', check: () => [{ severity: 'warning', message: 'w' }] };
    const fail: DraftRule = { id: 't.fail', scope: {}, summary: 't', check: () => [{ severity: 'error', message: 'e' }] };
    expect(evaluateDraft(a, [warn]).blocked).toBe(false);
    expect(evaluateDraft(a, [warn, fail]).blocked).toBe(true);
    expect(evaluateDraft(a, [fail]).violations[0]).toMatchObject({ ruleId: 't.fail', severity: 'error' });
  });

  it('fails closed when a rule crashes', async () => {
    const broken: DraftRule = {
      id: 't.broken',
      scope: {},
      summary: 't',
      check: () => {
        throw new Error('boom');
      },
    };
    const result = evaluateDraft(await draft(), [broken]);
    expect(result.blocked).toBe(true);
    expect(result.violations[0].message).toMatch(/crashed.*boom/);
  });
});
