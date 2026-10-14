// DB-backed tests for the stages between fetch and publish (draft.ts): read,
// classify, conflict check, copy, validate, publish — with the two model calls
// stubbed, monday played by the in-memory stub and the screenshot stubbed.
// Its store's name must not match drafting.db.test.ts's: the intake there
// matches by name across every account, and a twin is an ambiguous match.
//
// Self-skip unless RUN_DB_TESTS=1. Point DATABASE_URL at a throwaway database:
//   DATABASE_URL=postgresql://…/scratch RUN_DB_TESTS=1 npx vitest run src/lib/drafting/draft.db.test.ts
import 'dotenv/config';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { mondayStub, type StubBoard } from './__fixtures__/monday';
import type { DraftCopy } from './assemble';
import type { CopyResult } from './copywriter';
import { DRAFT_OUTPUT_COLUMN } from './monday-board';
import type { CreativeReading } from './reading';

const readCreative = vi.fn<() => Promise<CreativeReading>>();
const writeCopy = vi.fn<() => Promise<CopyResult>>();
const repairCopy = vi.fn<() => Promise<CopyResult>>();
vi.mock('./extract', () => ({ readCreative: (..._a: unknown[]) => readCreative() }));
vi.mock('./copywriter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./copywriter')>()),
  writeCopy: (..._a: unknown[]) => writeCopy(),
  repairCopy: (..._a: unknown[]) => repairCopy(),
}));
vi.mock('@/lib/email/screenshot', () => ({
  renderCampaignScreenshotFromHtml: vi.fn(async () => ({ image: Buffer.from('png'), contentType: 'image/png', filename: 'x.png' })),
}));

const { runDraftStages } = await import('./draft');

const RUN = !!process.env.RUN_DB_TESTS;
const ACCOUNT = 'vitestDraftStagesChevrolet';
const SUB = '990000000201';
const DISCLAIMER = 'MSRP $36,995 for 2026 Equinox ACTIV. $3,500 off MSRP. Take delivery by 10/31/2026.';

const READING: CreativeReading = {
  requestType: 'model_offer',
  fields: [
    { key: 'headline', label: 'Headline', value: '2026 Equinox ACTIV, $3,500 off MSRP', confidence: 'high' },
    { key: 'expiration', label: 'Offer ends', value: 'Offer ends 10/31/2026', confidence: 'high' },
  ],
  disclaimer: { text: DISCLAIMER, confidence: 'high' },
  offerType: 'cash',
  vehicle: { year: 2026, make: 'Chevrolet', model: 'Equinox', trim: 'ACTIV' },
  model: 'claude-opus-5-5',
  readAt: new Date().toISOString(),
};

function copy(subject = 'Save $3,500 on the 2026 Equinox ACTIV'): CopyResult {
  const c: DraftCopy = {
    headline: 'The 2026 Equinox ACTIV, $3,500 off',
    body: ['Take $3,500 off MSRP on a new 2026 Equinox ACTIV at Stagewell Chevrolet.'],
    ctas: ['Shop Equinox', 'Value Your Trade'],
    heroAlt: '2026 Equinox ACTIV, $3,500 off MSRP',
    subjects: [
      { kind: 'initial', text: subject },
      { kind: 'urgent', text: 'Ends Oct 31: $3,500 off the Equinox ACTIV' },
    ],
    previews: [
      { kind: 'initial', text: '$3,500 off MSRP at Stagewell Chevrolet.' },
      { kind: 'urgent', text: 'Last days to take $3,500 off.' },
    ],
    notes: [],
  };
  return { copy: c, exampleIds: [], system: 's', prompt: 'p' };
}

let board: StubBoard;
let stub: ReturnType<typeof mondayStub>;

const row = () => prisma.draftRequest.findUniqueOrThrow({ where: { mondaySubitemId: SUB }, include: { versions: true } });

async function seed(details = 'Equinox ACTIV, $3,500 off MSRP. Offer ends 10/31/2026.') {
  await prisma.draftRequest.deleteMany({ where: { mondaySubitemId: SUB } });
  await prisma.draftRequest.create({
    data: {
      mondaySubitemId: SUB,
      name: 'Email Blast 1 - Stagewell Chevrolet',
      projectName: 'Equinox ACTIV Monthly Offer',
      accountKey: ACCOUNT,
      status: 'awaiting_extraction',
      request: JSON.stringify({
        id: 'p1', name: 'Equinox ACTIV Monthly Offer', clients: ['Stagewell Chevrolet'], coop: 'no',
        offerDisclaimer: '', details, completeBy: null, runDates: null, audience: '', audienceDetails: '', jobNumber: null,
      }),
      assets: JSON.stringify([
        { mondayAssetId: '601', name: 'Offer.png', contentType: 'image/png', bytes: 5, sha256: 'x', s3Key: 'k', url: 'https://cdn.example.com/offer.png' },
      ]),
    },
  });
}

async function cleanup() {
  const rows = await prisma.draftRequest.findMany({ where: { mondaySubitemId: SUB }, select: { templateId: true } });
  await prisma.draftRequest.deleteMany({ where: { mondaySubitemId: SUB } });
  await prisma.template.deleteMany({ where: { id: { in: rows.map((r) => r.templateId).filter((t): t is string => !!t) } } });
  await prisma.account.deleteMany({ where: { key: ACCOUNT } });
}

describe.skipIf(!RUN)('drafting stages (DB)', () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.account.create({
      data: {
        key: ACCOUNT,
        dealer: 'Stagewell Chevrolet',
        oem: 'Chevrolet',
        website: 'https://www.stagewellchevrolet.com/',
        siteDisplay: 'StagewellChevrolet.com',
        logos: JSON.stringify({ light: 'https://cdn.example.com/logo.png' }),
        address: '645 N Main St', city: 'Layton', state: 'UT', postalCode: '84041',
      },
    });
  });
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
  beforeEach(() => {
    board = { subitems: [{ id: SUB, name: 'Email Blast 1 - Stagewell Chevrolet', approved: true, assets: { '601': 'Offer.png' }, clients: ['Stagewell Chevrolet'] }], creative: { '601': 'png' } };
    stub = mondayStub(board);
    vi.stubGlobal('fetch', vi.fn(stub.fetch));
    vi.stubEnv('MONDAY_API_TOKEN', 'test-token');
    vi.stubEnv('DRAFTING_MONDAY_WRITE_SUBITEMS', SUB);
    readCreative.mockReset().mockResolvedValue(READING);
    writeCopy.mockReset().mockResolvedValue(copy());
    repairCopy.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('reads, drafts, clears the rules and publishes', async () => {
    await seed();
    await runDraftStages((await row()).id);
    const r = await row();
    expect(r.error).toBeNull();
    expect(r.status).toBe('in_proofing');
    expect(JSON.parse(r.extraction!)).toMatchObject({ requestType: 'model_offer' });
    expect(r.versions).toHaveLength(1);
    expect(JSON.parse(r.versions[0].evaluation).blocked).toBe(false);
    expect(stub.writes.uploads.map((u) => u.columnId)).toEqual([DRAFT_OUTPUT_COLUMN, DRAFT_OUTPUT_COLUMN]);
    const update = stub.writes.updates.find((u) => u.itemId === SUB)!.body;
    expect(update).toContain('Save $3,500 on the 2026 Equinox ACTIV');
    expect(update).toContain(DISCLAIMER);
  });

  it('stops on a conflict, reports both values, and writes no draft', async () => {
    await seed('Equinox ACTIV, $3,500 off MSRP. Offer ends 11/30/2026.');
    await runDraftStages((await row()).id);
    const r = await row();
    expect(r.status).toBe('conflict');
    expect(JSON.parse(r.conflicts!)).toEqual([expect.objectContaining({ field: 'expiration', request: '11/30/2026' })]);
    expect(r.versions).toHaveLength(0);
    expect(writeCopy).not.toHaveBeenCalled();
    expect(stub.writes.uploads).toEqual([]);
    expect(stub.writes.updates[0].body).toContain('the creative and the request disagree');
  });

  it('says it only drafts model offers yet, rather than guessing a service email', async () => {
    await seed();
    readCreative.mockResolvedValue({ ...READING, requestType: 'service_special' });
    await runDraftStages((await row()).id);
    expect((await row()).status).toBe('blocked');
    expect(writeCopy).not.toHaveBeenCalled();
    expect(stub.writes.updates[0].body).toContain('a service or parts special');
  });

  it('rewrites once when only the copy broke a rule', async () => {
    await seed();
    writeCopy.mockResolvedValue(copy('Save $4,000 on the 2026 Equinox ACTIV'));
    repairCopy.mockResolvedValue(copy());
    await runDraftStages((await row()).id);
    expect(repairCopy).toHaveBeenCalledTimes(1);
    expect((await row()).status).toBe('in_proofing');
  });

  it('keeps a blocked version as the record, and uploads nothing', async () => {
    await seed();
    writeCopy.mockResolvedValue(copy('Save $4,000 on the 2026 Equinox ACTIV'));
    repairCopy.mockResolvedValue(copy('Still $4,000 off the 2026 Equinox ACTIV'));
    await runDraftStages((await row()).id);
    const r = await row();
    expect(r.status).toBe('blocked');
    expect(r.versions).toHaveLength(1);
    expect(r.versions[0].uploadedAt).toBeNull();
    expect(stub.writes.uploads).toEqual([]);
    expect(stub.writes.updates[0].body).toContain('$4,000');
  });
});
