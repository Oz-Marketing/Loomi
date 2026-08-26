import { describe, it, expect } from 'vitest';
import {
  buildCitation,
  knownAdDataKeys,
  knownOfferTypes,
  screenRuleProposals,
  summarizeDrops,
  type RuleProposal,
} from './coop-draft';

const QUOTE =
  'The dealer must clearly identify itself using its full dealership name in all media types.';
const PAGES = ['cover', `Section 5e. ${QUOTE} Further text follows.`, 'appendix'];

function proposal(over: Partial<RuleProposal> = {}, rule: Record<string, unknown> = {}): RuleProposal {
  return {
    page: 2,
    quote: QUOTE,
    section: '5e',
    rule: {
      kind: 'required_element',
      severity: 'error',
      description: 'The dealer name must appear on the ad.',
      field: 'dealerName',
      ...rule,
    } as RuleProposal['rule'],
    ...over,
  };
}

const OPTS = { source: 'Mazda MCAP Interactive Guidelines, Aug 2025', make: 'Mazda' };

describe('knownAdDataKeys', () => {
  it('is derived, and covers what the hand-written packs actually reference', () => {
    const keys = knownAdDataKeys();
    // Template/system fields.
    expect(keys.has('msrp')).toBe(true);
    expect(keys.has('disclaimer')).toBe(true);
    // Per-account branding — not a template field, but present on a real ad.
    expect(keys.has('logoUrl')).toBe(true);
    expect(keys.has('dealerName')).toBe(true);
    // Synthetic offer-engine values, including the second-offer variants.
    expect(keys.has('_offerLabel')).toBe(true);
    expect(keys.has('_offerTerms')).toBe(true);
    expect(keys.has('_o2_offerTerms')).toBe(true);
  });

  it('does not admit a plausible-but-wrong key', () => {
    // `logoUrl` is the real key; this is the mistake the check exists to catch.
    expect(knownAdDataKeys().has('brandLogo')).toBe(false);
  });
});

describe('knownOfferTypes', () => {
  it('spans both kinds', () => {
    const t = knownOfferTypes();
    expect(t.has('lease')).toBe(true);
    expect(t.has('flat_price')).toBe(true);
    expect(t.has('nonsense')).toBe(false);
  });
});

describe('buildCitation', () => {
  it('mirrors the format the hand-written packs use', () => {
    expect(buildCitation('Mazda MCAP, Aug 2025', '5e', 13)).toBe(
      'Mazda MCAP, Aug 2025 — §5e, p.13',
    );
  });
  it('falls back to the page when no section is printed', () => {
    expect(buildCitation('Doc', undefined, 4)).toBe('Doc — p.4');
  });
});

describe('screenRuleProposals', () => {
  it('accepts a well-formed proposal and cites the verified page', () => {
    const r = screenRuleProposals([proposal()], PAGES, OPTS);
    expect(r.dropped).toEqual([]);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].origin).toBe('ai');
    expect(r.accepted[0].rule.citation).toBe(
      'Mazda MCAP Interactive Guidelines, Aug 2025 — §5e, p.2',
    );
    expect(r.accepted[0].source.page).toBe(2);
    expect(r.accepted[0].source.pageCorrected).toBe(false);
  });

  it('gives the rule an id when the drafter omits one', () => {
    const r = screenRuleProposals([proposal({}, { id: '' })], PAGES, OPTS);
    expect(r.accepted[0].rule.id).toBeTruthy();
  });

  it('does not let two proposals collide on one id', () => {
    const r = screenRuleProposals([proposal({}, { id: '' }), proposal({}, { id: '' })], PAGES, OPTS);
    expect(r.accepted).toHaveLength(2);
    expect(r.accepted[0].rule.id).not.toBe(r.accepted[1].rule.id);
  });

  it('respects ids already in the pack', () => {
    const taken = ['mazda-the-dealer-name-must-appear-on-the-ad'];
    const r = screenRuleProposals([proposal({}, { id: '' })], PAGES, {
      ...OPTS,
      takenIds: taken,
    });
    expect(taken).not.toContain(r.accepted[0].rule.id);
  });

  // ── the load-bearing check ──
  it('discards a proposal whose quote is not in the document', () => {
    const r = screenRuleProposals(
      [proposal({ quote: 'All advertising must carry a disclaimer of at least eight points.' })],
      PAGES,
      OPTS,
    );
    expect(r.accepted).toEqual([]);
    expect(r.dropped[0].reason).toBe('quote_not_found');
  });

  it('accepts a real quote on the wrong page, and flags the correction', () => {
    const r = screenRuleProposals([proposal({ page: 1 })], PAGES, OPTS);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].source.pageCorrected).toBe(true);
    // The citation must name where it REALLY is, not where the drafter said.
    expect(r.accepted[0].rule.citation).toContain('p.2');
  });

  // ── field existence: the reason this module is more than validateRule ──
  it('discards a structurally valid rule against a field that does not exist', () => {
    const r = screenRuleProposals([proposal({}, { field: 'brandLogo' })], PAGES, OPTS);
    expect(r.accepted).toEqual([]);
    expect(r.dropped[0].reason).toBe('unknown_field');
    expect(r.dropped[0].detail).toContain('brandLogo');
  });

  it('checks every field of a banned_phrase rule', () => {
    const r = screenRuleProposals(
      [proposal({}, { kind: 'banned_phrase', field: undefined, fields: ['headline', 'nope'], phrase: 'free' })],
      PAGES,
      OPTS,
    );
    expect(r.dropped[0].reason).toBe('unknown_field');
  });

  it('checks the fields inside a numeric limit', () => {
    const r = screenRuleProposals(
      [
        proposal({}, {
          kind: 'numeric_limit',
          field: 'salePrice',
          bound: 'min',
          limits: [[{ field: 'dealerInvoiceTotal' }, { field: 'imaginaryAllowance', op: 'subtract' }]],
        }),
      ],
      PAGES,
      OPTS,
    );
    expect(r.dropped[0].reason).toBe('unknown_field');
    expect(r.dropped[0].detail).toContain('imaginaryAllowance');
  });

  it('rejects an unknown rule kind rather than passing it half-checked', () => {
    const r = screenRuleProposals([proposal({}, { kind: 'vibes' })], PAGES, OPTS);
    expect(r.dropped[0].reason).toBe('unknown_kind');
  });

  it('rejects an invalid severity', () => {
    const r = screenRuleProposals([proposal({}, { severity: 'critical' })], PAGES, OPTS);
    expect(r.dropped[0].reason).toBe('invalid_severity');
  });

  it('rejects an unknown offer type', () => {
    const r = screenRuleProposals([proposal({}, { offerTypes: ['lease', 'balloon'] })], PAGES, OPTS);
    expect(r.dropped[0].reason).toBe('unknown_offer_type');
  });

  it('defers to validateRule for a rule missing its own required parts', () => {
    // min_font_size with neither a px floor nor a fraction.
    const r = screenRuleProposals(
      [proposal({}, { kind: 'min_font_size', field: 'disclaimer' })],
      PAGES,
      OPTS,
    );
    expect(r.dropped[0].reason).toBe('invalid_rule');
  });

  it('reports a tally so a bad run is visible at a glance', () => {
    const r = screenRuleProposals(
      [proposal({ quote: 'not in the document at all, definitely not present' }), proposal({}, { kind: 'vibes' })],
      PAGES,
      OPTS,
    );
    expect(summarizeDrops(r.dropped)).toEqual({ quote_not_found: 1, unknown_kind: 1 });
  });
});

describe('unexpressible notes', () => {
  const note = {
    page: 2,
    quote: QUOTE,
    section: '7b',
    requirement: 'The price may not exceed the height of the vehicle.',
    why: 'Compares two elements; the engine has no cross-element comparison.',
  };

  it('keeps a note whose quote checks out', () => {
    const r = screenRuleProposals([], PAGES, OPTS, [note]);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0].at.page).toBe(2);
    expect(r.droppedNotes).toEqual([]);
  });

  it('holds a note to the same evidence standard as a rule', () => {
    const r = screenRuleProposals([], PAGES, OPTS, [
      { ...note, quote: 'a requirement that appears nowhere in this document' },
    ]);
    expect(r.notes).toEqual([]);
    expect(r.droppedNotes[0].reason).toBe('quote_not_found');
  });
});

describe('screenRuleProposals — list entries', () => {
  const LEAD = 'The following terms and phrases may not be used in any Mazda advertising:';
  const PAGES2 = ['cover', `${LEAD} Clearance. Blowout. Employee Pricing.`];

  function listProposal(term: string, phrase: string): RuleProposal {
    return {
      page: 2,
      quote: term,
      context: LEAD,
      section: '8a',
      rule: {
        kind: 'banned_phrase',
        severity: 'error',
        description: `Do not use "${phrase}" anywhere in the ad.`,
        phrase,
      } as RuleProposal['rule'],
    };
  }

  it('accepts a banned term backed by its list context', () => {
    const r = screenRuleProposals([listProposal('Clearance', 'Clearance')], PAGES2, OPTS);
    expect(r.dropped).toEqual([]);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].source.matchType).toBe('list_item');
  });

  it('drops a term with no context quote', () => {
    const p = listProposal('Clearance', 'Clearance');
    delete p.context;
    const r = screenRuleProposals([p], PAGES2, OPTS);
    expect(r.dropped[0].reason).toBe('quote_too_short');
  });

  it('drops a term whose context quote is invented', () => {
    const p = { ...listProposal('Clearance', 'Clearance'), context: 'Words we do not permit are listed here below.' };
    const r = screenRuleProposals([p], PAGES2, OPTS);
    expect(r.dropped[0].reason).toBe('quote_context_missing');
  });

  // The hazard when working down a forty-term list.
  it('drops a rule that bans one term while quoting a different one', () => {
    const r = screenRuleProposals([listProposal('Clearance', 'Employee Pricing')], PAGES2, OPTS);
    expect(r.accepted).toEqual([]);
    expect(r.dropped[0].reason).toBe('evidence_mismatch');
    expect(r.dropped[0].detail).toContain('Employee Pricing');
  });

  it('allows the phrase and the quoted term to differ only in punctuation or case', () => {
    const r = screenRuleProposals([listProposal('“Employee Pricing”', 'employee pricing')], PAGES2, OPTS);
    expect(r.accepted).toHaveLength(1);
  });

  // Real GM case: one bullet covers two forbidden descriptions, and a rule about
  // either is properly supported by it. Substring matching rejected this and cost a
  // correct rule on a live run.
  it('accepts a rule drawn from a COMBINED list entry', () => {
    const combined = `${LEAD} » “The GM store/outlet”. Blowout.`;
    const pages = ['cover', combined];
    const r = screenRuleProposals(
      [
        {
          page: 2,
          quote: '» “The GM store/outlet”',
          context: LEAD,
          rule: {
            kind: 'banned_phrase',
            severity: 'error',
            description: 'Do not describe the dealership as "GM outlet".',
            phrase: 'GM outlet',
          } as never,
        },
      ],
      pages,
      OPTS,
    );
    expect(r.dropped).toEqual([]);
    expect(r.accepted).toHaveLength(1);
  });

  it('still refuses a phrase sharing no words with the quoted entry', () => {
    const r = screenRuleProposals([listProposal('Clearance', 'Employee Pricing')], PAGES2, OPTS);
    expect(r.dropped[0].reason).toBe('evidence_mismatch');
  });
});
