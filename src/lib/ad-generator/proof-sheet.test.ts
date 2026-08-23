import { describe, it, expect } from 'vitest';
import { buildProofSheet, proofOfferTypes, proofRowData, proofSheetSummary } from './proof-sheet';
import { youngSubaruSingleOffer } from './archetypes/young-subaru-archetype';
import { youngSubaruSingleOfferDoc } from './templates/young-subaru-offers';
import type { CoopRulePack } from './coop-rules';
import type { TemplateDoc } from './doc-types';

/**
 * The sheet is the pre-publish check, so what these hold it to is: it draws every
 * cell of the grid, each cell is the ad that cell claims to be, and it never
 * reports a clean bill it hasn't earned.
 */

/** Every note's prose, for the assertions that only care what it says. */
const noteText = (sheet: { notes: { text: string }[] }) => sheet.notes.map((n) => n.text).join(' ');

const SAMPLE = {
  brandColor: '#0a3d8f',
  logoUrl: 'https://example.invalid/lockup.png',
  vehicleImageUrl: 'https://example.invalid/outback.png',
  monthlyPayment: '319',
  leaseTerm: '36',
  dueAtSigning: '3499',
  aprRate: '3.9',
  financeTerm: '60',
  discountAmount: '2500',
  salePrice: '28995',
  msrp: '31495',
  expirationDate: '2026-09-30',
};

describe('the grid is complete', () => {
  const doc = youngSubaruSingleOffer();
  const sheet = buildProofSheet({ doc, data: SAMPLE });

  it('draws every offer type the kind offers, except the message-only one', () => {
    expect(sheet.rows.map((r) => r.offerType)).toEqual(['lease', 'apr', 'discount', 'sales_price', 'custom']);
    expect(sheet.rows.some((r) => r.offerType === 'no_offer')).toBe(false);
  });

  it('draws every board for every type', () => {
    expect(sheet.sizes).toHaveLength(doc.sizes.length);
    for (const row of sheet.rows) {
      expect(row.boards.map((b) => b.sizeId), row.offerType).toEqual(doc.sizes.map((s) => s.id));
      for (const b of row.boards) expect(b.html.length, `${row.offerType}/${b.sizeId}`).toBeGreaterThan(500);
    }
  });

  it('carries each board at its real pixel size, for the frame to scale', () => {
    for (const b of sheet.rows[0].boards) {
      const size = doc.sizes.find((s) => s.id === b.sizeId)!;
      expect([b.width, b.height]).toEqual([size.width, size.height]);
      expect(b.label).toBe(size.label);
    }
  });

  it('summarises itself as the grid it is', () => {
    expect(proofSheetSummary(sheet)).toBe('5 offer types × 5 boards — 25 ads');
  });
});

describe('each cell is the ad it claims to be', () => {
  const doc = youngSubaruSingleOffer();
  const sheet = buildProofSheet({ doc, data: SAMPLE, sizeIds: ['fb'] });
  const cell = (type: string) => sheet.rows.find((r) => r.offerType === type)!.boards[0].html;

  it('draws the lease payment on the lease row and not on the others', () => {
    expect(cell('lease')).toContain('$319');
    expect(cell('apr')).not.toContain('$319');
    expect(cell('sales_price')).not.toContain('$319');
  });

  it('draws each type figure with its own symbol', () => {
    expect(cell('apr')).toContain('3.9%');
    expect(cell('discount')).toContain('$2,500');
    expect(cell('sales_price')).toContain('$28,995');
  });

  it('draws each type own label, from one plate', () => {
    expect(cell('lease')).toContain('PER MONTH LEASE');
    expect(cell('apr')).toContain('APR');
    // The one design serves all of them — no per-type element anywhere in it.
    expect(doc.elements.every((e) => !e.visibleWhen)).toBe(true);
  });
});

describe('it does not report a clean bill it has not earned', () => {
  const doc = youngSubaruSingleOffer();

  it('says so when no co-op pack is on file', () => {
    const sheet = buildProofSheet({ doc: { ...doc, make: 'Subaru' }, data: SAMPLE });
    expect(noteText(sheet)).toContain('No Subaru co-op rule pack is on file');
    expect(noteText(sheet)).toContain('not a compliance sign-off');
  });

  it('says a template naming no make had no manufacturer rules applied', () => {
    expect(buildProofSheet({ doc, data: SAMPLE }).notes.map((n) => n.text).join(' ')).toContain('names no make');
  });

  it('warns that an unverified pack downgrades its own errors', () => {
    const pack: CoopRulePack = {
      make: 'Subaru',
      version: '2026-01',
      verified: false,
      rules: [],
    } as unknown as CoopRulePack;
    const sheet = buildProofSheet({ doc: { ...doc, make: 'Subaru' }, data: SAMPLE, coopPack: pack });
    expect(noteText(sheet)).toContain('unverified');
  });

  it('warns when the design-time verdict is stale', () => {
    const sheet = buildProofSheet({
      doc,
      data: SAMPLE,
      coopDesign: { make: 'Subaru', packVersion: '2026-01', findings: [], stale: true },
    });
    expect(noteText(sheet)).toContain('predates the current design');
  });

  it('names the account-supplied art that is missing, so a hole is not read as a fault', () => {
    const sheet = buildProofSheet({ doc });
    expect(noteText(sheet)).toContain('Vehicle photo and dealer logo come from the account');
  });

  it('names the offer types that are blocked, and blocks the sheet with them', () => {
    // No offer figures at all: every type fails its own required fields.
    const sheet = buildProofSheet({ doc, data: { ...SAMPLE, monthlyPayment: '', leaseTerm: '' } });
    const lease = sheet.rows.find((r) => r.offerType === 'lease')!;
    expect(lease.ok).toBe(false);
    expect(sheet.ok).toBe(false);
    expect(sheet.errorCount).toBeGreaterThan(0);
    expect(noteText(sheet)).toContain('Blocked for Lease');
  });

  it('passes a fully-filled design', () => {
    const sheet = buildProofSheet({ doc, data: SAMPLE });
    const blocking = sheet.rows.filter((r) => !r.ok).map((r) => r.label);
    expect(blocking, sheet.rows.flatMap((r) => r.issues.map((i) => i.message)).join(' | ')).toEqual([]);
    expect(sheet.ok).toBe(true);
  });
});

describe('the notes say how much they matter', () => {
  const doc = youngSubaruSingleOffer();

  it('marks what stops an export as blocking, and what merely looks wrong as context', () => {
    const sheet = buildProofSheet({ doc, data: { ...SAMPLE, monthlyPayment: '', leaseTerm: '' } });
    const byLabel = new Map(sheet.notes.map((n) => [n.label, n]));
    expect(byLabel.get('Cannot export')!.tone).toBe('blocking');
    // The blank photo is not a fault, and reading like one is how a designer ends
    // up "fixing" the template.
    expect(sheet.notes.find((n) => n.text.includes('come from the account'))!.tone).toBe('context');
  });

  it('marks a missing rule pack as a caution, not a pass and not a fault', () => {
    const sheet = buildProofSheet({ doc: { ...doc, make: 'Subaru' }, data: SAMPLE });
    expect(sheet.notes.find((n) => n.label === 'Not checked')!.tone).toBe('caution');
  });

  it('reads blocking first, whatever order the checks ran in', () => {
    const noDisclaimer = { ...doc, elements: doc.elements.filter((e) => e.role !== 'disclaimer') };
    const sheet = buildProofSheet({
      doc: { ...noDisclaimer, make: 'Subaru' },
      data: { ...SAMPLE, monthlyPayment: '' },
    });
    const rank = { blocking: 0, caution: 1, context: 2 } as const;
    const order = sheet.notes.map((n) => rank[n.tone]);
    expect(order, sheet.notes.map((n) => `${n.tone}:${n.label}`).join(' | ')).toEqual([...order].sort());
    expect(sheet.notes[0].tone).toBe('blocking');
  });

  it('gives every note a short badge label', () => {
    const sheet = buildProofSheet({ doc, data: { ...SAMPLE, monthlyPayment: '' } });
    for (const n of sheet.notes) {
      expect(n.label.length, n.label).toBeGreaterThan(2);
      expect(n.label.split(' ').length, n.label).toBeLessThanOrEqual(3);
      expect(n.text.length).toBeGreaterThan(20);
    }
  });

  it('starts every note with a capital, since each one is a sentence', () => {
    const sheet = buildProofSheet({ doc, data: SAMPLE });
    for (const n of sheet.notes) expect(n.text[0], n.text).toBe(n.text[0].toUpperCase());
  });
});

describe('an issue is attributed to the cell it happened in', () => {
  it('files a size-scoped issue under that board only', () => {
    const doc = youngSubaruSingleOffer();
    const sheet = buildProofSheet({ doc, data: { ...SAMPLE, monthlyPayment: '' } });
    const lease = sheet.rows.find((r) => r.offerType === 'lease')!;
    // Whatever fired, every board-scoped issue appears under a board that names it.
    for (const issue of lease.issues.filter((i) => i.sizes?.length)) {
      for (const sizeId of issue.sizes!) {
        const board = lease.boards.find((b) => b.sizeId === sizeId)!;
        expect(board.issues, `${sizeId}: ${issue.message}`).toContain(issue);
      }
    }
  });

  it('leaves data-level issues off the boards, where they would repeat five times', () => {
    const doc = youngSubaruSingleOffer();
    const sheet = buildProofSheet({ doc, data: { ...SAMPLE, monthlyPayment: '' } });
    for (const row of sheet.rows) {
      for (const b of row.boards) for (const i of b.issues) expect(i.sizes?.length).toBeTruthy();
    }
  });
});

describe('a fault in the DESIGN is stated once, not once per ad', () => {
  const doc = youngSubaruSingleOffer();
  // The same rule failing under three offer types, as a real verdict reports it.
  const verdict = {
    make: 'Subaru',
    packVersion: '2026-01',
    findings: [
      { ruleId: 'r1', severity: 'warning' as const, description: 'The disclaimer is too small', citation: '§4', offerType: 'lease' },
      { ruleId: 'r1', severity: 'error' as const, description: 'The disclaimer is too small', citation: '§4', offerType: 'apr' },
      { ruleId: 'r2', severity: 'warning' as const, description: 'The brandmark is missing', citation: '§7', offerType: 'any' },
    ],
  };
  const sheet = buildProofSheet({ doc, data: SAMPLE, coopDesign: verdict });

  it('collapses one rule into one line, whatever the offer type', () => {
    expect(sheet.templateFaults).toHaveLength(2);
    const first = sheet.templateFaults.find((f) => f.ruleId === 'r1')!;
    expect(first.description).toBe('The disclaimer is too small');
    expect(first.offerTypes).toEqual(['lease', 'apr']);
    expect(first.citation).toBe('§4');
  });

  it('takes the worst severity across the types it failed under', () => {
    expect(sheet.templateFaults.find((f) => f.ruleId === 'r1')!.severity).toBe('error');
  });

  it("leaves a rule that fails for every type without a type list", () => {
    expect(sheet.templateFaults.find((f) => f.ruleId === 'r2')!.offerTypes).toEqual([]);
  });

  it('keeps design faults out of the rows entirely', () => {
    for (const row of sheet.rows) {
      for (const i of row.issues) expect(i.scope, i.message).not.toBe('design');
      for (const b of row.boards) for (const i of b.issues) expect(i.scope).not.toBe('design');
    }
  });

  it('counts a design fault once, not once per row', () => {
    // Two faults, five rows. Counted per row this read ten.
    expect(sheet.errorCount).toBe(1);
    expect(sheet.warningCount).toBe(1);
  });

  it('still blocks every row a design error applies to', () => {
    // The fault is the template's; the ad is blocked all the same.
    expect(sheet.ok).toBe(false);
    expect(sheet.rows.every((r) => !r.ok)).toBe(true);
  });

  it('says in its notes that these belong to the designer', () => {
    expect(noteText(sheet)).toContain('the DESIGN fails');
    expect(noteText(sheet)).toContain("designer's to fix");
  });

  it('has no faults section when the design has no verdict', () => {
    expect(buildProofSheet({ doc, data: SAMPLE }).templateFaults).toEqual([]);
  });
});

describe('the house design audit rides along with the co-op rules', () => {
  const doc = youngSubaruSingleOffer();

  it('adds nothing to a design that passes both', () => {
    expect(buildProofSheet({ doc, data: SAMPLE }).templateFaults).toEqual([]);
  });

  it('reports a missing disclaimer with no co-op pack in sight', () => {
    // The case the co-op engine cannot catch: no pack for the make, so its design
    // check is a no-op, and the template ships legal-line-free.
    const noDisclaimer = { ...doc, elements: doc.elements.filter((e) => e.role !== 'disclaimer') };
    const sheet = buildProofSheet({ doc: noDisclaimer, data: SAMPLE });
    const f = sheet.templateFaults.find((x) => x.ruleId === 'disclaimer_absent')!;
    expect(f.severity).toBe('error');
    expect(f.source).toBe('audit');
    expect(f.citation).toBeUndefined();
    expect(f.fix).toBeTruthy();
  });

  it('fails the sheet on a design fault even when every row of data checks out', () => {
    const noDisclaimer = { ...doc, elements: doc.elements.filter((e) => e.role !== 'disclaimer') };
    const sheet = buildProofSheet({ doc: noDisclaimer, data: SAMPLE });
    // Preflight has no ad-level value at fault, so the rows pass...
    expect(sheet.rows.every((r) => r.ok)).toBe(true);
    // ...and the sheet still must not read as shippable.
    expect(sheet.ok).toBe(false);
    expect(sheet.errorCount).toBeGreaterThan(0);
  });

  it('names the board a fault was found on', () => {
    const layouts = structuredClone(doc.layouts);
    const id = doc.elements.find((e) => e.role === 'disclaimer')!.id;
    layouts.google[id] = { ...layouts.google[id], h: 0.02 };
    const sheet = buildProofSheet({ doc: { ...doc, layouts }, data: SAMPLE });
    const f = sheet.templateFaults.find((x) => x.ruleId === 'disclaimer_illegible')!;
    expect(f.sizes).toEqual(['google']);
  });

  it('audits only the boards the sheet is drawing', () => {
    const layouts = structuredClone(doc.layouts);
    const id = doc.elements.find((e) => e.role === 'disclaimer')!.id;
    layouts.google[id] = { ...layouts.google[id], h: 0.02 };
    const sheet = buildProofSheet({ doc: { ...doc, layouts }, data: SAMPLE, sizeIds: ['fb'] });
    expect(sheet.templateFaults).toEqual([]);
  });

  it('tells a manufacturer rule from a house check in its notes', () => {
    const noDisclaimer = { ...doc, elements: doc.elements.filter((e) => e.role !== 'disclaimer') };
    const notes = buildProofSheet({ doc: noDisclaimer, data: SAMPLE }).notes.map((n) => n.text).join(' ');
    expect(notes).toContain('design checks the DESIGN fails');
  });
});

describe('it works on the templates that already exist', () => {
  it('draws the hand-built Young Subaru template, Show For gates and all', () => {
    const doc: TemplateDoc = youngSubaruSingleOfferDoc;
    const sheet = buildProofSheet({ doc, data: SAMPLE });
    expect(sheet.rows.length).toBeGreaterThan(0);
    for (const row of sheet.rows) expect(row.boards.length).toBe(doc.sizes.length);
  });

  it('draws only the boards asked for', () => {
    const doc = youngSubaruSingleOffer();
    const sheet = buildProofSheet({ doc, data: SAMPLE, sizeIds: [doc.sizes[0].id] });
    expect(sheet.sizes).toHaveLength(1);
    expect(proofSheetSummary(sheet)).toContain('× 1 board');
  });

  it('draws only the offer types asked for', () => {
    const doc = youngSubaruSingleOffer();
    const sheet = buildProofSheet({ doc, data: SAMPLE, offerTypes: ['apr'] });
    expect(sheet.rows.map((r) => r.offerType)).toEqual(['apr']);
  });
});

describe('the row palette is the builder palette', () => {
  it('tints each row with its own offer type accent', () => {
    const sheet = buildProofSheet({ doc: youngSubaruSingleOffer(), data: SAMPLE });
    const by = new Map(sheet.rows.map((r) => [r.offerType, r.accent]));
    expect(by.get('lease')).toBe('#3b82f6');
    expect(by.get('apr')).toBe('#8b5cf6');
    expect(by.get('discount')).toBe('#f59e0b');
    expect(by.get('sales_price')).toBe('#10b981');
  });

  it('labels a row with the short name, not the long one', () => {
    const sheet = buildProofSheet({ doc: youngSubaruSingleOffer(), data: SAMPLE });
    expect(sheet.rows.find((r) => r.offerType === 'apr')!.label).toBe('APR');
    expect(sheet.rows.find((r) => r.offerType === 'sales_price')!.label).toBe('Sale price');
  });
});

describe('the row data is the render data', () => {
  it('layers the caller values over the template defaults, then the offer type', () => {
    const doc = youngSubaruSingleOffer();
    const data = proofRowData(doc, { dealerName: 'Other Motors' }, 'apr');
    expect(data.dealerName).toBe('Other Motors');
    expect(data.offerType).toBe('apr');
    // The template's own defaults survive where the caller said nothing.
    expect(data.tagline).toBe(doc.defaults.tagline);
    // Enriched, so the plate's computed fields are present for the renderer.
    expect(data._offerMain).toBeTruthy();
  });

  it('derives the drawn types from the doc kind', () => {
    expect(proofOfferTypes(youngSubaruSingleOffer())).toContain('lease');
    expect(proofOfferTypes({ ...youngSubaruSingleOffer(), offerKind: 'custom' })).toContain('flat_price');
  });
});
