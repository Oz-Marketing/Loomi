import { dealerLogoRule, dealerNameRule, noFooterLogoRule, noSerifRule, siteUrlRule, yagHelveticaRule } from './rules/brand';
import { claimsRule } from './rules/claims';
import { coopBannedPhrasesRule } from './rules/coop';
import { utmRule } from './rules/links';
import {
  hondaNameRule,
  hondaPaletteRule,
  kiaPaletteRule,
  mazdaExclusivityRule,
  vwBackgroundRule,
  vwSquareCtaRule,
} from './rules/oem';
import { copyOptionsRule, disclaimerVerbatimRule, multiCtaRule, unsubscribeRule } from './rules/structure';
import type { DraftArtifact, DraftRule, Violation } from './types';

/**
 * Every compliance rule a drafted email must pass before it's written to
 * Draft Files. House rules are code, not prompting: the model is told them too,
 * but a draft that breaks one never reaches a proofer.
 *
 * To add a rule: write it beside its kin in `rules/`, give it a fixture test
 * that passes and one that fails, and list it here. Scope it by the account's
 * makes or groups rather than branching on the brand inside `check`.
 */
export const DRAFT_RULES: DraftRule[] = [
  // every draft
  copyOptionsRule,
  claimsRule,
  disclaimerVerbatimRule,
  unsubscribeRule,
  utmRule,
  multiCtaRule,
  noSerifRule,
  dealerNameRule,
  siteUrlRule,
  dealerLogoRule,
  coopBannedPhrasesRule,
  // groups
  yagHelveticaRule,
  // OEMs
  mazdaExclusivityRule,
  kiaPaletteRule,
  hondaPaletteRule,
  hondaNameRule,
  vwBackgroundRule,
  vwSquareCtaRule,
  noFooterLogoRule,
];

/** Does `rule` bind this draft's account? */
export function ruleApplies(rule: DraftRule, artifact: DraftArtifact): boolean {
  const { oems, groups, exceptOems } = rule.scope;
  const makes = artifact.account.oems.map((o) => o.toLowerCase());
  const sells = (list: string[]) => list.some((o) => makes.includes(o.toLowerCase()));
  if (oems?.length && !sells(oems)) return false;
  if (exceptOems?.length && sells(exceptOems)) return false;
  if (groups?.length) {
    const memberOf = new Set([artifact.account.key, ...artifact.account.groupKeys]);
    if (!groups.some((g) => memberOf.has(g))) return false;
  }
  return true;
}

export interface DraftEvaluation {
  violations: Violation[];
  /** Any error — the draft must not be written to Draft Files. */
  blocked: boolean;
  /** Ids of the rules that applied and ran, for the run log. */
  checked: string[];
}

export function evaluateDraft(artifact: DraftArtifact, rules: DraftRule[] = DRAFT_RULES): DraftEvaluation {
  const violations: Violation[] = [];
  const checked: string[] = [];
  for (const rule of rules) {
    if (!ruleApplies(rule, artifact)) continue;
    checked.push(rule.id);
    try {
      for (const finding of rule.check(artifact)) violations.push({ ruleId: rule.id, ...finding });
    } catch (err) {
      // Fail closed: a rule that can't run has not passed.
      violations.push({
        ruleId: rule.id,
        severity: 'error',
        message: `This check crashed, so the draft can't be cleared: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return { violations, blocked: violations.some((v) => v.severity === 'error'), checked };
}
