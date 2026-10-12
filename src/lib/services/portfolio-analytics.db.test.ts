// DB-backed tests for the portfolio dashboard's email and suppression figures.
// Self-skip unless RUN_DB_TESTS=1 so `npm test` stays green without a
// database. Run locally with:  RUN_DB_TESTS=1 npm test
//
// Pinned here, against real SQL:
//   - the open rate is UNIQUE opens over deliveries, so habitual re-openers
//     can't push it past 100% (it divided every open event before);
//   - a group-wide opt-out is ONE suppression, counted where it started, not
//     one per account its copies landed on;
//   - the engaged-contacts and timeline reads are aggregated in SQL.
// Every row written here carries the __vitest_pa_ prefix and is removed after.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  countOriginSuppressions,
  getAccountHealth,
  getAnomalies,
  getEngagedContacts,
  getEngagementTimeline,
  getPortfolioKpis,
  getSuppressionHealth,
  getTopCampaigns,
} from './portfolio-analytics';

const RUN = !!process.env.RUN_DB_TESTS;
const P = '__vitest_pa_';
const A = `${P}a`;
const B = `${P}b`;
const C = `${P}c`;
const KEYS = [A, B, C];

const DAY = new Date('2026-09-10T15:00:00Z');
const RANGE = {
  start: new Date('2026-09-01T00:00:00Z'),
  end: new Date('2026-09-30T23:59:59Z'),
};
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

async function cleanup() {
  await prisma.emailEvent.deleteMany({ where: { sgEventId: { startsWith: P } } });
  await prisma.emailBlast.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.smsEvent.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.smsBlast.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.emailSuppression.deleteMany({ where: { accountKey: { in: KEYS } } });
  await prisma.smsSuppression.deleteMany({ where: { accountKey: { in: KEYS } } });
  await prisma.account.deleteMany({ where: { key: { in: KEYS } } });
}

describe.skipIf(!RUN)('portfolio analytics — DB integration', () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.account.createMany({
      data: KEYS.map((key, i) => ({ key, dealer: `Vitest Portfolio ${i}` })),
    });

    // ── Email: 100 delivered at A; 40 people open, five times each. ──
    await prisma.emailBlast.create({
      data: {
        id: `${P}blast`, name: 'Open-heavy blast', subject: 's', htmlContent: '<p/>',
        status: 'completed', startedAt: DAY, completedAt: DAY, accountKeys: JSON.stringify([A]),
      },
    });
    await prisma.emailBlastRecipient.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({
        id: `${P}r${i}`, campaignId: `${P}blast`, contactId: `c${i}`, accountKey: A,
        status: 'sent', sentAt: DAY,
      })),
    });
    let seq = 0;
    const ev = (type: string, recipient: number, accountKey = A) => ({
      sgEventId: `${P}ev${(seq += 1)}`, eventType: type, recipientId: `${P}r${recipient}`,
      campaignId: `${P}blast`, accountKey, timestamp: DAY, raw: '{}',
    });
    const events = [];
    for (let i = 0; i < 100; i += 1) events.push(ev('delivered', i));
    for (let i = 0; i < 40; i += 1) for (let n = 0; n < 5; n += 1) events.push(ev('open', i));
    for (let i = 40; i < 70; i += 1) events.push(ev('machine_open', i));
    for (let i = 0; i < 10; i += 1) events.push(ev('click', i));
    await prisma.emailEvent.createMany({ data: events });

    // ── A bounce spike at C, sent yesterday: 60 dispatched, 6 bounced. ──
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.emailBlast.create({
      data: {
        id: `${P}spike`, name: 'Old list', subject: 's', htmlContent: '<p/>',
        status: 'completed', startedAt: yesterday, completedAt: yesterday, accountKeys: JSON.stringify([C]),
      },
    });
    await prisma.emailBlastRecipient.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        id: `${P}x${i}`, campaignId: `${P}spike`, contactId: `x${i}`, accountKey: C,
        status: i < 6 ? 'bounced' : 'sent', sentAt: yesterday,
      })),
    });

    // ── Suppressions ──
    const t0 = new Date('2026-09-12T10:00:00.000Z');
    await prisma.emailSuppression.createMany({
      data: [
        // One unsubscribe at A, cascaded to its group a few ms later.
        { id: `${P}s1`, accountKey: A, email: 'x@example.com', reason: 'unsubscribe', createdAt: t0 },
        { id: `${P}s2`, accountKey: B, email: 'x@example.com', reason: 'unsubscribe', createdAt: plus(t0, 5) },
        { id: `${P}s3`, accountKey: C, email: 'x@example.com', reason: 'unsubscribe', createdAt: plus(t0, 10) },
        // A manual opt-out at B, written in one transaction: identical
        // timestamps, and the first write has the lowest id.
        { id: `${P}s4`, accountKey: B, email: 'y@example.com', reason: 'manual', source: 'manual', createdAt: plus(t0, 60_000 * 30) },
        { id: `${P}s5`, accountKey: A, email: 'y@example.com', reason: 'manual', source: 'manual', createdAt: plus(t0, 60_000 * 30) },
        { id: `${P}s6`, accountKey: C, email: 'y@example.com', reason: 'manual', source: 'manual', createdAt: plus(t0, 60_000 * 30) },
        // A bounce at C alone.
        { id: `${P}s7`, accountKey: C, email: 'z@example.com', reason: 'bounce', createdAt: plus(t0, 60_000 * 60) },
        // The same address bouncing at A and, independently, at B hours later.
        { id: `${P}s8`, accountKey: A, email: 'w@example.com', reason: 'bounce', createdAt: plus(t0, 60_000 * 90) },
        { id: `${P}s9`, accountKey: B, email: 'w@example.com', reason: 'bounce', createdAt: plus(t0, 60_000 * 210) },
      ],
    });
    await prisma.smsSuppression.createMany({
      data: [
        { id: `${P}p1`, accountKey: A, phone: '+18015550100', reason: 'stop', createdAt: t0 },
        { id: `${P}p2`, accountKey: B, phone: '+18015550100', reason: 'stop', createdAt: plus(t0, 3) },
      ],
    });

    // ── SMS: replies at B, a reply from an A contact who also opened. ──
    await prisma.smsBlast.create({
      data: { id: `${P}sms`, name: 'Text', message: 'hi', status: 'completed', accountKeys: JSON.stringify([A, B]) },
    });
    await prisma.smsBlastRecipient.createMany({
      data: [
        { id: `${P}m1`, campaignId: `${P}sms`, contactId: 'sc1', accountKey: B, status: 'sent', sentAt: DAY },
        { id: `${P}m2`, campaignId: `${P}sms`, contactId: 'sc2', accountKey: B, status: 'sent', sentAt: DAY },
        { id: `${P}m3`, campaignId: `${P}sms`, contactId: 'c0', accountKey: A, status: 'sent', sentAt: DAY },
      ],
    });
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await prisma.smsEvent.createMany({
      data: [
        { id: `${P}e1`, recipientId: `${P}m1`, accountKey: B, eventType: 'received', raw: '{}', timestamp: recent },
        { id: `${P}e2`, recipientId: `${P}m2`, accountKey: B, eventType: 'received', raw: '{}', timestamp: recent },
        { id: `${P}e3`, recipientId: `${P}m3`, accountKey: A, eventType: 'received', raw: '{}', timestamp: recent },
        { id: `${P}e4`, recipientId: `${P}m1`, accountKey: B, eventType: 'delivered', raw: '{}', timestamp: DAY },
        { id: `${P}e5`, recipientId: `${P}m2`, accountKey: B, eventType: 'delivered', raw: '{}', timestamp: DAY },
      ],
    });
    // The engaged-contacts window is relative to now; move A's opens into it.
    await prisma.$executeRaw`
      UPDATE "EmailEvent" SET "timestamp" = ${recent}
       WHERE "sgEventId" LIKE ${`${P}%`} AND "eventType" = 'open'
    `;
  }, 60_000);

  afterAll(async () => {
    await cleanup();
  });

  it('reports unique opens, so the open rate stays under 100%', async () => {
    // Opens moved to "recent" above, but they still belong to recipients
    // sent on DAY — the range picks recipients, and their opens follow.
    const kpis = await getPortfolioKpis({ accountKeys: KEYS, ...RANGE });
    expect(kpis.emailsSent).toBe(100);
    expect(kpis.emailDelivered).toBe(100);
    expect(kpis.emailOpens).toBe(40);
    expect(kpis.emailOpenRate).toBeCloseTo(0.4, 10);
    expect(kpis.emailClickRate).toBeCloseTo(0.1, 10);

    const health = await getAccountHealth({ accountKeys: KEYS, ...RANGE });
    const a = health.find((r) => r.accountKey === A)!;
    expect(a.opensInPeriod).toBe(40);
    expect(a.openRate).toBeCloseTo(0.4, 10);
  });

  it('counts a group-wide opt-out once, where it started', async () => {
    const byAccount = await countOriginSuppressions('email', { accountKeys: KEYS, ...RANGE }, 'account');
    expect(Object.fromEntries(byAccount)).toEqual({ [A]: 2, [B]: 2, [C]: 1 });

    const health = await getAccountHealth({ accountKeys: KEYS, ...RANGE });
    const growth = Object.fromEntries(health.map((r) => [r.accountKey, r.suppressionGrowth]));
    expect(growth).toEqual({ [A]: 2, [B]: 2, [C]: 1 });

    const kpis = await getPortfolioKpis({ accountKeys: KEYS, ...RANGE });
    // 5 email opt-outs + 1 STOP — not the 9 + 2 rows the copies make.
    expect(kpis.suppressionsAdded).toBe(6);
  });

  it('reports suppression health in addresses and opt-outs, not rows', async () => {
    const s = await getSuppressionHealth({ accountKeys: KEYS, ...RANGE });
    expect(s.emailTotal).toBe(4);
    expect(s.emailAddedInPeriod).toBe(5);
    expect(s.smsTotal).toBe(1);
    expect(s.smsAddedInPeriod).toBe(1);
    expect(Object.fromEntries(s.emailReasons.map((r) => [r.reason, r.count]))).toEqual({
      bounce: 3,
      unsubscribe: 1,
      manual: 1,
    });
  });

  it('counts engaged contacts in SQL, deduped across channels', async () => {
    const engaged = await getEngagedContacts({ accountKeys: KEYS }, 90);
    const byKey = Object.fromEntries(engaged.engagedByAccount.map((r) => [r.accountKey, r.engagedCount]));
    // A: 40 openers (c0 also replied by text — still one contact). B: 2 replies.
    expect(byKey[A]).toBe(40);
    expect(byKey[B]).toBe(2);
    expect(byKey[C]).toBe(0);
    expect(engaged.engagedTotal).toBe(42);
  });

  it('buckets the timeline in SQL — distinct recipients for email, events for SMS', async () => {
    const timeline = await getEngagementTimeline({ accountKeys: KEYS, ...RANGE });
    const day = timeline.find((p) => p.date === '2026-09-10');
    expect(day).toMatchObject({ emailDelivered: 100, emailClicks: 10, smsDelivered: 2 });
    expect(timeline).toHaveLength(30);
  });

  it('ranks top campaigns on the shared numbers', async () => {
    const top = await getTopCampaigns({ accountKeys: KEYS, ...RANGE });
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({
      campaignId: `${P}blast`,
      sent: 100,
      delivered: 100,
      uniqueOpens: 40,
      uniqueClicks: 10,
      openRate: 0.4,
      clickRate: 0.1,
    });
  });

  it('measures a bounce spike as bounced over dispatched', async () => {
    const alerts = await getAnomalies({ accountKeys: KEYS });
    const spike = alerts.find((a) => a.id === `bounce-spike-${C}`);
    expect(spike?.detail).toBe('10.0% bounces on 60 sends (7d).');
  });
});
