import { describe, expect, it } from 'vitest';
import type { CoopRule, CoopRulePack } from '@/lib/ad-generator/coop-rules';
import type { EmailTemplate } from '@/lib/email/types';
import { DISCLAIMER, asAccount, blockById, draft } from '../__fixtures__/drafts';
import { evaluateDraft } from '../registry';
import type { DraftArtifact } from '../types';
import { coopBannedPhrasesRule, coopPackRequirementsRule } from './coop';

/** The four kept requirements, as the Subaru pack transcribes them. */
const DBA: CoopRule = {
  id: 'subaru-retailer-dba-required',
  kind: 'required_element',
  field: 'dealerName',
  severity: 'error',
  description: "All advertising must contain the retailer's official DBA.",
  citation: '§1b p.38',
};
const YMM: CoopRule = {
  id: 'subaru-year-and-model-required',
  kind: 'required_element',
  field: 'vehicleName',
  severity: 'error',
  description: 'All advertising must include the year and model of the vehicle offered.',
};
const VIN: CoopRule = {
  id: 'subaru-vin-required',
  kind: 'required_phrase',
  field: 'disclaimer',
  // As transcribed. Matched case-insensitively, any eight-letter word passes it.
  pattern: '[A-Z0-9]{8}',
  severity: 'error',
  description: 'ANY offer ad must include at least the last eight digits of a valid VIN.',
};
const LEASE: CoopRule = {
  id: 'subaru-lease-word-required',
  kind: 'required_phrase',
  field: '_offerLabel',
  phrase: 'lease',
  severity: 'error',
  description: 'The word "lease" must appear next to the lease payment.',
  scope: { offerTypes: ['lease'] },
};
const BANNED: CoopRule = {
  id: 'subaru-banned-race-to-bottom',
  kind: 'banned_phrase',
  pattern: 'best price',
  severity: 'error',
  description: 'Race-to-the-bottom language is prohibited.',
  citation: '§6p p.42',
};

function pack(rules: CoopRule[]): CoopRulePack {
  return { make: 'Chevrolet', version: 'test', verified: true, rules };
}

const bestPrice = (t: EmailTemplate) => {
  blockById(t, 'body').props.text = 'The best price on a 2026 Chevy Equinox ACTIV: $3,500 off.';
};

/** A co-op request carrying only `rules`. */
function coopDraft(rules: CoopRule[], patch: Partial<DraftArtifact> = {}, edit?: (t: EmailTemplate) => void) {
  return draft(edit, { coop: true, coopPack: pack(rules), ...patch });
}

describe('co-op never blocks', () => {
  // The whole point: whatever the pack says, however the request is flagged,
  // whether a person signed the rule off — a co-op finding is a note.
  it('reports only warnings, even for a verified pack and an accepted rule on a co-op request', async () => {
    const a = await coopDraft(
      [DBA, YMM, VIN, LEASE, { ...BANNED, reviewState: 'accepted' }],
      { offerType: 'lease' },
      (t) => {
        blockById(t, 'body').props.text = 'The best price on a 2026 Chevy Equinox ACTIV: $299/mo.';
      },
    );
    const coop = evaluateDraft(asAccount(a, { dealer: 'Young Chevrolet of Nowhere' })).violations.filter((v) =>
      v.ruleId.startsWith('coop.'),
    );
    // A banned phrase, a dealer name never given in full, no VIN, no "lease" by the payment.
    expect(coop).toHaveLength(4);
    expect(coop.every((v) => v.severity === 'warning')).toBe(true);
  });
});

describe('coop.banned-phrases', () => {
  it('warns on a banned phrase in the copy, co-op or not', async () => {
    for (const coop of [true, false]) {
      const a = await draft(bestPrice, { coop, coopPack: pack([BANNED]) });
      expect(coopBannedPhrasesRule.check(a)).toEqual([
        {
          severity: 'warning',
          message: 'Chevrolet co-op: Race-to-the-bottom language is prohibited. (§6p p.42)',
          where: 'block:body',
          excerpt: 'The best price on a 2026 Chevy Equinox ACTIV: $3,500 off.',
        },
      ]);
    }
  });

  it('skips proposed rules, other offer types, and the verbatim disclaimer', async () => {
    expect(coopBannedPhrasesRule.check(await draft(bestPrice, { coopPack: pack([{ ...BANNED, reviewState: 'proposed' }]) }))).toEqual([]);
    const leaseOnly = pack([{ ...BANNED, scope: { offerTypes: ['lease'] } }]);
    expect(coopBannedPhrasesRule.check(await draft(bestPrice, { offerType: 'cash', coopPack: leaseOnly }))).toEqual([]);

    const a = await draft(undefined, { coopPack: pack([BANNED]) });
    const text = `${DISCLAIMER} Best price guaranteed.`;
    blockById(a.template, 'disclaimer').props.text = text;
    expect(coopBannedPhrasesRule.check({ ...a, disclaimer: { ...a.disclaimer!, text } })).toEqual([]);
  });
});

describe('coop.pack-requirements', () => {
  it('says nothing on a request that isn’t co-op', async () => {
    const a = asAccount(await coopDraft([DBA, YMM, VIN, LEASE], { coop: false }), { dealer: 'Young Chevrolet of Nowhere' });
    expect(coopPackRequirementsRule.check(a)).toEqual([]);
  });

  it('notes a dealer name the email never gives in full', async () => {
    const a = asAccount(await coopDraft([DBA]), { dealer: 'Young Chevrolet of Nowhere' });
    expect(coopPackRequirementsRule.check(a).map((f) => f.message)).toEqual([
      'Chevrolet co-op: the email never names Young Chevrolet of Nowhere in full. (§1b p.38)',
    ]);
    expect(coopPackRequirementsRule.check(await coopDraft([DBA]))).toEqual([]);
  });

  it('notes an email that never gives year, make and model together', async () => {
    const a = await coopDraft([YMM], {}, (t) => {
      blockById(t, 'headline').props.text = 'Equinox ACTIV, $3,500 off';
      blockById(t, 'body').props.text = 'Take $3,500 off MSRP this month at Young Chevrolet.';
      blockById(t, 'hero').props.alt = 'Equinox ACTIV';
    });
    // The subject lines name the 2026 Chevy Equinox, but the subject isn't the
    // ad — and "Young Chevrolet" in the disclaimer names the store, not the make.
    expect(coopPackRequirementsRule.check(a).map((f) => f.message)).toEqual([
      'Chevrolet co-op: no line of copy gives the vehicle as year, make and model ("2026 Chevrolet Equinox").',
    ]);
  });

  it('accepts "Chevy" for Chevrolet in the vehicle line', async () => {
    // Only the body line names it now: "a new 2026 Chevy Equinox ACTIV".
    const a = await coopDraft([YMM], {}, (t) => {
      blockById(t, 'hero').props.alt = 'Equinox ACTIV';
      blockById(t, 'headline').props.text = 'Equinox ACTIV, $3,500 off';
    });
    expect(coopPackRequirementsRule.check(a)).toEqual([]);
  });

  it('wants a real VIN in the disclaimer, not just any eight-letter word', async () => {
    expect(coopPackRequirementsRule.check(await coopDraft([VIN])).map((f) => f.message)).toEqual([
      'Chevrolet co-op: the disclaimer shows no VIN (at least the last 8). It comes verbatim from the creative, so this is one for design.',
    ]);

    const text = `${DISCLAIMER} VIN: N3123456.`;
    const a = await coopDraft([VIN], { disclaimer: { text, blockId: 'disclaimer' } }, (t) => {
      blockById(t, 'disclaimer').props.text = text;
    });
    expect(coopPackRequirementsRule.check(a)).toEqual([]);
  });

  it('wants "lease" beside every lease payment, and "please" doesn’t count', async () => {
    const a = await coopDraft([LEASE], { offerType: 'lease' }, (t) => {
      blockById(t, 'headline').props.text = 'Lease the 2026 Chevy Equinox ACTIV for $299/mo';
      blockById(t, 'body').props.text = 'Just $299 per month for a 2026 Chevy Equinox ACTIV. Please visit Young Chevrolet.';
    });
    expect(coopPackRequirementsRule.check(a)).toMatchObject([
      { severity: 'warning', where: 'block:body', message: expect.stringContaining('without "lease" beside it') },
    ]);
  });
});
