// DB-backed tests for the drafting pipeline around the drafter: the intake
// poller and its notices, the job's fetch stage, the proof sweep, and
// publishing a version into a Loomi template — against a real database, with
// monday played by an in-memory stub, the pg-boss enqueue mocked out (jobs are
// run directly, as the worker would) and the Chromium screenshot stubbed.
//
// Self-skip unless RUN_DB_TESTS=1. Requires DATABASE_URL with the drafting
// tables pushed — point it at a throwaway database:
//   DATABASE_URL=postgresql://…/scratch RUN_DB_TESTS=1 npx vitest run src/lib/drafting/drafting.db.test.ts
import 'dotenv/config';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { renderEmailTemplate } from '@/lib/email/render';
import { baseTemplate } from './compliance/__fixtures__/drafts';
import { mondayStub, type StubBoard } from './__fixtures__/monday';
import { DRAFT_OUTPUT_COLUMN, TEMPLATE_LINK_COLUMN } from './monday-board';
import type { CreativeReading } from './reading';

vi.mock('./job', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./job')>()),
  enqueueDraftingJob: vi.fn(async () => {}),
}));
vi.mock('@/lib/email/screenshot', () => ({
  renderCampaignScreenshotFromHtml: vi.fn(async () => ({ image: Buffer.from('png'), contentType: 'image/png', filename: 'x.png' })),
}));

const { runDraftingJob, enqueueDraftingJob } = await import('./job');
const { runDraftingIntake, RETRY_AFTER_MS } = await import('./intake');
const { runProofStatusSweep } = await import('./proof-watch');
const { publishDraftVersion, proofHtml } = await import('./publish');

const RUN = !!process.env.RUN_DB_TESTS;
// Not `_`-prefixed: the intake treats `_` keys as system rows, not stores.
const ACCOUNT = 'vitestDraftingChevrolet';
const [A, B, C, D] = ['990000000101', '990000000102', '990000000103', '990000000104'];

let board: StubBoard;
let stub: ReturnType<typeof mondayStub>;

function freshBoard(): StubBoard {
  return {
    subitems: [
      { id: A, name: 'Email Blast 1 - Vitest Chevrolet', approved: true, assets: { '501': 'Offer.png' }, clients: ['Vitest Chevrolet'], coop: 'Yes' },
      { id: B, name: 'Email Blast 2', approved: true, assets: { '502': 'Offer.png' }, clients: ['Vitest Mazda'] },
      { id: C, name: 'Email Blast 3', approved: true, assets: { '503': 'Layered.psd' }, clients: ['Vitest Chevrolet'] },
      { id: D, name: 'Email Blast 4', approved: true, assets: { '504': 'Offer.png' }, clients: ['Vitest Chevrolet'], draftFiles: ['by-hand.png'] },
    ],
    creative: { '501': 'creative-v1', '502': 'creative-b', '503': 'psd', '504': 'd' },
  };
}

const request = (subitemId: string) => prisma.draftRequest.findUnique({ where: { mondaySubitemId: subitemId } });

async function cleanup() {
  const rows = await prisma.draftRequest.findMany({ where: { mondaySubitemId: { in: [A, B, C, D] } }, select: { templateId: true } });
  await prisma.draftRequest.deleteMany({ where: { mondaySubitemId: { in: [A, B, C, D] } } });
  const templateIds = rows.map((r) => r.templateId).filter((t): t is string => Boolean(t));
  await prisma.template.deleteMany({ where: { id: { in: templateIds } } });
  await prisma.account.deleteMany({ where: { key: ACCOUNT } });
}

describe.skipIf(!RUN)('drafting pipeline (DB)', () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.account.create({
      data: { key: ACCOUNT, dealer: 'Vitest Chevrolet', address: '645 N Main St', city: 'Layton', state: 'UT', postalCode: '84041' },
    });
    board = freshBoard();
  });
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
  beforeEach(() => {
    stub = mondayStub(board);
    vi.stubGlobal('fetch', vi.fn(stub.fetch));
    vi.stubEnv('MONDAY_API_TOKEN', 'test-token');
    vi.stubEnv('DRAFTING_INTAKE_ENABLED', 'true');
    vi.stubEnv('DRAFTING_MONDAY_WRITE_SUBITEMS', [A, B, C, D].join(','));
    vi.stubEnv('S3_BUCKET', '');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('does nothing at all until it is switched on, token or no token', async () => {
    vi.stubEnv('DRAFTING_INTAKE_ENABLED', '');
    expect(await runDraftingIntake()).toEqual({ ready: 0, started: 0, held: 0 });
    expect(stub.writes.updates).toEqual([]);
    expect(await request(A)).toBeNull();
  });

  it('starts an approved deliverable, holds what it can’t start, and skips one built by hand', async () => {
    const summary = await runDraftingIntake();
    expect(summary).toEqual({ ready: 4, started: 1, held: 2 });
    expect(enqueueDraftingJob).toHaveBeenCalledTimes(1);

    expect(await request(A)).toMatchObject({ status: 'queued', accountKey: ACCOUNT, clientName: 'Vitest Chevrolet', coop: 'yes' });
    expect(await request(B)).toMatchObject({ status: 'needs_account', accountKey: null });
    expect(await request(C)).toMatchObject({ status: 'failed', error: expect.stringContaining('no PNG or JPG') });
    expect(await request(D)).toBeNull();

    // One notice each for the two that can't go — nothing for the started one.
    expect(stub.writes.updates.map((u) => u.itemId).sort()).toEqual([B, C]);
    expect(stub.writes.updates.find((u) => u.itemId === B)?.body).toContain("Loomi couldn't tell which account");
  });

  it('stays quiet on the next pass, and retries a failure quietly once it is old enough', async () => {
    await runDraftingIntake();
    expect(stub.writes.updates).toEqual([]);

    // Half an hour later the PSD-only deliverable is tried again — same problem,
    // so no second notice, but the attempt is counted.
    await runDraftingIntake(new Date(Date.now() + RETRY_AFTER_MS + 1000));
    expect(stub.writes.updates).toEqual([]);
    expect((await request(C))?.attempts).toBe(2);
  });

  it('picks a held deliverable up again as soon as someone fixes it on monday', async () => {
    board.subitems.find((s) => s.id === B)!.clients = ['Vitest Chevrolet'];
    board.subitems.find((s) => s.id === C)!.assets = { '505': 'Offer.png' };
    board.creative['505'] = 'fixed';
    const summary = await runDraftingIntake();
    expect(summary.started).toBe(2);
    expect(await request(B)).toMatchObject({ status: 'queued', accountKey: ACCOUNT, attempts: 1 });
    expect(await request(C)).toMatchObject({ status: 'queued', error: null });
  });

  it('runs the fetch stage: copies the creative, and fails with one notice when approval is withdrawn', async () => {
    const a = (await request(A))!;
    await runDraftingJob(a.id);
    const fetched = (await request(A))!;
    expect(fetched.status).toBe('awaiting_extraction');
    expect(JSON.parse(fetched.assets ?? '[]')).toEqual([
      expect.objectContaining({ mondayAssetId: '501', name: 'Offer.png', contentType: 'image/png', bytes: 11, s3Key: null }),
    ]);

    board.subitems.find((s) => s.id === B)!.approved = false;
    await runDraftingJob((await request(B))!.id);
    expect(await request(B)).toMatchObject({ status: 'failed', error: 'Assets Approved on monday isn\'t "Approved" any more.' });
    expect(stub.writes.updates.map((u) => u.itemId)).toEqual([B]);
  });

  it('publishes a version into a Loomi template and tells monday where it is', async () => {
    const a = (await request(A))!;
    const reading: CreativeReading = {
      requestType: 'model_offer',
      fields: [{ key: 'savings', label: 'Offer', value: '$3,500 off MSRP', confidence: 'low' }],
      disclaimer: { text: 'MSRP $36,995. Take delivery by 10/31/2026.', confidence: 'high' },
      model: 'test',
      readAt: new Date().toISOString(),
    };
    await prisma.draftRequest.update({ where: { id: a.id }, data: { extraction: JSON.stringify(reading), status: 'drafting' } });
    const template = baseTemplate();
    const version = await prisma.draftVersion.create({
      data: {
        requestId: a.id,
        number: 1,
        template: JSON.stringify(template),
        subjects: JSON.stringify([{ kind: 'initial', text: 'Save $3,500' }, { kind: 'urgent', text: 'Last chance: $3,500' }]),
        previews: JSON.stringify([{ kind: 'initial', text: '$3,500 off MSRP.' }, { kind: 'urgent', text: 'Ends Oct 31.' }]),
        html: await renderEmailTemplate(template),
        evaluation: JSON.stringify({ violations: [{ ruleId: 'x', severity: 'warning', message: 'A gray.' }], blocked: false, checked: [] }),
        notes: JSON.stringify(['Chevrolet co-op: no VIN in the disclaimer.']),
      },
    });

    const result = await publishDraftVersion(version.id);
    expect(result).toMatchObject({ ok: true, templateSlug: expect.stringMatching(/^draft-email-blast-1-vitest-chevrolet-/) });
    const slug = result.ok ? result.templateSlug : '';

    const published = (await request(A))!;
    expect(published.status).toBe('in_proofing');
    const saved = await prisma.template.findUniqueOrThrow({ where: { id: published.templateId! } });
    expect(saved).toMatchObject({ slug, accountKey: ACCOUNT, type: 'design', preheader: '$3,500 off MSRP.' });

    expect(stub.writes.uploads.map((u) => [u.columnId, u.name])).toEqual([
      [DRAFT_OUTPUT_COLUMN, 'Email Blast 1 - Vitest Chevrolet - v1.png'],
      [DRAFT_OUTPUT_COLUMN, 'Email Blast 1 - Vitest Chevrolet - v1.html'],
    ]);
    expect(stub.writes.links).toEqual([
      { itemId: A, columnId: TEMPLATE_LINK_COLUMN, value: expect.stringContaining(`/templates/editor?design=${slug}`) },
    ]);
    const update = stub.writes.updates.find((u) => u.itemId === A)!.body;
    expect(update).toContain('Open the template in Loomi');
    expect(update).toContain('Offer: $3,500 off MSRP <strong>— low confidence');
    expect(update).toContain('MSRP $36,995. Take delivery by 10/31/2026.');
    expect(update).toContain('<li>Urgent: Last chance: $3,500</li>');
    expect(update).toContain('<li>A gray.</li>');
    expect((await prisma.draftVersion.findUniqueOrThrow({ where: { id: version.id } })).uploadedAt).not.toBeNull();

    // A second version updates the same template and keeps the first in its history.
    const v2 = await prisma.draftVersion.create({
      data: { ...version, id: undefined, number: 2, template: JSON.stringify({ ...template, title: 'v2' }), uploadedAt: null, mondayAssetIds: null },
    });
    expect(await publishDraftVersion(v2.id)).toMatchObject({ ok: true, templateSlug: slug });
    expect(await prisma.templateVersion.count({ where: { templateId: published.templateId! } })).toBe(1);
  });

  it('renders the proof as a recipient gets it: send-time footer in, one unsubscribe link, no raw tokens', async () => {
    const html = await proofHtml(await renderEmailTemplate(baseTemplate()), ACCOUNT);
    expect(html).toContain('645 N Main St');
    expect(html).not.toContain('{{');
    expect(html.match(/>Unsubscribe</g)).toHaveLength(1);
  });

  it('freezes the uploaded version when the proof is approved', async () => {
    board.subitems.find((s) => s.id === A)!.proofStatus = 'Approved';
    await runProofStatusSweep();
    const a = (await request(A))!;
    expect(a.status).toBe('approved');
    expect(await prisma.draftVersion.count({ where: { requestId: a.id, finalAt: { not: null } } })).toBe(1);
  });
});
