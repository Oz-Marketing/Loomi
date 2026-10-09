import { bannedPhraseHit, effectiveSeverity } from '@/lib/ad-generator/coop-rules';
import { copySurfaces } from '../surfaces';
import type { DraftRule, Finding } from '../types';

/**
 * The advertised make's co-op banned phrases, run over the email's copy with
 * the ad engine's own matcher.
 *
 * Severity follows two questions, both of which must say "yes" to block:
 *
 *   1. Is this request co-op? Co-op guidelines bind co-op-claimed advertising,
 *      so on a request whose monday Co-op flag isn't Yes / Compliance Check a
 *      hit only warns.
 *   2. Has a person signed off on the rule? The ad engine's `effectiveSeverity`
 *      gate: a rule in a pack nobody has verified warns until someone accepts
 *      it, so a half-transcribed pack can't stop a dealer's whole month. As of
 *      2026-10-09 no pack in production is signed off, so today every hit warns.
 *
 * The verbatim disclaimer is skipped — it's the manufacturer's own text, and a
 * hit inside it isn't something a drafter can change.
 */
export const coopBannedPhrasesRule: DraftRule = {
  id: 'coop.banned-phrases',
  scope: {},
  summary: "The make's co-op banned phrases: an error on co-op requests once signed off, a warning otherwise.",
  check(a) {
    const pack = a.coopPack;
    if (!pack) return [];
    const surfaces = copySurfaces(a);
    const findings: Finding[] = [];

    for (const rule of pack.rules) {
      if (rule.kind !== 'banned_phrase') continue;
      if (rule.reviewState === 'proposed' || rule.reviewState === 'rejected') continue;
      // Scoped to offer types this email isn't — skip. Unknown offer type: apply.
      const types = rule.scope?.offerTypes;
      if (types?.length && a.offerType && !types.includes(a.offerType)) continue;

      const signedOff = effectiveSeverity(rule, pack);
      const severity = a.coop ? signedOff : 'warning';
      const why = !a.coop
        ? ' A warning, because this request isn\'t co-op.'
        : signedOff === 'warning' && rule.severity === 'error'
          ? ' A warning until someone signs off this rule.'
          : '';

      for (const surface of surfaces) {
        const hit = bannedPhraseHit(rule, surface.text);
        if (hit === null) continue;
        findings.push({
          severity,
          message: `${pack.make} co-op: ${rule.description}${rule.citation ? ` (${rule.citation})` : ''}${why}`,
          where: surface.where,
          excerpt: hit || surface.text.slice(0, 120),
        });
      }
    }
    return findings;
  },
};
