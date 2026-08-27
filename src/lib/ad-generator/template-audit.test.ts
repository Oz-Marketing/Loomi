import { describe, it, expect } from 'vitest';
import {
  auditPassed,
  auditTemplate,
  elementFieldRefs,
  summarizeAudit,
  surfacedFields,
  disclaimerTargetPx,
  LEGIBILITY_FLOOR_PX,
  type AuditFinding,
} from './template-audit';
import { youngSubaruSingleOffer, youngSubaruDualOffer } from './archetypes/young-subaru-archetype';
import { youngSubaruSingleOfferDoc } from './templates/young-subaru-offers';
import type { TemplateDoc, DocElement } from './doc-types';
import type { OemOfferRule } from './compliance';

/**
 * The audit's whole value is that an error means IMPOSSIBLE, not "probably bad" —
 * so these check both directions: that a real fault is caught, and that a design
 * which is merely unusual is left alone.
 */

const checks = (f: AuditFinding[]) => f.map((x) => x.check);
const errors = (f: AuditFinding[]) => f.filter((x) => x.severity === 'error');

/**
 * The starting points are UNARRANGED BLOCKS, not finished designs, so they are
 * not expected to pass a finished-design audit. What must hold is that nothing is
 * structurally broken — the disclaimer exists, the offer is placed, the dealer is
 * identified — because those are the errors a designer cannot fix by moving boxes.
 *
 * Legibility is deliberately NOT asserted. On the smallest boards a stack of every
 * block leaves the disclaimer around 10px, and the audit says so. That warning is
 * correct and useful: it is what tells the designer this board still needs
 * arranging before it ships.
 */
describe('an archetype starting point is structurally sound', () => {
  for (const [name, doc] of [
    ['single offer', youngSubaruSingleOffer()],
    ['dual offer', youngSubaruDualOffer()],
  ] as const) {
    it(`${name}: nothing blocking`, () => {
      const found = auditTemplate({ doc });
      expect(errors(found).map((f) => `${f.check}: ${f.message}`), name).toEqual([]);
      expect(auditPassed(found)).toBe(true);
    });

    it(`${name}: the disclaimer is placed on every board`, () => {
      const found = auditTemplate({ doc });
      // Present and on every board. Whether it is BIG enough is the designer's to
      // settle once they have arranged it — see the note above this describe.
      expect(checks(found)).not.toContain('disclaimer_absent');
      expect(checks(found)).not.toContain('disclaimer_off_board');
    });
  }
});

describe('the disclaimer', () => {
  const doc = youngSubaruSingleOffer();

  it('is missed when nothing renders it', () => {
    const without: TemplateDoc = {
      ...doc,
      elements: doc.elements.filter((e) => e.role !== 'disclaimer'),
    };
    const found = auditTemplate({ doc: without });
    expect(checks(found)).toContain('disclaimer_absent');
    expect(found.find((f) => f.check === 'disclaimer_absent')!.severity).toBe('error');
    expect(auditPassed(found)).toBe(false);
  });

  it('is caught when it is on some boards but not all', () => {
    const layouts = structuredClone(doc.layouts);
    const id = doc.elements.find((e) => e.role === 'disclaimer')!.id;
    delete layouts.google[id];
    const found = auditTemplate({ doc: { ...doc, layouts } });
    const f = found.find((x) => x.check === 'disclaimer_off_board')!;
    expect(f.severity).toBe('error');
    expect(f.sizes).toEqual(['google']);
  });

  it('is caught when hidden on a board, same as absent from it', () => {
    const layouts = structuredClone(doc.layouts);
    const id = doc.elements.find((e) => e.role === 'disclaimer')!.id;
    layouts.google[id] = { ...layouts.google[id], hidden: true };
    expect(checks(auditTemplate({ doc: { ...doc, layouts } }))).toContain('disclaimer_off_board');
  });

  it('is an ERROR when the box cannot hold a readable line at all', () => {
    const layouts = structuredClone(doc.layouts);
    const id = doc.elements.find((e) => e.role === 'disclaimer')!.id;
    // 2% of a 250px board is 5px — under the floor, and provably so.
    layouts.google[id] = { ...layouts.google[id], h: 0.02 };
    const found = auditTemplate({ doc: { ...doc, layouts } });
    const f = found.find((x) => x.check === 'disclaimer_illegible' && x.severity === 'error')!;
    expect(f.sizes).toEqual(['google']);
    expect(f.message).toContain(`${LEGIBILITY_FLOOR_PX}px`);
  });

  it('is a WARNING between the floor and what the board can carry', () => {
    const layouts = structuredClone(doc.layouts);
    const id = doc.elements.find((e) => e.role === 'disclaimer')!.id;
    // 12px on a 1200x628 board, where 14px fits: readable, but under par.
    layouts.fb[id] = { ...layouts.fb[id], fontSize: 12 };
    const found = auditTemplate({ doc: { ...doc, layouts } });
    const f = found.find((x) => x.check === 'disclaimer_illegible')!;
    expect(f.severity).toBe('warning');
    // The measurement rides per board, not in the sentence — a fault on seventeen
    // boards has seventeen numbers and only one thing wrong with it.
    expect(f.sizeDetail?.fb).toBe('12px where 14px fits');
  });

  it('scales what it asks for to the board, rather than one flat number', () => {
    // A flat 22px is a comfortable legal line on a 1080 square and a tenth of a
    // 300x250. Both of these are the same rule.
    expect(disclaimerTargetPx({ width: 300, height: 250 })).toBe(11);
    expect(disclaimerTargetPx({ width: 1200, height: 628 })).toBe(14);
    // CEILING 16px, and it binds well before billboard sizes: legal text is fine
    // print by definition, and a 24px disclaimer on a 1080 square competed with
    // the offer terms above it. The floor still rises with the board — only the
    // top end is capped.
    expect(disclaimerTargetPx({ width: 1080, height: 1080 })).toBe(16);
    expect(disclaimerTargetPx({ width: 4000, height: 4000 })).toBe(16);
  });

  it('trusts a declared font size over the box it sits in', () => {
    const layouts = structuredClone(doc.layouts);
    const id = doc.elements.find((e) => e.role === 'disclaimer')!.id;
    // A roomy box, but the design pins the type at 6px.
    layouts.fb[id] = { ...layouts.fb[id], h: 0.3, fontSize: 6 };
    const found = auditTemplate({ doc: { ...doc, layouts } });
    const f = found.find((x) => x.check === 'disclaimer_illegible' && x.sizes.includes('fb'))!;
    expect(f.severity).toBe('error');
    expect(f.sizeDetail?.fb).toBe('6px');
  });

  it('takes the roomiest of two disclaimer layers, not the first', () => {
    const src = doc.elements.find((e) => e.role === 'disclaimer')!;
    const cramped: DocElement = { ...src, id: 'disclaimer-2' };
    const layouts = structuredClone(doc.layouts);
    for (const sizeId of Object.keys(layouts)) {
      layouts[sizeId]['disclaimer-2'] = { ...layouts[sizeId][src.id], h: 0.01 };
    }
    const found = auditTemplate({
      doc: { ...doc, elements: [...doc.elements, cramped], layouts },
    });
    // The real one is fine, so the cramped duplicate must not raise an error.
    expect(errors(found).filter((f) => f.check === 'disclaimer_illegible')).toEqual([]);
  });
});

describe('required offer figures have to be somewhere in the design', () => {
  const doc = youngSubaruSingleOffer();

  it('passes a design whose plate carries every type', () => {
    expect(checks(auditTemplate({ doc }))).not.toContain('required_field_unplaced');
  });

  it('names the offer type and the field when a figure has nowhere to go', () => {
    // A design with no offer plate and no offer bindings at all.
    const bare: TemplateDoc = {
      ...doc,
      elements: doc.elements.filter((e) => e.role !== 'offer' && e.role !== 'disclaimer'),
    };
    const found = auditTemplate({ doc: bare });
    const f = found.filter((x) => x.check === 'required_field_unplaced');
    expect(f.length).toBeGreaterThan(0);
    const lease = f.find((x) => x.offerTypes.includes('lease'))!;
    expect(lease.severity).toBe('error');
    expect(lease.message).toMatch(/^A lease ad off this template never shows /);
  });

  it("counts the make's extra required fields, not only the type's own", () => {
    const rule: OemOfferRule = { make: 'Subaru', requiredFields: { lease: ['stockNumber'] } };
    // WITH the disclaimer the gap is closed by design: an OEM disclaimer composes
    // the fine-print fields, which is the rule the builder's own chip follows.
    expect(
      auditTemplate({ doc, oemRule: rule }).some(
        (x) => x.check === 'required_field_unplaced' && x.offerTypes.includes('lease'),
      ),
    ).toBe(false);

    // Without it, a Subaru lease ad off this template never states the stock
    // number the make requires — and that is the finding.
    const noDisclaimer: TemplateDoc = {
      ...doc,
      elements: doc.elements.filter((e) => e.role !== 'disclaimer'),
    };
    const f = auditTemplate({ doc: noDisclaimer, oemRule: rule }).find(
      (x) => x.check === 'required_field_unplaced' && x.offerTypes.includes('lease'),
    )!;
    expect(f.message).toContain('Stock');
  });

  it('counts the disclaimer as disclosing the fine print, but never the headline', () => {
    const surfaced = surfacedFields(doc, 'lease', ['monthlyPayment', 'dueAtSigning', 'leaseTerm']);
    // The plate shows the payment; the disclaimer covers the rest.
    expect(surfaced.has('dueAtSigning')).toBe(true);
    expect(surfaced.has('monthlyPayment')).toBe(true);

    // With the plate gone, the disclaimer still cannot stand in for the headline.
    // The archetype's plate is three text rows bound to the computed tokens, so
    // the offer is removed by ROLE — filtering on `type === 'offer'` would leave
    // `_offerMain` in place and quietly prove nothing.
    const noPlate: TemplateDoc = { ...doc, elements: doc.elements.filter((e) => e.role !== 'offer') };
    const s2 = surfacedFields(noPlate, 'lease', ['monthlyPayment', 'dueAtSigning']);
    expect(s2.has('dueAtSigning')).toBe(true);
    expect(s2.has('monthlyPayment')).toBe(false);
  });

  it('respects Show For — a layer gated to APR does not surface a lease field', () => {
    const gated: TemplateDoc = {
      ...doc,
      elements: [
        ...doc.elements.filter((e) => e.role !== 'offer' && e.role !== 'disclaimer'),
        {
          id: 'apr-only',
          type: 'text',
          binding: { kind: 'field', key: 'monthlyPayment' },
          visibleWhen: { field: 'offerType', in: ['apr'] },
        } as DocElement,
      ],
    };
    expect(surfacedFields(gated, 'lease', ['monthlyPayment']).has('monthlyPayment')).toBe(false);
    expect(surfacedFields(gated, 'apr', ['monthlyPayment']).has('monthlyPayment')).toBe(true);
  });
});

describe('the prose reads like English', () => {
  const doc = youngSubaruSingleOffer();
  const bare: TemplateDoc = {
    ...doc,
    elements: doc.elements.filter((e) => e.role !== 'offer' && e.role !== 'disclaimer'),
  };
  const messages = auditTemplate({ doc: bare })
    .filter((f) => f.check === 'required_field_unplaced')
    .map((f) => f.message);

  it('gets the article right for a type that starts with a vowel sound', () => {
    // "A APR ad" is what the first draft said.
    expect(messages.some((m) => m.startsWith('An APR ad'))).toBe(true);
    expect(messages.some((m) => m.startsWith('A APR'))).toBe(false);
  });

  it('lowercases a type name mid-sentence, but leaves an acronym alone', () => {
    expect(messages.some((m) => m.startsWith('A lease ad'))).toBe(true);
    expect(messages.some((m) => m.startsWith('A sale price ad'))).toBe(true);
    expect(messages.some((m) => m.includes('APR ad'))).toBe(true);
  });
});

describe('dealer identification', () => {
  it('is satisfied by the logo', () => {
    expect(checks(auditTemplate({ doc: youngSubaruSingleOffer() }))).not.toContain('dealer_unidentified');
  });

  it('is a warning, not a block, when nothing identifies the store', () => {
    const doc = youngSubaruSingleOffer();
    const anonymous: TemplateDoc = {
      ...doc,
      elements: doc.elements.filter((e) => !elementFieldRefs(e).some((k) => k === 'logoUrl' || k === 'dealerName')),
    };
    const found = auditTemplate({ doc: anonymous });
    const f = found.find((x) => x.check === 'dealer_unidentified')!;
    expect(f.severity).toBe('warning');
  });
});

describe('geometry', () => {
  const doc = youngSubaruSingleOffer();

  it('leaves a bleeding backdrop alone', () => {
    // The archetype's backdrop deliberately hangs off the board.
    expect(checks(auditTemplate({ doc }))).not.toContain('element_off_board');
  });

  it('reports a layer pushed well off the edge', () => {
    const layouts = structuredClone(doc.layouts);
    const id = doc.elements.find((e) => e.role === 'offer')!.id;
    layouts.fb[id] = { ...layouts.fb[id], x: 0.9 };
    const found = auditTemplate({ doc: { ...doc, layouts } });
    const f = found.find((x) => x.check === 'element_off_board')!;
    expect(f.sizes).toEqual(['fb']);
    expect(f.severity).toBe('warning');
  });

  it('ignores a hair of overhang, which is rounding not a fault', () => {
    const layouts = structuredClone(doc.layouts);
    const id = doc.elements.find((e) => e.role === 'offer')!.id;
    const box = layouts.fb[id];
    layouts.fb[id] = { ...box, x: 1 - box.w + box.w * 0.05 };
    expect(checks(auditTemplate({ doc: { ...doc, layouts } }))).not.toContain('element_off_board');
  });

  it('reports any text layer with no room for a line, not just the disclaimer', () => {
    const layouts = structuredClone(doc.layouts);
    const id = doc.elements.find((e) => e.role === 'vehicleName')!.id;
    layouts.fb[id] = { ...layouts.fb[id], h: 0.01 };
    const found = auditTemplate({ doc: { ...doc, layouts } });
    const f = found.find((x) => x.check === 'text_illegible')!;
    expect(f.severity).toBe('error');
    expect(f.sizes).toEqual(['fb']);
    expect(f.elementId).toBe(id);
  });

  it('says nothing about an image with a short box — only text has to be read', () => {
    const layouts = structuredClone(doc.layouts);
    const id = doc.elements.find((e) => e.type === 'image' || e.type === 'logo')?.id;
    if (!id) return;
    layouts.fb[id] = { ...layouts.fb[id], h: 0.005 };
    expect(checks(auditTemplate({ doc: { ...doc, layouts } }))).not.toContain('text_illegible');
  });

  it('audits only the boards it was asked about', () => {
    const layouts = structuredClone(doc.layouts);
    const id = doc.elements.find((e) => e.role === 'vehicleName')!.id;
    layouts.fb[id] = { ...layouts.fb[id], h: 0.01 };
    const found = auditTemplate({ doc: { ...doc, layouts }, sizeIds: ['google'] });
    expect(checks(found)).not.toContain('text_illegible');
  });
});

/**
 * A fault is a property of the DESIGN, so it gets ONE line however many boards it
 * lands on. This is the check that a twenty-two-board template cannot report the
 * same three faults thirty-five times — which is what it did, and what made the
 * blocking list unreadable at exactly the moment it mattered most.
 */
describe('a fault that lands on every board is stated once', () => {
  const doc = youngSubaruSingleOffer();

  it('collapses an illegible disclaimer into one finding carrying every board', () => {
    const layouts = structuredClone(doc.layouts);
    const id = doc.elements.find((e) => e.role === 'disclaimer')!.id;
    // Pinned at 6px everywhere: one fault, five boards, one fix.
    for (const sizeId of Object.keys(layouts)) {
      layouts[sizeId][id] = { ...layouts[sizeId][id], fontSize: 6 };
    }
    const found = auditTemplate({ doc: { ...doc, layouts } });
    const illegible = found.filter((f) => f.check === 'disclaimer_illegible');
    expect(illegible).toHaveLength(1);
    expect(illegible[0].sizes.sort()).toEqual(doc.sizes.map((s) => s.id).sort());
    // The count is in the sentence; the boards and their numbers are alongside it.
    expect(illegible[0].message).toContain(`${doc.sizes.length} boards`);
    expect(illegible[0].sizeDetail?.google).toBe('6px');
  });

  it('keeps the two causes apart, because they are two different fixes', () => {
    const layouts = structuredClone(doc.layouts);
    const id = doc.elements.find((e) => e.role === 'disclaimer')!.id;
    // Pinned too small on one board; given no height on another.
    layouts.fb[id] = { ...layouts.fb[id], fontSize: 6 };
    layouts.google[id] = { ...layouts.google[id], h: 0.02 };
    const illegible = auditTemplate({ doc: { ...doc, layouts } }).filter(
      (f) => f.check === 'disclaimer_illegible' && f.severity === 'error',
    );
    expect(illegible).toHaveLength(2);
    expect(illegible.flatMap((f) => f.sizes).sort()).toEqual(['fb', 'google']);
    // One says raise the type, the other says give it room — never merged.
    expect(new Set(illegible.map((f) => f.fix)).size).toBe(2);
  });

  it('collapses a layer that hangs off every board, per layer', () => {
    const layouts = structuredClone(doc.layouts);
    const offer = doc.elements.find((e) => e.role === 'offer')!.id;
    const name = doc.elements.find((e) => e.role === 'vehicleName')!.id;
    for (const sizeId of Object.keys(layouts)) {
      layouts[sizeId][offer] = { ...layouts[sizeId][offer], x: 0.9 };
      layouts[sizeId][name] = { ...layouts[sizeId][name], x: 0.9 };
    }
    const off = auditTemplate({ doc: { ...doc, layouts } }).filter(
      (f) => f.check === 'element_off_board',
    );
    // Two layers, five boards each: two findings, not ten.
    expect(off).toHaveLength(2);
    expect(new Set(off.map((f) => f.elementId))).toEqual(new Set([offer, name]));
    for (const f of off) expect(f.sizes).toHaveLength(doc.sizes.length);
  });

  it('collapses illegible text per layer, with the measurement per board', () => {
    const layouts = structuredClone(doc.layouts);
    const id = doc.elements.find((e) => e.role === 'vehicleName')!.id;
    layouts.fb[id] = { ...layouts.fb[id], h: 0.01 };
    layouts.google[id] = { ...layouts.google[id], h: 0.01 };
    const text = auditTemplate({ doc: { ...doc, layouts } }).filter(
      (f) => f.check === 'text_illegible',
    );
    expect(text).toHaveLength(1);
    expect(text[0].sizes.sort()).toEqual(['fb', 'google']);
    // 1% of 628 is 6px, of 250 is 3px — same fault, different distance to move.
    expect(text[0].sizeDetail?.fb).toBe('6px');
    expect(text[0].sizeDetail?.google).toBe('3px');
  });
});

describe('it runs on the hand-built templates too', () => {
  it('audits the hand-built Young Subaru doc without throwing', () => {
    const found = auditTemplate({ doc: youngSubaruSingleOfferDoc });
    expect(Array.isArray(found)).toBe(true);
    // Whatever it finds, every finding has to be actionable prose.
    for (const f of found) {
      expect(f.message.length, f.check).toBeGreaterThan(10);
      expect(f.severity === 'error' || f.severity === 'warning').toBe(true);
    }
  });
});

describe('the summary reads like a chip', () => {
  it('says nothing was found', () => {
    expect(summarizeAudit([])).toBe('no design faults');
  });

  it('counts blocking and non-blocking separately', () => {
    const f: AuditFinding[] = [
      { check: 'disclaimer_absent', severity: 'error', message: 'x', sizes: [], offerTypes: [] },
      { check: 'dealer_unidentified', severity: 'warning', message: 'y', sizes: [], offerTypes: [] },
      { check: 'dealer_unidentified', severity: 'warning', message: 'z', sizes: [], offerTypes: [] },
    ];
    expect(summarizeAudit(f)).toBe('1 blocking, 2 to look at');
  });
});
