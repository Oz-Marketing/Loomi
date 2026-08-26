import { describe, it, expect, vi, beforeEach } from 'vitest';

const loadAcceptedCoopPack = vi.fn();
const listCoopPacks = vi.fn();
const getGuidelineDoc = vi.fn();
const listGuidelineDocs = vi.fn();
const listEventAssets = vi.fn();

vi.mock('@/lib/ad-generator/coop-pack-store', () => ({ loadAcceptedCoopPack, listCoopPacks }));
vi.mock('@/lib/ad-generator/guideline-docs', () => ({ getGuidelineDoc, listGuidelineDocs }));
vi.mock('@/lib/ad-generator/automation/event-assets', () => ({
  listEventAssets,
  coversDate: (a: { effectiveFrom: Date; effectiveTo: Date }, d: Date) =>
    d >= a.effectiveFrom && d <= a.effectiveTo,
}));

const { executeCoopTool } = await import('./coop-tools');

/** A minimal rule; `extra` carries the fields the drafting branch adds. */
function rule(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'required_phrase',
    severity: 'error',
    description: `${id} description`,
    field: 'disclaimer',
    ...extra,
  };
}

beforeEach(() => {
  loadAcceptedCoopPack.mockReset();
  getGuidelineDoc.mockReset();
  listGuidelineDocs.mockReset();
  getGuidelineDoc.mockResolvedValue(null);
});

describe('get_rule_pack — review-state guard', () => {
  it('withholds unreviewed drafts and reports them only as a count', async () => {
    // The harm case: an AI-drafted rule nobody has checked, in the same blob as
    // the reviewed ones. Vera must not be able to state what it says.
    // What loadAcceptedCoopPack returns: accepted rules only, with the drafts
    // reported as a COUNT. The two rejected/proposed rules never reach us.
    loadAcceptedCoopPack.mockResolvedValue({
      packId: 'pack-1',
      version: '2026-Q3',
      verified: true,
      sourceDocId: null,
      proposedCount: 2,
      pack: { make: 'Chevrolet', version: '2026-Q3', rules: [rule('accepted-1')] },
    });

    const res = await executeCoopTool('get_rule_pack', { make: 'Chevrolet' });

    expect(res.isError).toBe(false);
    expect(res.resultText).toContain('accepted-1');
    expect(res.resultText).toContain('1 reviewed rule(s)');
    // Drafts are surfaced as a count with an explicit prohibition.
    expect(res.resultText).toContain('2 further rule(s) are DRAFTED BUT NOT YET REVIEWED');
    expect(res.resultText).toMatch(/must NOT state what they say/);
  });

  it('treats an absent reviewState as accepted — every pack that exists today', async () => {
    // The three real packs were hand-transcribed by a person and carry no
    // reviewState. If absence meant "unreviewed", they would all switch off.
    loadAcceptedCoopPack.mockResolvedValue({
      packId: 'pack-2',
      version: '2026-Q1',
      verified: true,
      sourceDocId: null,
      proposedCount: 0,
      pack: { make: 'Mazda', version: '2026-Q1', rules: [rule('hand-1'), rule('hand-2')] },
    });

    const res = await executeCoopTool('get_rule_pack', { make: 'Mazda' });
    expect(res.resultText).toContain('2 reviewed rule(s)');
    expect(res.resultText).not.toContain('DRAFTED BUT NOT YET REVIEWED');
  });

  it('says plainly that nothing is enforced when every rule is still a draft', async () => {
    loadAcceptedCoopPack.mockResolvedValue({
      packId: 'pack-3',
      version: '2026-Q2',
      verified: false,
      sourceDocId: null,
      proposedCount: 1,
      pack: { make: 'Kia', version: '2026-Q2', rules: [] },
    });

    const res = await executeCoopTool('get_rule_pack', { make: 'Kia' });
    expect(res.resultText).toContain('No REVIEWED rules');
    expect(res.resultText).toContain('nothing is enforced automatically');
  });

  it('flags an unverified pack so the answer can say so', async () => {
    loadAcceptedCoopPack.mockResolvedValue({
      packId: 'pack-4',
      version: '2026-Q1',
      verified: false,
      sourceDocId: null,
      proposedCount: 0,
      pack: { make: 'Subaru', version: '2026-Q1', rules: [rule('r1')] },
    });

    const res = await executeCoopTool('get_rule_pack', { make: 'Subaru' });
    expect(res.resultText).toContain('NOT VERIFIED');
  });

  it('reports a missing pack as "nothing enforced", not as an error', async () => {
    loadAcceptedCoopPack.mockResolvedValue(null);
    const res = await executeCoopTool('get_rule_pack', { make: 'Genesis' });
    expect(res.isError).toBe(false);
    expect(res.resultText).toContain('No rule pack has been transcribed for Genesis');
  });
});

describe('get_rule_pack — per-rule citations', () => {
  it('emits a citation per rule that names its document and page', async () => {
    // A pack drafted from TWO documents — the case a pack-level document id gets
    // wrong by sending half the rules to the wrong PDF.
    loadAcceptedCoopPack.mockResolvedValue({
      packId: 'pack-5',
      version: '2026-Q3',
      verified: true,
      // Null because the two rules disagree — which is exactly why the per-rule
      // field is the one that matters.
      sourceDocId: null,
      proposedCount: 0,
      pack: {
        make: 'Kia',
        version: '2026-Q3',
        rules: [
          rule('r1', { sourceDocId: 'doc-reimburse', sourcePage: 11, sourceQuote: 'quote one' }),
          rule('r2', { sourceDocId: 'doc-brand', sourcePage: 4, sourceQuote: 'quote two' }),
        ],
      },
    });
    getGuidelineDoc.mockImplementation(async (id: string) =>
      id === 'doc-reimburse'
        ? { id, make: 'Kia', title: 'Kia Co-op Reimbursement' }
        : { id, make: 'Kia', title: 'Kia Brand Identity' },
    );

    const res = await executeCoopTool('get_rule_pack', { make: 'Kia' });

    expect(res.emit).toEqual([
      { docId: 'doc-reimburse', make: 'Kia', title: 'Kia Co-op Reimbursement', page: 11, snippet: 'quote one' },
      { docId: 'doc-brand', make: 'Kia', title: 'Kia Brand Identity', page: 4, snippet: 'quote two' },
    ]);
    expect(res.resultText).toContain('"Kia Co-op Reimbursement" p.11');
    expect(res.resultText).toContain('"Kia Brand Identity" p.4');
  });

  it('falls back to the free-text citation, and flags rules with neither', async () => {
    loadAcceptedCoopPack.mockResolvedValue({
      packId: 'pack-6',
      version: '2026-Q1',
      verified: true,
      sourceDocId: null,
      proposedCount: 0,
      pack: {
        make: 'Mazda',
        version: '2026-Q1',
        rules: [rule('r1', { citation: '§4.2 p.11' }), rule('r2')],
      },
    });

    const res = await executeCoopTool('get_rule_pack', { make: 'Mazda' });
    expect(res.resultText).toContain('[cited: §4.2 p.11]');
    expect(res.resultText).toContain('NO CITATION — cannot be audited');
    expect(res.emit).toBeUndefined();
  });
});

describe('list_guideline_docs — searchability', () => {
  it('distinguishes a document with no extracted text from one with no hits', async () => {
    // The .docx guidelines never went through the PDF text pipeline. A brand whose
    // only document cannot be searched must not read as a brand with no rules.
    listGuidelineDocs.mockResolvedValue([
      { id: 'd1', make: 'Genesis', title: 'Genesis 2.docx', pageCount: 12, state: 'stored', notes: null },
      { id: 'd2', make: 'Mazda', title: 'Mazda Guidelines', pageCount: 60, state: 'stored', notes: null },
    ]);
    getGuidelineDoc.mockImplementation(async (id: string) =>
      id === 'd2' ? { id, pageText: '["page one"]' } : { id, pageText: null },
    );

    const res = await executeCoopTool('list_guideline_docs', {});

    expect(res.resultText).toContain('NO TEXT EXTRACTED');
    expect(res.resultText).toContain('Mazda Guidelines" (60 pages, stored, searchable)');
    expect(res.resultText).toContain('1 of these has no extracted text');
  });
});

describe('list_sales_events', () => {
  it('says which events are live today and whether the mark is required', async () => {
    listEventAssets.mockResolvedValue([
      {
        id: 'e1',
        make: 'Chevrolet',
        name: 'Labor Day Event',
        logoUrl: 'x',
        effectiveFrom: new Date('2000-01-01'),
        effectiveTo: new Date('2099-01-01'),
        required: true,
        offerTypes: [],
      },
      {
        id: 'e2',
        make: 'Chevrolet',
        name: 'Old Event',
        logoUrl: 'x',
        effectiveFrom: new Date('2001-01-01'),
        effectiveTo: new Date('2001-02-01'),
        required: false,
        offerTypes: ['lease'],
      },
    ]);

    const res = await executeCoopTool('list_sales_events', { make: 'Chevrolet' });
    expect(res.resultText).toContain('LIVE NOW');
    expect(res.resultText).toContain('mark REQUIRED');
    expect(res.resultText).toContain('not currently running');
    expect(res.resultText).toContain('lease');
    // The model has no clock; the tool has to supply one.
    expect(res.resultText).toMatch(/^Today is \d{4}-\d{2}-\d{2}\./);
  });
});

describe('unknown tools', () => {
  it('reports an unknown tool as an error the model can recover from', async () => {
    const res = await executeCoopTool('not_a_tool', {});
    expect(res.isError).toBe(true);
  });
});
