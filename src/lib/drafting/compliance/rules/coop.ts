import { bannedPhraseHit, type CoopRule, type CoopRulePack } from '@/lib/ad-generator/coop-rules';
import { stripTags } from '../html';
import { makesMentioned } from '../facts';
import { copySurfaces, findBlock, textSurfaces } from '../surfaces';
import type { DraftArtifact, DraftRule, Finding } from '../types';

/**
 * Co-op checks — NEVER blocking.
 *
 * The goal for a co-op-flagged request is a draft as close to co-op compliant
 * as it reasonably gets, so the person proofing has less to fix. Reimbursement
 * is not this pipeline's problem: nothing here can stop a draft reaching Draft
 * Files. Every finding is a warning, read as a note on the draft. The hard
 * blocks (facts, verbatim disclaimer, house rules) live elsewhere, because they
 * are about not sending something wrong — a different risk.
 */

function cite(rule: CoopRule): string {
  return rule.citation ? ` (${rule.citation})` : '';
}

/**
 * The make's co-op banned phrases, matched with the ad engine's own matcher.
 * Runs on every request with a pack, co-op or not: the manufacturers police
 * this language in all advertising, not only what is claimed. The verbatim
 * disclaimer is skipped — it's the manufacturer's own text.
 */
export const coopBannedPhrasesRule: DraftRule = {
  id: 'coop.banned-phrases',
  scope: {},
  summary: "The make's co-op banned phrases, as warnings.",
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
      for (const surface of surfaces) {
        const hit = bannedPhraseHit(rule, surface.text);
        if (hit === null) continue;
        findings.push({
          severity: 'warning',
          message: `${pack.make} co-op: ${rule.description}${cite(rule)}`,
          where: surface.where,
          excerpt: hit || surface.text.slice(0, 120),
        });
      }
    }
    return findings;
  },
};

// ── The cheap, mechanical pack requirements ──────────────────────────────────
//
// Four requirements the packs carry that can be checked on an email for
// nothing: the dealer's full name, the vehicle's year/make/model, the VIN's last
// eight in the disclaimer, and "lease" beside a lease payment. The PACK decides
// whether each applies to a make (by its kind and field); the MATCHING is done
// here, for email, because two of the transcribed matchers don't survive contact
// with real copy: the Subaru VIN pattern `[A-Z0-9]{8}` is matched
// case-insensitively, so any eight-letter word ("Advertis…") satisfies it, and a
// `phrase: 'lease'` is a substring test that "please" passes.

function activeRules(pack: CoopRulePack, offerType: string | null): CoopRule[] {
  return pack.rules.filter((r) => {
    if (r.reviewState === 'proposed' || r.reviewState === 'rejected') return false;
    const types = r.scope?.offerTypes;
    return !(types?.length && offerType && !types.includes(offerType));
  });
}

const fold = (s: string) => s.toLowerCase().replace(/[\s-]+/g, '');

/**
 * The tail of a VIN as it's printed: 8 characters (or a full 17) from the VIN
 * alphabet — no I, O or Q — mostly digits, since positions 12-17 are the serial.
 */
const VIN_TAIL = /\b(?=[A-HJ-NPR-Z0-9]*\d[A-HJ-NPR-Z0-9]*\d[A-HJ-NPR-Z0-9]*\d[A-HJ-NPR-Z0-9]*\d[A-HJ-NPR-Z0-9]*\d)(?:[A-HJ-NPR-Z0-9]{17}|[A-HJ-NPR-Z0-9]{8})\b/;

/** "$389/mo", "$389 per month", "$389 a month". */
const MONTHLY_PAYMENT = /\$\s?\d[\d,]*(?:\.\d+)?\s*(?:\/\s*mo(?:nth)?\b|\/mo\.|per\s+month|a\s+month|monthly)/i;

export const coopPackRequirementsRule: DraftRule = {
  id: 'coop.pack-requirements',
  scope: {},
  summary: 'Co-op requests: dealer full name, year/make/model, VIN last 8 in the disclaimer, "lease" beside the payment — as warnings.',
  check(a: DraftArtifact) {
    const pack = a.coopPack;
    if (!a.coop || !pack) return [];
    const findings: Finding[] = [];
    // The email itself — what a co-op screenshot shows. Subject and preview
    // lines aren't the ad, and a truncated inbox line can't carry a requirement.
    const body = textSurfaces(a).filter((s) => s.where.startsWith('block:') || s.where.startsWith('alt:'));
    const copy = copySurfaces(a).filter((s) => !s.inFooter);
    const dealerRe = new RegExp(a.account.dealer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');

    for (const rule of activeRules(pack, a.offerType)) {
      if (rule.kind === 'required_element' && rule.field === 'dealerName') {
        const named = body.some((s) => fold(s.text).includes(fold(a.account.dealer)));
        if (!named) {
          findings.push({
            severity: 'warning',
            message: `${pack.make} co-op: the email never names ${a.account.dealer} in full.${cite(rule)}`,
          });
        }
      }

      if (rule.kind === 'required_element' && rule.field === 'vehicleName' && a.vehicle) {
        const { year, make, model } = a.vehicle;
        if (year && make && model) {
          const described = body
            .filter((s) => !s.inFooter)
            // "Young Chevrolet" names a store, not the vehicle's make.
            .map((s) => s.text.replace(dealerRe, ' '))
            .some(
              (text) =>
                text.includes(String(year))
                && (makesMentioned(text).includes(make) || fold(text).includes(fold(make)))
                && fold(text).includes(fold(model)),
            );
          if (!described) {
            findings.push({
              severity: 'warning',
              message: `${pack.make} co-op: no line of copy gives the vehicle as year, make and model ("${year} ${make} ${model}").${cite(rule)}`,
            });
          }
        }
      }

      if (rule.kind === 'required_phrase' && rule.field === 'disclaimer' && /\bVIN\b/.test(rule.description)) {
        const block = a.disclaimer ? findBlock(a.template, a.disclaimer.blockId) : null;
        const text = a.disclaimer?.text ?? (block ? stripTags(String(block.props.text ?? '')) : '');
        if (!VIN_TAIL.test(text)) {
          findings.push({
            severity: 'warning',
            message: `${pack.make} co-op: the disclaimer shows no VIN (at least the last 8). It comes verbatim from the creative, so this is one for design.${cite(rule)}`,
            where: a.disclaimer ? `block:${a.disclaimer.blockId}` : 'disclaimer',
          });
        }
      }

      if (rule.kind === 'required_phrase' && rule.field === '_offerLabel' && rule.phrase && a.offerType === 'lease') {
        const word = new RegExp(`\\b${rule.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        for (const s of copy) {
          if (!MONTHLY_PAYMENT.test(s.text) || word.test(s.text)) continue;
          findings.push({
            severity: 'warning',
            message: `${pack.make} co-op: ${s.where} states a monthly payment without "${rule.phrase}" beside it.${cite(rule)}`,
            where: s.where,
            excerpt: s.text,
          });
        }
      }
    }
    return findings;
  },
};
