import {
  extractClaims,
  indexFacts,
  isExempt,
  isSupported,
  makeIsSupported,
  makesMentioned,
} from '../facts';
import { copySurfaces } from '../surfaces';
import type { DraftRule, Finding } from '../types';

/**
 * House rule 1, enforced: nothing in the copy may state a number, date or make
 * that the confirmed extraction or the written request doesn't.
 *
 * Checks every subject line, preview line, block and alt text the model wrote.
 * Skips the two parts code assembles from trusted data — the verbatim
 * disclaimer, and the footer (built from the account record).
 */
export const claimsRule: DraftRule = {
  id: 'claims.supported',
  scope: {},
  summary: 'Every number, date and make in the copy appears in the creative or the request.',
  check(a) {
    const factTexts = a.facts.map((f) => f.text);
    const facts = indexFacts(factTexts);
    const findings: Finding[] = [];

    for (const surface of copySurfaces(a)) {
      if (surface.inFooter) continue;
      const reported = new Set<string>();
      for (const claim of extractClaims(surface.text)) {
        if (isExempt(claim) || isSupported(claim, facts) || reported.has(claim.raw)) continue;
        reported.add(claim.raw);
        findings.push({
          severity: 'error',
          message: `${surface.where} says "${claim.raw}", which isn't in the creative or the request.`,
          where: surface.where,
          excerpt: surface.text,
        });
      }
      for (const make of makesMentioned(surface.text)) {
        if (makeIsSupported(make, a.account.oems, factTexts)) continue;
        findings.push({
          severity: 'error',
          message: `${surface.where} names ${make}. ${a.account.dealer} doesn't sell it, and neither the creative nor the request mentions it.`,
          where: surface.where,
          excerpt: surface.text,
        });
      }
    }
    return findings;
  },
};
