import { describe, expect, it } from 'vitest';
import { asAccount, blockById, draft } from '../__fixtures__/drafts';
import { evaluateDraft } from '../registry';
import type { DraftAccount, DraftArtifact } from '../types';
import { claimsRule } from './claims';

const MISSOULA: Partial<DraftAccount> = {
  key: 'youngMazdaOfMissoula',
  dealer: 'Young Mazda of Missoula',
  oems: ['Mazda'],
  siteDisplay: 'YoungMazdaMissoula.com',
  website: 'https://www.youngmazdamissoula.com/',
};

/** The offer the CX-90 email actually carried, from its body as sent. */
const CX90_OFFER = 'Finance the new 2026 Mazda CX-90 at 1.9% APR for 72 months at Young Mazda of Missoula.';

/** The Missoula CX-90 email as built: CX-90 body, with a subject line that wasn't. */
async function missoula(subject: string, preview: string): Promise<DraftArtifact> {
  const base = await draft(
    (t) => {
      // The real email carried no disclaimer block.
      t.blocks = t.blocks.filter((b) => b.id !== 'disclaimer');
      blockById(t, 'headline').props.text = 'New 2026 MAZDA CX-90';
      blockById(t, 'body').props.text = CX90_OFFER;
      blockById(t, 'hero').props.alt = 'The new 2026 Mazda CX-90';
      blockById(t, 'cta-shop').props.text = 'Shop the CX-90';
    },
    {
      subjects: [
        { kind: 'initial', text: subject },
        { kind: 'urgent', text: `Last chance: ${subject}` },
      ],
      previews: [
        { kind: 'initial', text: preview },
        { kind: 'urgent', text: `Ending soon: ${preview}` },
      ],
      disclaimer: null,
      facts: [{ label: 'extraction.offer', text: CX90_OFFER }],
    },
  );
  return asAccount(base, MISSOULA);
}

describe('claims.supported — the Young Mazda of Missoula incident (2026-09)', () => {
  // The CX-90 offer went to 1,067 people under a Jeep Gladiator subject and
  // preview, copied from another store's blast. This is the check that stops it.
  it('blocks the subject and preview that went out', async () => {
    const a = await missoula(
      '$10,000 off the new Jeep Gladiator Mojave X',
      '$10,000 off MSRP ($65,515) on the new 2026 Jeep Gladiator Mojave X.',
    );
    const findings = claimsRule.check(a);
    const messages = findings.map((f) => f.message);

    expect(messages).toContain('subject 1 (initial) says "$10,000", which isn\'t in the creative or the request.');
    expect(messages).toContain('preview 1 (initial) says "$65,515", which isn\'t in the creative or the request.');
    expect(messages.filter((m) => m.includes('names Jeep'))).toHaveLength(4);
    expect(findings.every((f) => f.severity === 'error')).toBe(true);
    // The body was right all along.
    expect(findings.some((f) => f.where?.startsWith('block:'))).toBe(false);
    expect(evaluateDraft(a).blocked).toBe(true);
  });

  it('passes the email as it should have gone out', async () => {
    const a = await missoula(
      '1.9% APR for 72 months on the new 2026 Mazda CX-90',
      'Finance the 2026 Mazda CX-90 at 1.9% APR for 72 months at Young Mazda of Missoula.',
    );
    expect(claimsRule.check(a)).toEqual([]);
  });
});

describe('claims.supported', () => {
  it('rejects an invented rate, even a zero', async () => {
    const a = await draft((t) => {
      blockById(t, 'body').props.text = 'Get 0% APR on a new 2026 Chevy Equinox ACTIV.';
    });
    expect(claimsRule.check(a).map((f) => f.message)).toEqual([
      'block:body says "0%", which isn\'t in the creative or the request.',
    ]);
  });

  it('does not let a percent vouch for a dollar amount', async () => {
    const a = await draft(undefined, {
      subjects: [
        { kind: 'initial', text: 'Take $10 off' },
        { kind: 'urgent', text: 'Last chance: $3,500 off' },
      ],
      facts: [
        { label: 'extraction.offer', text: '10% off, $3,500 off MSRP, 2026, ends 10/31/2026, Chevrolet' },
      ],
    });
    expect(claimsRule.check(a).map((f) => f.excerpt)).toEqual(['Take $10 off']);
  });

  it('matches a date however it is written, and rejects one that moved', async () => {
    const ok = await draft((t) => {
      blockById(t, 'body').props.text = 'The 2026 Equinox ACTIV offer ends October 31st, 2026.';
    });
    expect(claimsRule.check(ok)).toEqual([]);

    const moved = await draft((t) => {
      blockById(t, 'body').props.text = 'The 2026 Equinox ACTIV offer ends Oct 30.';
    });
    expect(claimsRule.check(moved).map((f) => f.message)).toEqual([
      'block:body says "Oct 30", which isn\'t in the creative or the request.',
    ]);
  });

  it('lets a conquest email name a competitor the request names', async () => {
    const copy = 'Trade in your Toyota for $3,500 off a 2026 Chevy Equinox ACTIV.';
    const without = await draft((t) => {
      blockById(t, 'body').props.text = copy;
    });
    expect(claimsRule.check(without).map((f) => f.message)).toEqual([
      "block:body names Toyota. Young Chevrolet doesn't sell it, and neither the creative nor the request mentions it.",
    ]);

    const conquest = { ...without, facts: [...without.facts, { label: 'request.details', text: 'Conquest: Toyota owners within 30 miles' }] };
    expect(claimsRule.check(conquest)).toEqual([]);
  });

  it('leaves the footer and the verbatim disclaimer to their own rules', async () => {
    const a = await draft((t) => {
      blockById(t, 'footer-text').props.text = 'YoungChev.com · 645 N Main St, Layton UT 84041 · (801) 555-0134';
    });
    // $36,995 appears only in the disclaimer, and the footer carries an address.
    expect(claimsRule.check(a)).toEqual([]);
  });

  it('ignores ordinary words that happen to spell a brand', async () => {
    // Lowercase only: a capitalized "Ford" opening a sentence does read as the brand.
    const a = await draft((t) => {
      blockById(t, 'body').props.text = 'Take $3,500 off a 2026 Chevy Equinox ACTIV, built to ford a river and ram through winter.';
    });
    expect(claimsRule.check(a)).toEqual([]);
  });
});
