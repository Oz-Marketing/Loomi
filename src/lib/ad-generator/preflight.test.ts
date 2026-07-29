import { describe, it, expect } from 'vitest';
import {
  looksLikePlaceholder,
  preflight,
  summarizePreflight,
  PLACEHOLDER_GUARDED_KEYS,
} from './preflight';
import type { TemplateDoc, DocElement } from './doc-types';
import type { AdData } from './types';

const SQUARE = { id: 'square', label: 'Square', width: 1080, height: 1080 };
const STORY = { id: 'story', label: 'Story', width: 1080, height: 1920 };

/** A doc with the given elements placed in every size (unless overridden). */
function doc(elements: DocElement[], over: Partial<TemplateDoc> = {}): TemplateDoc {
  const sizes = over.sizes ?? [SQUARE];
  const layouts: TemplateDoc['layouts'] = {};
  for (const s of sizes) {
    layouts[s.id] = {};
    for (const el of elements) layouts[s.id][el.id] = { x: 0, y: 0, w: 0.5, h: 0.2 };
  }
  return {
    id: 'tpl',
    name: 'Test template',
    sizes,
    fields: [],
    elements,
    layouts,
    defaults: {},
    ...over,
    ...(over.layouts ? { layouts: over.layouts } : {}),
  };
}

function textEl(id: string, key: string, over: Partial<DocElement> = {}): DocElement {
  return { id, type: 'text', binding: { kind: 'field', key }, ...over };
}

/** A complete, compliant lease ad. */
const LEASE: AdData = {
  offerType: 'lease',
  monthlyPayment: '299',
  leaseTerm: '36',
  dueAtSigning: '2999',
  vehicleName: '2026 Subaru Crosstrek',
  disclaimer: 'Closed-end lease. See dealer.',
};

describe('looksLikePlaceholder', () => {
  it('recognizes the canonical scaffolding values', () => {
    expect(looksLikePlaceholder('X,XXX')).toBe(true);
    expect(looksLikePlaceholder('XX.XX')).toBe(true);
    expect(looksLikePlaceholder('$X,XXX/mo')).toBe(true);
    expect(looksLikePlaceholder('XXX')).toBe(true);
  });

  it('passes real values through', () => {
    expect(looksLikePlaceholder('299')).toBe(false);
    expect(looksLikePlaceholder('$2,999')).toBe(false);
    expect(looksLikePlaceholder('1.9')).toBe(false);
    expect(looksLikePlaceholder('')).toBe(false);
    expect(looksLikePlaceholder(undefined)).toBe(false);
  });

  it('is only safe because callers scope it to numeric keys', () => {
    // "Model X" has no digits and contains an X, so the predicate alone would
    // reject it — which is exactly why preflight checks only guarded keys.
    expect(looksLikePlaceholder('Model X')).toBe(true);
  });
});

describe('PLACEHOLDER_GUARDED_KEYS', () => {
  it('derives the offer-number keys from the canonical defaults', () => {
    expect(PLACEHOLDER_GUARDED_KEYS).toEqual(
      expect.arrayContaining(['monthlyPayment', 'leaseTerm', 'aprRate', 'msrp', 'salePrice']),
    );
  });

  it('does not guard free-text keys', () => {
    expect(PLACEHOLDER_GUARDED_KEYS).not.toContain('vehicleName');
    expect(PLACEHOLDER_GUARDED_KEYS).not.toContain('dealerName');
  });
});

describe('preflight — happy path', () => {
  it('passes a complete lease ad', () => {
    const result = preflight({
      doc: doc([textEl('e1', '_offerMain'), textEl('e2', 'vehicleName'), textEl('e3', 'disclaimer')]),
      data: LEASE,
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(summarizePreflight(result)).toBe('passed');
  });

  it('reports the bound fields it checked', () => {
    const result = preflight({
      doc: doc([textEl('e1', 'vehicleName'), textEl('e2', 'disclaimer')]),
      data: LEASE,
    });
    expect(result.boundFields).toEqual(['disclaimer', 'vehicleName']);
  });

  it('resolves offer fields the renderer derives rather than calling them empty', () => {
    // _offerMain only exists after enrichment; preflight must enrich like render does.
    const result = preflight({ doc: doc([textEl('e1', '_offerMain')]), data: LEASE });
    expect(result.ok).toBe(true);
  });
});

describe('preflight — placeholder leak', () => {
  it('blocks a placeholder that would reach the canvas via a derived field', () => {
    const result = preflight({
      doc: doc([textEl('e1', '_offerMain')]),
      data: { ...LEASE, monthlyPayment: 'XXX' },
    });
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === 'placeholder_value');
    // Reports the BOUND key, because that's what renders — the scaffolding
    // reached the canvas through `_offerMain`, not as `monthlyPayment` directly.
    expect(issue?.field).toBe('_offerMain');
    expect(issue?.message).toContain('XXX');
  });

  it('blocks a placeholder bound directly', () => {
    const result = preflight({
      doc: doc([textEl('e1', '_offerMain'), textEl('e2', 'msrp')]),
      data: { ...LEASE, msrp: 'XX,XXX' },
    });
    expect(result.issues.some((i) => i.code === 'placeholder_value' && i.field === 'msrp')).toBe(true);
  });

  it('ignores placeholders in fields nothing displays', () => {
    // The over-strictness this replaced: a lease ad's data legitimately carries
    // `aprRate: "X.X"` etc. from the template defaults, and nothing renders them.
    // Failing on those refuses every ad from every template using the standard
    // defaults.
    const result = preflight({
      doc: doc([textEl('e1', '_offerMain'), textEl('e2', 'vehicleName')]),
      data: {
        ...LEASE,
        aprRate: 'X.X',
        aprTerm: 'XX',
        costPerThousand: 'XX.XX',
        salePrice: 'XX,XXX',
        discountAmount: 'X,XXX',
        securityDeposit: 'XXX',
      },
    });
    expect(result.issues.filter((i) => i.code === 'placeholder_value')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('ignores a placeholder in an element hidden for this offer type', () => {
    const result = preflight({
      doc: doc([
        textEl('e1', '_offerMain'),
        textEl('e2', 'aprRate', { visibleWhen: { field: 'offerType', in: ['apr'] } }),
      ]),
      data: { ...LEASE, aprRate: 'X.X' },
    });
    expect(result.ok).toBe(true);
  });

  it('does not flag legitimate free text that happens to contain an X', () => {
    const result = preflight({
      doc: doc([textEl('e1', 'vehicleName')]),
      data: { ...LEASE, vehicleName: '2026 Tesla Model X' },
    });
    expect(result.issues.some((i) => i.code === 'placeholder_value')).toBe(false);
  });
});

describe('preflight — OEM compliance', () => {
  it('blocks when the make rule demands a field nobody filled', () => {
    const result = preflight({
      doc: doc([textEl('e1', '_offerMain')]),
      data: LEASE,
      oemRule: { make: 'Subaru', requiredFields: { lease: ['vin', 'securityDeposit'] } },
    });
    expect(result.ok).toBe(false);
    const fields = result.issues.filter((i) => i.code === 'missing_required').map((i) => i.field);
    expect(fields).toEqual(expect.arrayContaining(['vin', 'securityDeposit']));
    expect(result.issues.find((i) => i.field === 'vin')?.message).toContain('Subaru');
  });

  it('passes once the required fields are present', () => {
    const result = preflight({
      doc: doc([textEl('e1', '_offerMain')]),
      data: { ...LEASE, vin: '4S4BTAFC1P3123456' },
      oemRule: { make: 'Subaru', requiredFields: { lease: ['vin'] } },
    });
    expect(result.ok).toBe(true);
  });

  it('applies the baseline even with no OEM rule', () => {
    const result = preflight({
      doc: doc([textEl('e1', '_offerMain')]),
      data: { offerType: 'apr', aprRate: '1.9' }, // aprTerm missing
    });
    expect(result.issues.some((i) => i.code === 'missing_required' && i.field === 'aprTerm')).toBe(true);
  });
});

describe('preflight — empty bindings', () => {
  it('blocks when a visible element has nothing to render', () => {
    const result = preflight({
      doc: doc([textEl('e1', 'tagline')]),
      data: LEASE, // no tagline
    });
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === 'empty_binding');
    expect(issue?.field).toBe('tagline');
    expect(issue?.sizes).toEqual(['square']);
  });

  it('ignores elements hidden in every rendered size', () => {
    const d = doc([textEl('e1', 'tagline')]);
    d.layouts.square.e1.hidden = true;
    const result = preflight({ doc: d, data: LEASE });
    expect(result.ok).toBe(true);
  });

  it('reports only the sizes an element actually appears in', () => {
    const d = doc([textEl('e1', 'tagline')], { sizes: [SQUARE, STORY] });
    d.layouts.story.e1.hidden = true;
    const result = preflight({ doc: d, data: LEASE });
    expect(result.issues.find((i) => i.code === 'empty_binding')?.sizes).toEqual(['square']);
  });

  it('honours visibleWhen so an APR-only element is not demanded of a lease ad', () => {
    const result = preflight({
      doc: doc([textEl('e1', 'costPerThousand', { visibleWhen: { field: 'offerType', in: ['apr'] } })]),
      data: LEASE,
    });
    expect(result.ok).toBe(true);
  });

  it('does demand that element once the offer IS apr', () => {
    const result = preflight({
      doc: doc([textEl('e1', 'costPerThousand', { visibleWhen: { field: 'offerType', in: ['apr'] } })]),
      data: { offerType: 'apr', aprRate: '1.9', aprTerm: '60' },
    });
    expect(result.issues.some((i) => i.code === 'empty_binding' && i.field === 'costPerThousand')).toBe(true);
  });

  it('ignores brand and static bindings, which need no data', () => {
    const result = preflight({
      doc: doc([
        { id: 'e1', type: 'logo', binding: { kind: 'brand', key: 'logoUrl' } },
        { id: 'e2', type: 'text', binding: { kind: 'static', value: 'HURRY IN' } },
        { id: 'e3', type: 'shape' },
      ]),
      data: LEASE,
    });
    expect(result.ok).toBe(true);
    expect(result.boundFields).toEqual([]);
  });

  it('does not double-report a field compliance already flagged', () => {
    const result = preflight({
      doc: doc([textEl('e1', 'vin')]),
      data: LEASE,
      oemRule: { make: 'Subaru', requiredFields: { lease: ['vin'] } },
    });
    const vinIssues = result.issues.filter((i) => i.field === 'vin');
    expect(vinIssues).toHaveLength(1);
    expect(vinIssues[0].code).toBe('missing_required');
  });
});

describe('preflight — degenerate input', () => {
  it('fails a template with no sizes', () => {
    const result = preflight({ doc: doc([], { sizes: [] }), data: LEASE });
    expect(result.ok).toBe(false);
    expect(result.issues[0].code).toBe('no_sizes');
  });

  it('checks only the sizes actually being rendered', () => {
    const d = doc([textEl('e1', 'tagline')], { sizes: [SQUARE, STORY] });
    delete d.layouts.square.e1; // element exists only in story
    const result = preflight({ doc: d, data: LEASE, sizeIds: ['square'] });
    expect(result.ok).toBe(true);
  });
});

describe('preflight — co-op rules', () => {
  const CREDIT_PACK = {
    make: 'Testco',
    version: 'v1',
    verified: true,
    rules: [
      {
        id: 'credit',
        kind: 'required_phrase' as const,
        field: 'disclaimer',
        phrase: 'approved credit',
        severity: 'error' as const,
        description: 'Lease disclaimers must state a credit qualification.',
        citation: 'Testco Co-op §4.2',
      },
    ],
  };

  it('blocks a render when a verified co-op rule is violated', () => {
    const result = preflight({
      doc: doc([textEl('e1', '_offerMain'), textEl('e2', 'disclaimer')]),
      data: { ...LEASE, disclaimer: 'See dealer for details.' },
      coopPack: CREDIT_PACK,
    });
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === 'coop_violation');
    expect(issue?.ruleId).toBe('credit');
    expect(issue?.citation).toBe('Testco Co-op §4.2');
    expect(issue?.message).toContain('Testco co-op');
  });

  it('passes when the requirement is met', () => {
    const result = preflight({
      doc: doc([textEl('e1', '_offerMain'), textEl('e2', 'disclaimer')]),
      data: LEASE, // already contains "with approved credit"? no — check explicitly
      coopPack: CREDIT_PACK,
    });
    // LEASE's disclaimer lacks the phrase, so this must fail — asserting the
    // rule is genuinely load-bearing rather than trivially satisfied.
    expect(result.ok).toBe(false);

    const compliant = preflight({
      doc: doc([textEl('e1', '_offerMain'), textEl('e2', 'disclaimer')]),
      data: { ...LEASE, disclaimer: 'Closed-end lease with approved credit.' },
      coopPack: CREDIT_PACK,
    });
    expect(compliant.ok).toBe(true);
  });

  it('runs no co-op checks when no pack is supplied', () => {
    const result = preflight({
      doc: doc([textEl('e1', '_offerMain'), textEl('e2', 'disclaimer')]),
      data: { ...LEASE, disclaimer: 'See dealer.' },
    });
    expect(result.issues.some((i) => i.code === 'coop_violation')).toBe(false);
    expect(result.ok).toBe(true);
  });

  it('does not block on an unverified pack, but still reports', () => {
    const result = preflight({
      doc: doc([textEl('e1', '_offerMain'), textEl('e2', 'disclaimer')]),
      data: { ...LEASE, disclaimer: 'See dealer.' },
      coopPack: { ...CREDIT_PACK, verified: false },
    });
    expect(result.ok).toBe(true);
    expect(result.issues.find((i) => i.code === 'coop_violation')?.severity).toBe('warning');
  });

  it('reports coherence problems before permission problems', () => {
    // A placeholder payment AND a co-op violation: the fixable-data issue should
    // come first, since that's the order someone would work through them.
    const result = preflight({
      doc: doc([textEl('e1', '_offerMain'), textEl('e2', 'disclaimer')]),
      data: { ...LEASE, monthlyPayment: 'XXX', disclaimer: 'See dealer.' },
      coopPack: CREDIT_PACK,
    });
    const codes = result.issues.map((i) => i.code);
    expect(codes.indexOf('placeholder_value')).toBeLessThan(codes.indexOf('coop_violation'));
  });
});

describe('summarizePreflight', () => {
  it('joins the blocking reasons for a run log', () => {
    const result = preflight({
      doc: doc([textEl('e1', '_offerMain')]),
      data: { ...LEASE, monthlyPayment: 'XXX' },
    });
    expect(summarizePreflight(result)).toContain('placeholder');
  });
});
