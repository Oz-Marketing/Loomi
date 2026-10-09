import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DELIVERABLES_BOARD_ID,
  DRAFT_OUTPUT_COLUMN,
  PAGEPROOF_OWNED_COLUMNS,
  deliverableKind,
  getDeliverable,
  parseCoopFlag,
  parseDeliverable,
  uploadDraftFile,
} from './monday-board';

/**
 * A real subitem as monday returned it on 2026-10-09 (board 18431636469),
 * trimmed. Mirrors arrive with `text: null` and the value in `display_value`.
 */
const RAW_SUBITEM: Parameters<typeof parseDeliverable>[0] = {
  id: '13241541081',
  name: 'Email Blast 1',
  board: { id: DELIVERABLES_BOARD_ID },
  column_values: [
    { id: 'multiple_person_mm7v6rk2', text: '' },
    { id: 'color_mm79cjxv', text: '', label: null },
    { id: 'color_mm79xe71', text: 'No proof', label: 'No proof' },
    { id: 'link_mm79djf1', text: '', url: null },
    { id: 'date_mm7z9v44', text: '', date: null },
    {
      id: 'file_mm7z1a42',
      text: '',
      files: [
        { asset: { id: '901', name: 'Oct Offer 600x900.png', file_extension: '.PNG', file_size: 812_345 } },
        { asset: null },
      ],
    },
    { id: 'color_mm7zba2g', text: 'Approved', label: 'Approved' },
    { id: 'file_mm7z7hyz', text: '', files: [] },
  ],
  parent_item: {
    id: '13241312261',
    name: 'YPS Euro & Ogden Next Season Starts Now Email + Text (26/10/08)',
    column_values: [
      { id: 'lookup_mm7pw1hd', text: null, display_value: 'Young Powersports Ogden, Young Powersports Euro' },
      { id: 'lookup_mm7phjm0', text: null, display_value: 'No' },
      { id: 'lookup_mm7p60ay', text: null, display_value: '' },
      { id: 'lookup_mm7p6kqj', text: null, display_value: 'Just creating this ticket for the email request!' },
      { id: 'lookup_mm7p8b1x', text: null, display_value: '2026-10-15' },
      { id: 'lookup_mm7p67r1', text: null, display_value: '' },
      { id: 'lookup_mm7p3p7s', text: null, display_value: 'No service in ___ months' },
      { id: 'lookup_mm7pap3x', text: null, display_value: 'Customers who purchased within the past 12 months' },
      { id: 'lookup_mm7parn0', text: null, display_value: 'OZ2610-075' },
    ],
  },
};

describe('parseDeliverable', () => {
  it('reads the deliverable and the request it belongs to', () => {
    const d = parseDeliverable(RAW_SUBITEM);
    expect(d.kind).toBe('email');
    expect(d.assetsApproved).toBe(true);
    expect(d.designAssets).toEqual([
      { assetId: '901', name: 'Oct Offer 600x900.png', extension: '.png', sizeBytes: 812_345 },
    ]);
    expect(d.draftFiles).toEqual([]);
    expect(d.proof).toEqual({ status: 'No proof', url: null, approvedOn: null, approved: false });
    expect(d.project?.clients).toEqual(['Young Powersports Ogden', 'Young Powersports Euro']);
    expect(d.project?.coop).toBe('no');
    expect(d.project?.completeBy).toBe('2026-10-15');
    expect(d.project?.runDates).toBeNull();
    expect(d.project?.jobNumber).toBe('OZ2610-075');
  });

  it('treats only "Approved" as approved, for both the trigger and the proof', () => {
    const raw = structuredClone(RAW_SUBITEM);
    raw.column_values = raw.column_values.map((cv) =>
      cv.id === 'color_mm7zba2g' ? { ...cv, label: 'Waiting on Design' }
      : cv.id === 'color_mm79xe71' ? { ...cv, label: 'Approved' }
      : cv,
    );
    const d = parseDeliverable(raw);
    expect(d.assetsApproved).toBe(false);
    expect(d.proof.approved).toBe(true);
  });

  it('survives an orphaned subitem', () => {
    expect(parseDeliverable({ ...RAW_SUBITEM, parent_item: null }).project).toBeNull();
  });
});

describe('labels', () => {
  it('reads the deliverable kind from the subitem name', () => {
    expect(deliverableKind('Email Blast 12')).toBe('email');
    expect(deliverableKind('Text Blast 1')).toBe('text');
    expect(deliverableKind('Landing Page 1')).toBe('landing_page');
    expect(deliverableKind('Website Audit 1')).toBe('other');
  });

  it('reads all three Co-op labels and the blank', () => {
    expect(parseCoopFlag('Yes')).toBe('yes');
    expect(parseCoopFlag('No')).toBe('no');
    expect(parseCoopFlag('Compliance Check')).toBe('compliance_check');
    expect(parseCoopFlag('')).toBe('unset');
    expect(parseCoopFlag(null)).toBe('unset');
  });
});

// ── network behavior ─────────────────────────────────────────────────────────

const fetchMock = vi.fn();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('getDeliverable', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('MONDAY_API_TOKEN', 'test-token');
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('refuses an item from another board', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { items: [{ ...RAW_SUBITEM, board: { id: '9778139049' } }] } }),
    );
    await expect(getDeliverable('13241541081')).rejects.toThrow(/not a Development Projects deliverable/);
  });

  it('returns null when monday has no such item', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { items: [] } }));
    await expect(getDeliverable('1')).resolves.toBeNull();
  });
});

describe('uploadDraftFile', () => {
  const file = new File(['<html></html>'], 'draft-v1.html', { type: 'text/html' });

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('MONDAY_API_TOKEN', 'test-token');
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('refuses to write outside production unless the subitem was nominated', async () => {
    vi.stubEnv('DRAFTING_MONDAY_WRITE_SUBITEMS', '');
    await expect(uploadDraftFile('13241541081', file)).rejects.toThrow(/DRAFTING_MONDAY_WRITE_SUBITEMS/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a subitem that is not on the allowlist', async () => {
    vi.stubEnv('DRAFTING_MONDAY_WRITE_SUBITEMS', '111, 222');
    await expect(uploadDraftFile('13241541081', file)).rejects.toThrow(/isn't in/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an item on another board even when nominated', async () => {
    vi.stubEnv('DRAFTING_MONDAY_WRITE_SUBITEMS', '13241541081');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { items: [{ id: '13241541081', board: { id: '9778139049' } }] } }),
    );
    await expect(uploadDraftFile('13241541081', file)).rejects.toThrow(/not a Development Projects deliverable/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('writes the Draft Files column and nothing else', async () => {
    vi.stubEnv('DRAFTING_MONDAY_WRITE_SUBITEMS', '13241541081');
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ data: { items: [{ id: '13241541081', board: { id: DELIVERABLES_BOARD_ID } }] } }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { add_file_to_column: { id: '5550001' } } }));

    await expect(uploadDraftFile('13241541081', file)).resolves.toEqual({ assetId: '5550001' });

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://api.monday.com/v2/file');
    const form = init.body as FormData;
    const variables = JSON.parse(String(form.get('variables')));
    expect(variables).toMatchObject({ itemId: '13241541081', columnId: DRAFT_OUTPUT_COLUMN });
    expect(PAGEPROOF_OWNED_COLUMNS).not.toContain(variables.columnId);
  });
});

/**
 * Static guard on the write scope, in the style of the worker's queue test:
 * read the source rather than trust review. The PageProof sync owns the proof
 * columns, and a Loomi write to one would silently fight it.
 */
describe('drafting write scope', () => {
  const source = readFileSync(join(__dirname, 'monday-board.ts'), 'utf8');

  it('declares no GraphQL mutation of its own', () => {
    expect(source).not.toMatch(/\bmutation\b\s*[({]/);
    expect(source).not.toMatch(/change_(simple_|multiple_)?column_value/);
  });

  it('uploads only to the Draft Files column', () => {
    const uploads = [...source.matchAll(/mondayUploadFile\(\{[^}]*\}/g)].map((m) => m[0]);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toContain('columnId: DRAFT_OUTPUT_COLUMN');
  });
});
