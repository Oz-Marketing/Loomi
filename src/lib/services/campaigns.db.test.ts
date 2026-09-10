// DB-backed tests for the campaign container's read paths.
// Self-skip unless RUN_DB_TESTS=1 so `npm test` stays green without a
// database. Run locally with:  RUN_DB_TESTS=1 npm test
//
// What is pinned here is the client bound: `listCampaigns({ automationOnly })`
// is the ONLY thing standing between a client and every manual blast, flow and
// landing page ever created on their account. It was unpinned by any test until
// the on-demand OEM run started depending on it.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createCampaign, listCampaigns } from './campaigns';

const RUN = !!process.env.RUN_DB_TESTS;
const PREFIX = '__vitest_campaigns_';
const acct = `${PREFIX}a`;

describe.skipIf(!RUN)('listCampaigns — DB integration', () => {
  beforeAll(async () => {
    await prisma.campaign.deleteMany({ where: { accountKey: acct } });
    await prisma.account.deleteMany({ where: { key: acct } });
    await prisma.account.create({ data: { key: acct, dealer: 'Vitest Campaigns A' } });
    await createCampaign({ name: 'OEM run', accountKey: acct, source: 'automation' });
    await createCampaign({ name: 'Hand-built', accountKey: acct, source: 'manual' });
    await createCampaign({ name: 'AI drafted', accountKey: acct, source: 'ai' });
  });

  afterAll(async () => {
    await prisma.campaign.deleteMany({ where: { accountKey: acct } });
    await prisma.account.deleteMany({ where: { key: acct } });
  });

  it('returns only automation campaigns when bounded — the client tier', async () => {
    const rows = await listCampaigns({ accountKeys: [acct], automationOnly: true });
    expect(rows.map((r) => r.source)).toEqual(['automation']);
  });

  it('returns everything for staff', async () => {
    const rows = await listCampaigns({ accountKeys: [acct] });
    expect(rows.map((r) => r.source).sort()).toEqual(['ai', 'automation', 'manual']);
  });
});
