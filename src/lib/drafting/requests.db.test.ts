// DB-backed tests for drafting requests: starting one, the job's fetch
// stage, re-runs, a replaced creative, and the proof sweep — against a real
// database, with monday answered by a stubbed `fetch` and the pg-boss enqueue
// mocked out (the job is run directly, as the worker would).
//
// Self-skip unless RUN_DB_TESTS=1. Requires DATABASE_URL with the DraftRequest
// and DraftVersion tables pushed — point it at a throwaway database:
//   DATABASE_URL=postgresql://…/scratch RUN_DB_TESTS=1 npx vitest run src/lib/drafting/requests.db.test.ts
import 'dotenv/config';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { DELIVERABLES_BOARD_ID } from './monday-board';

vi.mock('./job', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./job')>()),
  enqueueDraftingJob: vi.fn(async () => {}),
}));

const { runDraftingJob, enqueueDraftingJob } = await import('./job');
const { startDraftRequest } = await import('./requests');
const { runProofStatusSweep } = await import('./proof-watch');

const RUN = !!process.env.RUN_DB_TESTS;
const PREFIX = '__vitest_drafting_';
const ACCOUNT = `${PREFIX}chev`;
const SUBITEM = '990000000001';
const start = () => startDraftRequest({ subitemId: SUBITEM, accountKey: ACCOUNT });

/** What monday answers, adjustable per test. */
const board = {
  approved: true,
  coop: 'Yes',
  creative: 'creative-v1',
  proofStatus: 'In proofing',
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function mondayFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const href = String(url);
  if (href === 'https://files.example/creative.png') {
    return new Response(board.creative, { status: 200, headers: { 'Content-Type': 'image/png' } });
  }
  const { query } = JSON.parse(String(init?.body)) as { query: string };
  if (query.includes('assets(ids:')) {
    return json({ data: { assets: [{ id: '501', name: 'Offer.png', file_size: 9, public_url: 'https://files.example/creative.png' }] } });
  }
  if (query.includes('parent_item')) {
    return json({
      data: {
        items: [
          {
            id: SUBITEM,
            name: 'Email Blast 1',
            board: { id: DELIVERABLES_BOARD_ID },
            column_values: [
              { id: 'color_mm7zba2g', text: '', label: board.approved ? 'Approved' : 'Waiting on Design' },
              { id: 'file_mm7z1a42', text: '', files: [{ asset: { id: '501', name: 'Offer.png', file_extension: '.png', file_size: 9 } }] },
              { id: 'file_mm7z7hyz', text: '', files: [] },
              { id: 'color_mm79xe71', text: '', label: 'No proof' },
            ],
            parent_item: {
              id: '990000000000',
              name: 'October Equinox Offer',
              column_values: [
                { id: 'lookup_mm7pw1hd', text: null, display_value: 'Young Chevrolet' },
                { id: 'lookup_mm7phjm0', text: null, display_value: board.coop },
              ],
            },
          },
        ],
      },
    });
  }
  // getProofStates
  return json({
    data: {
      items: [
        {
          id: SUBITEM,
          name: 'Email Blast 1',
          board: { id: DELIVERABLES_BOARD_ID },
          column_values: [
            { id: 'color_mm79xe71', text: board.proofStatus, label: board.proofStatus },
            { id: 'link_mm79djf1', text: '', url: 'https://app.pageproof.com/proof/x' },
            { id: 'date_mm7z9v44', text: '', date: '2026-10-12' },
          ],
        },
      ],
    },
  });
}

async function cleanup() {
  await prisma.draftRequest.deleteMany({ where: { mondaySubitemId: SUBITEM } });
  await prisma.account.deleteMany({ where: { key: ACCOUNT } });
}

describe.skipIf(!RUN)('drafting requests (DB)', () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.account.create({ data: { key: ACCOUNT, dealer: 'Vitest Chevrolet' } });
  });
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
  beforeEach(() => {
    Object.assign(board, { approved: true, coop: 'Yes', creative: 'creative-v1', proofStatus: 'In proofing' });
    vi.stubGlobal('fetch', vi.fn(mondayFetch));
    vi.stubEnv('MONDAY_API_TOKEN', 'test-token');
    vi.stubEnv('S3_BUCKET', '');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('starts a request, refuses a second start, and copies the creative', async () => {
    const started = await start();
    expect(started).toMatchObject({ ok: true });
    const id = started.ok ? started.requestId : '';
    expect(await prisma.draftRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'queued',
      accountKey: ACCOUNT,
      coop: 'yes',
    });
    expect(enqueueDraftingJob).toHaveBeenCalledTimes(1);

    expect(await start()).toEqual({ ok: false, status: 409, error: 'This deliverable is already being drafted.' });

    await runDraftingJob(id);
    const row = await prisma.draftRequest.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('awaiting_extraction');
    expect(row.projectName).toBe('October Equinox Offer');
    const assets = JSON.parse(row.assets ?? '[]');
    expect(assets).toEqual([
      expect.objectContaining({ mondayAssetId: '501', name: 'Offer.png', contentType: 'image/png', bytes: 11, s3Key: null }),
    ]);
    expect(JSON.parse(row.request ?? '{}')).toMatchObject({ clients: ['Young Chevrolet'], coop: 'yes' });

    // A duplicate job finds nothing to claim.
    await runDraftingJob(id);
    expect((await prisma.draftRequest.findUniqueOrThrow({ where: { id } })).status).toBe('awaiting_extraction');
  });

  it('keeps the extraction when the creative is unchanged, and drops it when design replaced the file', async () => {
    const row = await prisma.draftRequest.findUniqueOrThrow({ where: { mondaySubitemId: SUBITEM } });
    await prisma.draftRequest.update({ where: { id: row.id }, data: { extraction: '{"headline":"x"}' } });

    expect(await start()).toMatchObject({ ok: true });
    await runDraftingJob(row.id);
    expect((await prisma.draftRequest.findUniqueOrThrow({ where: { id: row.id } })).extraction).toBe('{"headline":"x"}');

    board.creative = 'creative-v2';
    expect(await start()).toMatchObject({ ok: true });
    await runDraftingJob(row.id);
    expect((await prisma.draftRequest.findUniqueOrThrow({ where: { id: row.id } })).extraction).toBeNull();
  });

  it('fails a request whose creative is no longer approved, in words a person can act on', async () => {
    const row = await prisma.draftRequest.findUniqueOrThrow({ where: { mondaySubitemId: SUBITEM } });
    board.approved = false;
    expect(await start()).toEqual({
      ok: false,
      status: 409,
      error: 'Assets Approved on monday isn\'t "Approved" any more.',
    });

    // Approval revoked after the start but before the worker reads it.
    board.approved = true;
    expect(await start()).toMatchObject({ ok: true });
    board.approved = false;
    await runDraftingJob(row.id);
    expect(await prisma.draftRequest.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: 'failed',
      error: 'Assets Approved on monday isn\'t "Approved" any more.',
    });
  });

  it('follows the proof and freezes the uploaded version once it reads Approved', async () => {
    const row = await prisma.draftRequest.findUniqueOrThrow({ where: { mondaySubitemId: SUBITEM } });
    await prisma.draftRequest.update({ where: { id: row.id }, data: { status: 'in_proofing' } });
    const version = await prisma.draftVersion.create({
      data: {
        requestId: row.id,
        number: 1,
        template: '{}',
        subjects: '[]',
        previews: '[]',
        html: '<html></html>',
        evaluation: '{}',
        uploadedAt: new Date(),
      },
    });

    board.proofStatus = 'To-dos requested';
    await runProofStatusSweep();
    expect((await prisma.draftRequest.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('changes_requested');

    board.proofStatus = 'Approved';
    await runProofStatusSweep();
    const after = await prisma.draftRequest.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ status: 'approved', proofStatus: 'Approved', proofApprovedOn: '2026-10-12' });
    expect((await prisma.draftVersion.findUniqueOrThrow({ where: { id: version.id } })).finalAt).not.toBeNull();

    // Final is final.
    expect(await start()).toEqual({
      ok: false,
      status: 409,
      error: 'This draft is approved and final.',
    });
  });
});
