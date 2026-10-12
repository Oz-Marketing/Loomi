// DB-backed tests for the email engagement aggregates.
// Self-skip unless RUN_DB_TESTS=1 so `npm test` stays green without a
// database. Run locally with:  RUN_DB_TESTS=1 npm test
//
// The arithmetic is unit-tested in email-analytics.test.ts with Prisma mocked;
// what only a real Postgres can prove is the SQL — that the joins, the status
// rules and the date predicates count what the file header says they count.
// Every row written here carries the __vitest_ea_ prefix and is removed after.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  getCampaignEngagement,
  getCampaignEngagementById,
  getEngagementReport,
} from './email-analytics';

const RUN = !!process.env.RUN_DB_TESTS;
const P = '__vitest_ea_';
const A = `${P}acct_a`;
const B = `${P}acct_b`;

const BLAST = `${P}blast_sept`;
const OLD = `${P}blast_aug`;
const FLOW = `${P}flow_wrapper`;
const SHARED = `${P}blast_shared`;

const SEPT_10 = new Date('2026-09-10T15:00:00Z');
const SEPT_11 = new Date('2026-09-11T15:00:00Z');
const SEPT_15 = new Date('2026-09-15T15:00:00Z');
const AUG_01 = new Date('2026-08-01T15:00:00Z');
const JUL_01 = new Date('2026-07-01T15:00:00Z');

const SEPTEMBER = {
  start: new Date('2026-09-01T00:00:00Z'),
  end: new Date('2026-09-30T23:59:59Z'),
};

let eventSeq = 0;
function event(
  type: string,
  recipientId: string | null,
  campaignId: string,
  timestamp: Date,
  extra: { url?: string; accountKey?: string } = {},
) {
  eventSeq += 1;
  return {
    sgEventId: `${P}ev_${eventSeq}`,
    eventType: type,
    recipientId,
    campaignId,
    accountKey: extra.accountKey ?? A,
    timestamp,
    url: extra.url ?? null,
    raw: '{}',
  };
}

async function cleanup() {
  await prisma.emailEvent.deleteMany({ where: { sgEventId: { startsWith: P } } });
  await prisma.emailBlast.deleteMany({ where: { id: { startsWith: P } } });
}

describe.skipIf(!RUN)('email engagement aggregates — DB integration', () => {
  beforeAll(async () => {
    await cleanup();

    await prisma.emailBlast.createMany({
      data: [
        {
          id: BLAST, name: 'September Event', subject: 's', htmlContent: '<p/>',
          status: 'completed', startedAt: SEPT_10, completedAt: SEPT_10,
          accountKeys: JSON.stringify([A]),
        },
        {
          id: OLD, name: 'August Event', subject: 's', htmlContent: '<p/>',
          status: 'partial', startedAt: AUG_01, completedAt: AUG_01,
          accountKeys: JSON.stringify([A]),
        },
        {
          // A flow step's wrapper: terminal, and never given a send date.
          id: FLOW, name: 'Welcome · Day 1', subject: 's', htmlContent: '<p/>',
          status: 'completed', flowNodeKey: `${P}Flow:f1/Node:n1`,
          accountKeys: JSON.stringify([A]),
        },
        {
          id: SHARED, name: 'Group blast', subject: 's', htmlContent: '<p/>',
          status: 'completed', startedAt: JUL_01, completedAt: JUL_01,
          accountKeys: JSON.stringify([A, B]),
        },
      ],
    });

    // ── The September blast: 1,000 dispatched — 880 'sent', 120 'bounced'.
    const recipients: Array<{
      id: string; campaignId: string; contactId: string; accountKey: string;
      status: string; sentAt: Date | null; updatedAt?: Date;
    }> = [];
    for (let i = 0; i < 880; i += 1) {
      recipients.push({ id: `${P}s${i}`, campaignId: BLAST, contactId: `c${i}`, accountKey: A, status: 'sent', sentAt: SEPT_10 });
    }
    for (let i = 0; i < 120; i += 1) {
      recipients.push({ id: `${P}b${i}`, campaignId: BLAST, contactId: `cb${i}`, accountKey: A, status: 'bounced', sentAt: SEPT_10 });
    }
    // Never dispatched, recorded in September.
    for (let i = 0; i < 3; i += 1) {
      recipients.push({ id: `${P}f${i}`, campaignId: BLAST, contactId: `cf${i}`, accountKey: A, status: 'failed', sentAt: null, updatedAt: SEPT_10 });
    }
    for (let i = 0; i < 4; i += 1) {
      recipients.push({ id: `${P}k${i}`, campaignId: BLAST, contactId: `ck${i}`, accountKey: A, status: 'skipped', sentAt: null, updatedAt: SEPT_10 });
    }
    // Still in flight — counts nowhere.
    recipients.push({ id: `${P}p0`, campaignId: BLAST, contactId: 'cp0', accountKey: A, status: 'pending', sentAt: null });

    // ── August: failures and skips that a September report must not show.
    for (let i = 0; i < 10; i += 1) {
      recipients.push({ id: `${P}of${i}`, campaignId: OLD, contactId: `of${i}`, accountKey: A, status: 'failed', sentAt: null, updatedAt: AUG_01 });
    }
    for (let i = 0; i < 20; i += 1) {
      recipients.push({ id: `${P}ok${i}`, campaignId: OLD, contactId: `ok${i}`, accountKey: A, status: 'skipped', sentAt: null, updatedAt: AUG_01 });
    }
    for (let i = 0; i < 5; i += 1) {
      recipients.push({ id: `${P}os${i}`, campaignId: OLD, contactId: `os${i}`, accountKey: A, status: 'sent', sentAt: AUG_01 });
    }

    // ── The flow step: 10 sends on September 15.
    for (let i = 0; i < 10; i += 1) {
      recipients.push({ id: `${P}w${i}`, campaignId: FLOW, contactId: `w${i}`, accountKey: A, status: 'sent', sentAt: SEPT_15 });
    }

    // ── A July blast that spans two accounts.
    recipients.push({ id: `${P}ga`, campaignId: SHARED, contactId: 'ga', accountKey: A, status: 'sent', sentAt: JUL_01 });
    recipients.push({ id: `${P}gb`, campaignId: SHARED, contactId: 'gb', accountKey: B, status: 'sent', sentAt: JUL_01 });

    await prisma.emailBlastRecipient.createMany({ data: recipients });
    // `updatedAt` is Prisma-managed; pin it with SQL so the date rule is what
    // is under test, not the clock the seed happened to run at.
    for (const r of recipients) {
      if (r.updatedAt) {
        await prisma.$executeRaw`UPDATE "EmailCampaignRecipient" SET "updatedAt" = ${r.updatedAt} WHERE id = ${r.id}`;
      }
    }

    const events: ReturnType<typeof event>[] = [];
    // 875 of the 880 'sent' recipients were delivered; 5 are still deferred.
    for (let i = 0; i < 875; i += 1) events.push(event('delivered', `${P}s${i}`, BLAST, SEPT_10));
    // 90 bounces and 30 drops. b0 was delivered FIRST and then bounced — it
    // must count once, as a bounce, and never as a delivery.
    for (let i = 0; i < 90; i += 1) events.push(event('bounce', `${P}b${i}`, BLAST, SEPT_10));
    for (let i = 90; i < 120; i += 1) events.push(event('dropped', `${P}b${i}`, BLAST, SEPT_10));
    events.push(event('delivered', `${P}b0`, BLAST, SEPT_10));
    // 400 unique openers; 100 of them come back twice more the next day.
    for (let i = 0; i < 400; i += 1) events.push(event('open', `${P}s${i}`, BLAST, SEPT_10));
    for (let i = 0; i < 100; i += 1) {
      events.push(event('open', `${P}s${i}`, BLAST, SEPT_11));
      events.push(event('open', `${P}s${i}`, BLAST, SEPT_11));
    }
    // Apple Mail Privacy Protection prefetches — not opens.
    for (let i = 400; i < 700; i += 1) events.push(event('machine_open', `${P}s${i}`, BLAST, SEPT_10));
    // 50 unique clickers, 10 of them twice.
    for (let i = 0; i < 50; i += 1) {
      events.push(event('click', `${P}s${i}`, BLAST, SEPT_10, { url: i < 30 ? 'https://a.example/x' : 'https://a.example/y' }));
    }
    for (let i = 0; i < 10; i += 1) {
      events.push(event('click', `${P}s${i}`, BLAST, SEPT_11, { url: 'https://a.example/x' }));
    }
    for (let i = 0; i < 5; i += 1) events.push(event('unsubscribe', `${P}s${i}`, BLAST, SEPT_11));
    for (let i = 5; i < 7; i += 1) events.push(event('group_unsubscribe', `${P}s${i}`, BLAST, SEPT_11));
    events.push(event('spamreport', `${P}s7`, BLAST, SEPT_11));

    // Flow step: 8 of 10 delivered.
    for (let i = 0; i < 8; i += 1) events.push(event('delivered', `${P}w${i}`, FLOW, SEPT_15));

    // A purged blast: its recipients are gone, its events stay with
    // recipientId nulled. None of this may reach a number.
    for (let i = 0; i < 500; i += 1) events.push(event('delivered', null, `${P}purged`, SEPT_10));
    for (let i = 0; i < 300; i += 1) events.push(event('open', null, `${P}purged`, SEPT_10));
    for (let i = 0; i < 40; i += 1) {
      events.push(event('click', null, `${P}purged`, SEPT_10, { url: 'https://purged.example/' }));
    }

    // July group blast: both halves delivered.
    events.push(event('delivered', `${P}ga`, SHARED, JUL_01));
    events.push(event('delivered', `${P}gb`, SHARED, JUL_01, { accountKey: B }));

    await prisma.emailEvent.createMany({ data: events });
  }, 60_000);

  afterAll(async () => {
    await cleanup();
  });

  it('counts a bounce as sent, and a delivered-then-bounced recipient once', async () => {
    const { totals } = await getEngagementReport({ accountKeys: [A], ...SEPTEMBER, source: 'blasts' });
    expect(totals.sent).toBe(1000);
    expect(totals.delivered).toBe(875);
    expect(totals.bounces).toBe(120);
    expect(totals.dropped).toBe(30);
    expect(totals.deliveryRate).toBeCloseTo(0.875, 10);
    expect(totals.bounceRate).toBeCloseTo(0.12, 10);
    expect(totals.delivered + totals.bounces).toBeLessThanOrEqual(totals.sent);
  });

  it('counts opens per recipient and never counts a machine open', async () => {
    const { totals } = await getEngagementReport({ accountKeys: [A], ...SEPTEMBER, source: 'blasts' });
    expect(totals.uniqueOpens).toBe(400);
    expect(totals.totalOpens).toBe(600);
    expect(totals.openRate).toBeCloseTo(400 / 875, 10);
    expect(totals.uniqueClicks).toBe(50);
    expect(totals.totalClicks).toBe(60);
    expect(totals.unsubscribes).toBe(7);
    expect(totals.spamReports).toBe(1);
  });

  it('applies the date range to skipped and failed', async () => {
    const september = await getEngagementReport({ accountKeys: [A], ...SEPTEMBER, source: 'blasts' });
    expect(september.totals.failed).toBe(3);
    expect(september.totals.skipped).toBe(4);

    const allTime = await getEngagementReport({ accountKeys: [A], start: null, end: null, source: 'blasts' });
    expect(allTime.totals.failed).toBe(13);
    expect(allTime.totals.skipped).toBe(24);
  });

  it('ignores a purged blast in totals, chart and links', async () => {
    const report = await getEngagementReport({ accountKeys: [A], ...SEPTEMBER, source: 'all' });
    // 1,000 from the blast + 10 from the flow step. The purged blast's 500
    // deliveries and 300 opens would have pushed delivery past 100%.
    expect(report.totals.sent).toBe(1010);
    expect(report.totals.delivered).toBe(883);
    expect(report.totals.deliveryRate).toBeLessThanOrEqual(1);
    expect(report.topUrls.map((u) => u.url)).not.toContain('https://purged.example/');
    const sept10 = report.series.find((p) => p.date === '2026-09-10');
    expect(sept10?.delivered).toBe(875);
  });

  it('makes the rows add up to the totals, flows included or excluded alike', async () => {
    for (const source of ['all', 'blasts', 'flows'] as const) {
      const report = await getEngagementReport({ accountKeys: [A], ...SEPTEMBER, source });
      const sum = (k: 'sent' | 'delivered' | 'uniqueOpens' | 'bounces' | 'failed' | 'skipped') =>
        report.campaigns.reduce((n, row) => n + row[k], 0);
      expect(sum('sent')).toBe(report.totals.sent);
      expect(sum('delivered')).toBe(report.totals.delivered);
      expect(sum('uniqueOpens')).toBe(report.totals.uniqueOpens);
      expect(sum('bounces')).toBe(report.totals.bounces);
      expect(sum('failed')).toBe(report.totals.failed);
      expect(sum('skipped')).toBe(report.totals.skipped);
      expect(report.campaignCount).toBe(report.campaigns.length);
    }

    const flows = await getEngagementReport({ accountKeys: [A], ...SEPTEMBER, source: 'flows' });
    expect(flows.campaigns.map((c) => c.campaignId)).toEqual([FLOW]);
    // A wrapper has no send date of its own; it is dated by its sends.
    expect(flows.campaigns[0].sentAt?.toISOString()).toBe(SEPT_15.toISOString());

    const blasts = await getEngagementReport({ accountKeys: [A], ...SEPTEMBER, source: 'blasts' });
    expect(blasts.campaigns.map((c) => c.campaignId)).toEqual([BLAST]);
  });

  it('plots distinct recipients per day, by event time', async () => {
    const { series } = await getEngagementReport({ accountKeys: [A], ...SEPTEMBER, source: 'blasts' });
    expect(series).toHaveLength(30);
    const day = (d: string) => series.find((p) => p.date === d);
    expect(day('2026-09-10')).toMatchObject({ delivered: 875, opens: 400, clicks: 50, bounces: 120 });
    expect(day('2026-09-11')).toMatchObject({ delivered: 0, opens: 100, clicks: 10, bounces: 0 });
  });

  it('ranks links by clicks from live recipients only', async () => {
    const { topUrls } = await getEngagementReport({ accountKeys: [A], ...SEPTEMBER, source: 'blasts' });
    expect(topUrls).toEqual([
      { url: 'https://a.example/x', clicks: 40 },
      { url: 'https://a.example/y', clicks: 20 },
    ]);
  });

  it('scopes a multi-account blast to the accounts asked for, row and drawer alike', async () => {
    const july = { start: new Date('2026-07-01T00:00:00Z'), end: new Date('2026-07-31T23:59:59Z') };
    const onlyA = await getCampaignEngagement({ accountKeys: [A], ...july });
    expect(onlyA.find((r) => r.campaignId === SHARED)?.sent).toBe(1);
    const both = await getCampaignEngagement({ accountKeys: [A, B], ...july });
    expect(both.find((r) => r.campaignId === SHARED)?.sent).toBe(2);

    expect((await getCampaignEngagementById(SHARED, [A]))?.sent).toBe(1);
    expect((await getCampaignEngagementById(SHARED, null))?.sent).toBe(2);
  });

  it('reports the list page with no range — every campaign, all-time numbers', async () => {
    const rows = await getCampaignEngagement({ accountKeys: [A], start: null, end: null });
    const blast = rows.find((r) => r.campaignId === BLAST);
    expect(blast).toMatchObject({ sent: 1000, delivered: 875, bounces: 120, failed: 3, skipped: 4 });
    expect(rows.find((r) => r.campaignId === OLD)).toMatchObject({ sent: 5, failed: 10, skipped: 20 });

    const byId = await getCampaignEngagementById(BLAST);
    expect(byId).toMatchObject({ sent: 1000, delivered: 875, bounces: 120, uniqueOpens: 400 });
    expect(byId?.deliveryRate).toBeCloseTo(0.875, 10);
  });

  it('returns nothing for an empty account scope instead of everything', async () => {
    const report = await getEngagementReport({ accountKeys: [], start: null, end: null });
    expect(report.totals.sent).toBe(0);
    expect(report.campaigns).toEqual([]);
    expect(await getCampaignEngagement({ accountKeys: [], start: null, end: null })).toEqual([]);
  });
});
