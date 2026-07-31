import { describe, it, expect } from 'vitest';
import type { TemplateDoc } from './doc-types';
import type { CoopRulePack } from './coop-rules';
import { RULE_SCOPE, splitCoopPack, ruleScope } from './coop-rules';
import {
  checkTemplateCoop,
  representativeData,
  summarizeTemplateCoop,
  supportedOfferTypes,
  templateDocShape,
} from './coop-template-check';

/** A minimal two-size doc with a logo, a disclaimer and an APR-only badge. */
function doc(over: Partial<TemplateDoc> = {}): TemplateDoc {
  return {
    id: 't1',
    name: 'Test',
    sizes: [
      { id: 'square', width: 1080, height: 1080 },
      { id: 'story', width: 1080, height: 1920 },
    ],
    elements: [
      { id: 'logo', type: 'image', binding: { kind: 'brand', key: 'logoUrl' } },
      { id: 'disc', type: 'text', binding: { kind: 'field', key: 'disclaimer' } },
      {
        id: 'aprBadge',
        type: 'text',
        binding: { kind: 'field', key: 'aprRate' },
        visibleWhen: { field: 'offerType', in: ['apr'] },
      },
      {
        id: 'payment',
        type: 'text',
        binding: { kind: 'field', key: 'monthlyPayment' },
        visibleWhen: { field: 'offerType', in: ['lease'] },
      },
    ],
    layouts: {
      square: {
        logo: { x: 0.05, y: 0.85, w: 0.2, h: 0.1 },
        disc: { x: 0.05, y: 0.95, w: 0.9, h: 0.04, fontSize: 14 },
        aprBadge: { x: 0.5, y: 0.4, w: 0.2, h: 0.1 },
        payment: { x: 0.5, y: 0.4, w: 0.2, h: 0.1 },
      },
      story: {
        logo: { x: 0.05, y: 0.85, w: 0.2, h: 0.1 },
        disc: { x: 0.05, y: 0.95, w: 0.9, h: 0.02, fontSize: 9 },
        aprBadge: { x: 0.5, y: 0.4, w: 0.2, h: 0.1 },
        payment: { x: 0.5, y: 0.4, w: 0.2, h: 0.1 },
      },
    },
    ...over,
  } as TemplateDoc;
}

function pack(rules: CoopRulePack['rules'], verified = true): CoopRulePack {
  return { make: 'Testmotors', version: '2026-Q3', verified, rules };
}

describe('rule scope', () => {
  it('classifies every rule kind', () => {
    // A new kind with no scope would silently evaluate nowhere.
    for (const kind of Object.keys(RULE_SCOPE)) {
      expect(RULE_SCOPE[kind as keyof typeof RULE_SCOPE]).toMatch(/^(design|content)$/);
    }
  });

  it('puts geometry in design and text in content', () => {
    expect(ruleScope({ id: 'a', kind: 'required_element', field: 'logoUrl', severity: 'error', description: '' })).toBe(
      'design',
    );
    expect(ruleScope({ id: 'b', kind: 'banned_phrase', phrase: 'free', severity: 'error', description: '' })).toBe(
      'content',
    );
  });

  it('splits a pack without losing or duplicating rules', () => {
    const p = pack([
      { id: 'g1', kind: 'required_element', field: 'logoUrl', severity: 'error', description: 'logo' },
      { id: 'c1', kind: 'banned_phrase', phrase: 'clearance', severity: 'error', description: 'no clearance' },
      { id: 'g2', kind: 'min_font_size', field: 'disclaimer', minPx: 10, severity: 'error', description: 'size' },
    ]);
    const { design, content } = splitCoopPack(p);
    expect(design.rules.map((r) => r.id)).toEqual(['g1', 'g2']);
    expect(content.rules.map((r) => r.id)).toEqual(['c1']);
    // Identity and verification must survive the split — a half that lost
    // `verified` would start blocking on an unverified pack.
    expect(design.verified).toBe(true);
    expect(content.make).toBe('Testmotors');
  });
});

describe('supportedOfferTypes', () => {
  it('reads the set a template declares through visibleWhen', () => {
    expect(supportedOfferTypes(doc())).toEqual(['lease', 'apr']);
  });

  it('returns a single agnostic pass when nothing is gated on offer type', () => {
    const d = doc({ elements: [{ id: 'logo', type: 'image', binding: { kind: 'brand', key: 'logoUrl' } }] } as Partial<TemplateDoc>);
    // Four identical passes would just quadruple the findings.
    expect(supportedOfferTypes(d)).toEqual(['any']);
  });
});

describe('checkTemplateCoop', () => {
  it('passes a template that carries the required element', () => {
    const v = checkTemplateCoop(
      doc(),
      pack([{ id: 'logo', kind: 'required_element', field: 'logoUrl', severity: 'error', description: 'Logo required' }]),
    );
    expect(v.ok).toBe(true);
    expect(v.findings).toEqual([]);
    expect(v.ruleCount).toBe(1);
  });

  it('fails a template missing the required element, once per offer type', () => {
    const d = doc({ elements: doc().elements.filter((e) => e.id !== 'logo') } as Partial<TemplateDoc>);
    const v = checkTemplateCoop(
      d,
      pack([{ id: 'logo', kind: 'required_element', field: 'logoUrl', severity: 'error', description: 'Logo required' }]),
    );
    expect(v.ok).toBe(false);
    expect(v.findings.map((f) => f.offerType).sort()).toEqual(['apr', 'lease']);
  });

  it('matches an element bound via a BRAND binding, not just a field binding', () => {
    // The bug this guards: logoUrl/dealerName/brandColor are `brand` bindings, so a
    // field-only match reported "no element bound to logoUrl" on a template with a
    // perfectly good logo — which would have failed every brandmark rule.
    const v = checkTemplateCoop(
      doc(),
      pack([{ id: 'logo', kind: 'required_element', field: 'logoUrl', severity: 'error', description: 'Logo' }]),
    );
    expect(v.findings).toEqual([]);
  });

  it('catches a rule that only bites for ONE offer type', () => {
    // The failure mode a single-pass check would certify as clean: the element is
    // present but hidden for lease.
    const v = checkTemplateCoop(
      doc(),
      pack([{ id: 'apr', kind: 'required_element', field: 'aprRate', severity: 'error', description: 'APR shown' }]),
    );
    expect(v.ok).toBe(false);
    expect(v.findings).toHaveLength(1);
    expect(v.findings[0].offerType).toBe('lease');
    expect(summarizeTemplateCoop(v)).toContain('only lease');
  });

  it('ignores content rules entirely — those are per-ad', () => {
    const v = checkTemplateCoop(
      doc(),
      pack([{ id: 'ban', kind: 'banned_phrase', phrase: 'clearance', severity: 'error', description: 'no clearance' }]),
    );
    expect(v.ruleCount).toBe(0);
    expect(v.findings).toEqual([]);
    expect(summarizeTemplateCoop(v)).toContain('no layout rules');
  });

  it('downgrades findings from an UNVERIFIED pack to warnings', () => {
    const d = doc({ elements: doc().elements.filter((e) => e.id !== 'logo') } as Partial<TemplateDoc>);
    const v = checkTemplateCoop(
      d,
      pack([{ id: 'logo', kind: 'required_element', field: 'logoUrl', severity: 'error', description: 'Logo' }], false),
    );
    // A half-transcribed pack must not be able to block a template.
    expect(v.ok).toBe(true);
    expect(v.errorCount).toBe(0);
    expect(v.warningCount).toBeGreaterThan(0);
  });

  it('flags a per-size font floor only in the size that violates it', () => {
    const v = checkTemplateCoop(
      doc(),
      pack([{ id: 'disc', kind: 'min_font_size', field: 'disclaimer', minPx: 12, severity: 'error', description: 'Disclaimer ≥12px' }]),
    );
    expect(v.ok).toBe(false);
    // story is 9px, square is 14px.
    expect(v.findings.every((f) => f.sizes?.includes('story'))).toBe(true);
    expect(v.findings.some((f) => f.sizes?.includes('square'))).toBe(false);
  });
});

describe('representativeData', () => {
  it('supplies present brand values so a logo rule tests the TEMPLATE', () => {
    // Absent branding would fail a logo rule for a reason that belongs to the
    // sub-account, not the design.
    const d = representativeData('lease');
    expect(d.logoUrl).toBeTruthy();
    expect(d.dealerName).toBeTruthy();
    expect(d.offerType).toBe('lease');
  });

  it('leaves offerType blank for the agnostic pass', () => {
    expect(representativeData('any').offerType).toBe('');
  });
});

describe('templateDocShape', () => {
  it('is stable across element reordering', () => {
    const a = doc();
    const b = doc({ elements: [...doc().elements].reverse() } as Partial<TemplateDoc>);
    // Order is a z-index and no co-op rule reads it, so a reorder must not read as
    // a change and force a needless re-check.
    expect(templateDocShape(a)).toBe(templateDocShape(b));
  });

  it('changes when a placement moves', () => {
    const moved = doc();
    moved.layouts!.square.logo = { x: 0.5, y: 0.5, w: 0.2, h: 0.1 };
    expect(templateDocShape(moved)).not.toBe(templateDocShape(doc()));
  });

  it('changes when a font size moves', () => {
    const shrunk = doc();
    shrunk.layouts!.square.disc = { ...shrunk.layouts!.square.disc, fontSize: 6 };
    // Font size lives on the layout box, so this is the case a naive
    // element-only hash would miss — and it's exactly what a min_font_size rule
    // reads.
    expect(templateDocShape(shrunk)).not.toBe(templateDocShape(doc()));
  });

  it('changes when a visibility condition moves', () => {
    const d = doc();
    d.elements[2] = { ...d.elements[2], visibleWhen: { field: 'offerType', in: ['apr', 'lease'] } };
    expect(templateDocShape(d)).not.toBe(templateDocShape(doc()));
  });
});
