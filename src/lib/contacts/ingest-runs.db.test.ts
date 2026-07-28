// DB-backed tests for the ingest run log + the contact-sync freshness check.
// Self-skip unless RUN_DB_TESTS=1 so `npm test` stays green without a
// database. Run locally with:  RUN_DB_TESTS=1 npm test
//
// These cover the thing the monitor exists to catch: a pipeline that stopped
// running looks EXACTLY like a quiet one if you only watch Contact.updatedAt.
//
// Note: every request here passes retentionDays=0. The health route's prune is
// deliberately global (it's a retention policy, not a scoped delete), so a test
// that let it run would delete real ingest history from whatever database it
// was pointed at.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recordIngestRun } from './ingest-runs';
import { GET } from '@/app/api/internal/contact-sync/health/route';
import { POST as ingestContactsRoute } from '@/app/api/ingest/contacts/route';
import { POST as ingestEventsRoute } from '@/app/api/ingest/events/route';

const RUN = !!process.env.RUN_DB_TESTS;
const PREFIX = '__vitest_ingest_';
const fresh = `${PREFIX}fresh`; // synced an hour ago
const stale = `${PREFIX}stale`; // last synced days ago
const never = `${PREFIX}never`; // has CRM contacts, no runs at all

const SECRET = '__vitest_internal_job_secret__';
const INGEST_SECRET = '__vitest_oz_ingest_secret__';

// The bridge account: exercised through the real ingest routes, so the wiring
// between "batch accepted" and "heartbeat written" is covered end to end.
const bridged = `${PREFIX}bridged`;
// A low-volume rooftop that gets reached but has no rows in the window — the
// case the empty-batch heartbeat exists for.
const quiet = `${PREFIX}quiet`;

function ingestRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${INGEST_SECRET}`,
    },
    body: JSON.stringify(body),
  });
}

interface HealthAccount {
  accountKey: string;
  status: 'ok' | 'stale' | 'never-synced';
  hoursSinceLastRun: number | null;
  contactCount: number;
  lastContactsRunAt: string | null;
  lastEventsRunAt: string | null;
  last24h: { runs: number; rows: number; created: number; updated: number; issues: number };
}

async function callHealth(query = ''): Promise<{
  status: number;
  body: {
    healthy: boolean;
    maxAgeHours: number;
    accountsChecked: number;
    ignored: string[];
    runsAllTime: number;
    staleCount: number;
    neverSyncedCount: number;
    accounts: HealthAccount[];
    problems: { accountKey: string; status: string }[];
    warnings: { accountKey: string; status: string }[];
    pruned: number;
  };
}> {
  const url = `http://localhost/api/internal/contact-sync/health?retentionDays=0${query}`;
  const res = await GET(
    new NextRequest(url, { headers: { 'x-internal-job-secret': SECRET } }),
  );
  return { status: res.status, body: await res.json() };
}

function find(accounts: HealthAccount[], key: string): HealthAccount {
  const hit = accounts.find((a) => a.accountKey === key);
  expect(hit, `account ${key} missing from health payload`).toBeDefined();
  return hit!;
}

describe.skipIf(!RUN)('ingest run log + contact-sync health', () => {
  let priorSecret: string | undefined;
  let priorIngestSecret: string | undefined;

  beforeAll(async () => {
    priorSecret = process.env.INTERNAL_JOB_SECRET;
    priorIngestSecret = process.env.OZ_INGEST_SECRET;
    process.env.INTERNAL_JOB_SECRET = SECRET;
    process.env.OZ_INGEST_SECRET = INGEST_SECRET;

    await prisma.account.deleteMany({ where: { key: { startsWith: PREFIX } } });
    await prisma.account.createMany({
      data: [
        { key: fresh, dealer: 'Vitest Fresh Motors' },
        { key: stale, dealer: 'Vitest Stale Motors' },
        { key: never, dealer: 'Vitest Never Motors' },
        { key: bridged, dealer: 'Vitest Bridged Motors' },
        { key: quiet, dealer: 'Vitest Quiet Motors' },
      ],
    });

    // Every account holds CRM-sourced contacts, so all three are discoverable
    // as accounts that are SUPPOSED to be syncing.
    await prisma.contact.createMany({
      data: [
        { accountKey: fresh, email: `${PREFIX}1@example.com`, source: 'oz-reports:automotive' },
        { accountKey: stale, email: `${PREFIX}2@example.com`, source: 'oz-reports:automotive' },
        { accountKey: never, email: `${PREFIX}3@example.com`, source: 'oz-reports:automotive' },
      ],
    });
  });

  afterAll(async () => {
    // Cascade: deleting the accounts removes their contacts and ingest runs.
    await prisma.account.deleteMany({ where: { key: { startsWith: PREFIX } } });
    if (priorSecret === undefined) delete process.env.INTERNAL_JOB_SECRET;
    else process.env.INTERNAL_JOB_SECRET = priorSecret;
    if (priorIngestSecret === undefined) delete process.env.OZ_INGEST_SECRET;
    else process.env.OZ_INGEST_SECRET = priorIngestSecret;
    await prisma.$disconnect();
  });

  it('POST /api/ingest/contacts leaves a heartbeat', async () => {
    const res = await ingestContactsRoute(
      ingestRequest('/api/ingest/contacts', {
        accountKey: bridged,
        source: 'oz-reports:automotive',
        contacts: [
          { email: `${PREFIX}buyer@example.com`, firstName: 'Vitest', tags: ['sales'] },
          { phone: '801-555-0142', firstName: 'Phoneonly', tags: ['service'] },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).created).toBe(2);

    const runs = await prisma.ingestRun.findMany({
      where: { accountKey: bridged, kind: 'contacts' },
    });
    expect(runs).toHaveLength(1);
    expect(runs[0].source).toBe('oz-reports:automotive');
    expect(runs[0].totalRows).toBe(2);
    expect(runs[0].created).toBe(2);
  });

  it('POST /api/ingest/events leaves a heartbeat', async () => {
    const res = await ingestEventsRoute(
      ingestRequest('/api/ingest/events', {
        accountKey: bridged,
        source: 'oz-reports:automotive',
        events: [
          {
            idempotencyKey: `${PREFIX}cdk:svc:1:4471`,
            type: 'service',
            email: `${PREFIX}buyer@example.com`,
            eventDate: '2026-07-20',
            amount: 412.55,
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    // Assert the OUTCOME, not just the heartbeat — a route that skipped every
    // row would still write a run row, and that's exactly the failure the
    // heartbeat is supposed to make visible rather than hide.
    const summary = await res.json();
    expect(summary.created).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.issues).toEqual([]);

    // The event landed and linked to the contact created in the previous test.
    const events = await prisma.contactEvent.findMany({
      where: { accountKey: bridged },
      select: { type: true, amount: true, contactId: true },
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('service');
    expect(events[0].amount).toBeCloseTo(412.55);
    expect(events[0].contactId).not.toBeNull();

    const runs = await prisma.ingestRun.findMany({
      where: { accountKey: bridged, kind: 'events' },
    });
    expect(runs).toHaveLength(1);
    expect(runs[0].totalRows).toBe(1);
  });

  it('an EMPTY batch still writes a heartbeat', async () => {
    // The bridge posts an empty batch when a rooftop had no rows in its window.
    // Without a heartbeat there, a genuinely quiet low-volume store is
    // indistinguishable from one the pipeline stopped reaching, and the monitor
    // false-alarms on the accounts you'd least notice going dark.
    const before = await prisma.ingestRun.count({ where: { accountKey: quiet } });
    expect(before).toBe(0);

    const res = await ingestContactsRoute(
      ingestRequest('/api/ingest/contacts', {
        accountKey: quiet,
        source: 'oz-reports:automotive',
        contacts: [],
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ totalRows: 0, created: 0, updated: 0, skipped: 0 });

    const runs = await prisma.ingestRun.findMany({ where: { accountKey: quiet } });
    expect(runs).toHaveLength(1);
    expect(runs[0].totalRows).toBe(0);
    expect(runs[0].source).toBe('oz-reports:automotive');

    // And an empty EVENTS batch does the same.
    const evRes = await ingestEventsRoute(
      ingestRequest('/api/ingest/events', { accountKey: quiet, events: [] }),
    );
    expect(evRes.status).toBe(200);
    expect(
      await prisma.ingestRun.count({ where: { accountKey: quiet, kind: 'events' } }),
    ).toBe(1);
  });

  it('a quiet rooftop reads as ok, not stale', async () => {
    // The payoff: an account that received nothing but was reached is healthy.
    const { body } = await callHealth('&maxAgeHours=30');
    const q = find(body.accounts, quiet);
    expect(q.status).toBe('ok');
    expect(q.last24h.runs).toBe(2); // contacts + events, both empty
    expect(q.last24h.rows).toBe(0); // ...and zero data, visible separately
    expect(body.problems.map((p) => p.accountKey)).not.toContain(quiet);
  });

  it('still 404s an unknown account on an empty batch', async () => {
    // The empty-batch branch must sit AFTER the account lookup, or a typo'd
    // accountKey silently returns 200 and nobody finds out.
    const res = await ingestContactsRoute(
      ingestRequest('/api/ingest/contacts', {
        accountKey: '__vitest_no_such_account__',
        contacts: [],
      }),
    );
    expect(res.status).toBe(404);
  });

  it('reports the bridged account as freshly synced', async () => {
    const { body } = await callHealth('&maxAgeHours=30');
    const b = find(body.accounts, bridged);
    expect(b.status).toBe('ok');
    expect(b.lastContactsRunAt).not.toBeNull();
    expect(b.lastEventsRunAt).not.toBeNull();
    expect(b.last24h.runs).toBe(2);
  });

  it('records a run row even when the batch changed nothing', async () => {
    // The whole point: a zero-change run must still leave a heartbeat, or a
    // quiet window is indistinguishable from a dead cron.
    await recordIngestRun({
      accountKey: fresh,
      kind: 'contacts',
      source: 'oz-reports:automotive',
      totalRows: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      issueCount: 0,
    });

    const runs = await prisma.ingestRun.findMany({ where: { accountKey: fresh } });
    expect(runs).toHaveLength(1);
    expect(runs[0].source).toBe('oz-reports:automotive');
    expect(runs[0].totalRows).toBe(0);
  });

  it('never throws when the run cannot be written', async () => {
    // Telemetry must not be able to fail an otherwise-good ingest — a throw
    // here would make the bridge retry and re-upsert the whole batch.
    await expect(
      recordIngestRun({
        accountKey: '__vitest_nonexistent_account__',
        kind: 'contacts',
        source: null,
        totalRows: 1,
        created: 1,
        updated: 0,
        skipped: 0,
        issueCount: 0,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects callers without the internal job secret', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/internal/contact-sync/health'),
    );
    expect(res.status).toBe(401);
  });

  it('classifies fresh, stale and never-synced accounts', async () => {
    const now = Date.now();
    await prisma.ingestRun.createMany({
      data: [
        // Fresh: contacts an hour ago, events two hours ago.
        {
          accountKey: fresh,
          kind: 'events',
          source: 'oz-reports:automotive',
          totalRows: 40,
          created: 5,
          updated: 35,
          skipped: 0,
          issueCount: 0,
          startedAt: new Date(now - 2 * 3_600_000),
        },
        {
          accountKey: fresh,
          kind: 'contacts',
          source: 'oz-reports:automotive',
          totalRows: 300,
          created: 3,
          updated: 297,
          skipped: 0,
          issueCount: 2,
          startedAt: new Date(now - 1 * 3_600_000),
        },
        // Stale: the cron died three days ago.
        {
          accountKey: stale,
          kind: 'contacts',
          source: 'oz-reports:automotive',
          totalRows: 120,
          created: 1,
          updated: 119,
          skipped: 0,
          issueCount: 0,
          startedAt: new Date(now - 72 * 3_600_000),
        },
      ],
    });

    const { status, body } = await callHealth('&maxAgeHours=30');
    expect(status).toBe(200);
    expect(body.maxAgeHours).toBe(30);

    const f = find(body.accounts, fresh);
    expect(f.status).toBe('ok');
    expect(f.hoursSinceLastRun).toBeLessThanOrEqual(2);
    // Per-kind freshness is tracked separately so a working contacts push
    // can't mask an events push that has stopped.
    expect(f.lastContactsRunAt).not.toBeNull();
    expect(f.lastEventsRunAt).not.toBeNull();
    // 24h rollup counts both of this account's recent runs.
    expect(f.last24h.runs).toBe(3); // 2 here + the zero-row run above
    expect(f.last24h.rows).toBe(340);
    expect(f.last24h.issues).toBe(2);

    const s = find(body.accounts, stale);
    expect(s.status).toBe('stale');
    expect(s.hoursSinceLastRun).toBeGreaterThan(70);
    expect(s.last24h.runs).toBe(0); // ran, but not recently — the giveaway

    const n = find(body.accounts, never);
    expect(n.status).toBe('never-synced');
    expect(n.hoursSinceLastRun).toBeNull();
    expect(n.contactCount).toBe(1);

    // A stale account is a FAILURE — it was syncing and stopped.
    const flagged = body.problems.map((p) => p.accountKey);
    expect(flagged).toContain(stale);
    expect(flagged).not.toContain(fresh);

    // A never-synced account is only a WARNING. Several YAG accounts are
    // parent entities with no CRM feed of their own: the bridge skips the POST
    // when a dealer has no rows, so they never produce a heartbeat. Failing on
    // them would alarm every day, which is how a monitor gets ignored.
    const warned = body.warnings.map((w) => w.accountKey);
    expect(warned).toContain(never);
    expect(flagged).not.toContain(never);

    // healthy is global, and this database may hold other accounts — assert
    // only that our own stale account is enough to sink it.
    expect(body.healthy).toBe(false);
  });

  it('honours a wider freshness threshold', async () => {
    // Same data, 96h window: the 3-day-old account is no longer stale.
    const { body } = await callHealth('&maxAgeHours=96');
    expect(find(body.accounts, stale).status).toBe('ok');
    expect(body.problems.map((p) => p.accountKey)).not.toContain(stale);
    // A missing run is never excused by a wider window — but it stays a
    // warning rather than becoming a failure.
    expect(find(body.accounts, never).status).toBe('never-synced');
    expect(body.warnings.map((w) => w.accountKey)).toContain(never);
  });

  it('a feed-less account alone does not make the check unhealthy', async () => {
    // Reproduces the four zero-candidate YAG parent accounts: contacts on file,
    // no runs, ever. With no stale accounts and runs existing somewhere, the
    // check must stay green.
    const { body } = await callHealth('&maxAgeHours=96');
    expect(body.neverSyncedCount).toBeGreaterThan(0);
    expect(body.runsAllTime).toBeGreaterThan(0);
    expect(body.staleCount).toBe(0);
    expect(body.healthy).toBe(true);
  });

  it('drops ignored accounts from the check entirely', async () => {
    // Parked rooftops (out of the sync on purpose) must not appear at all —
    // not as problems, not as warnings. Otherwise the warning list stops
    // meaning "unexpected" and gets skimmed past.
    const { body } = await callHealth(`&maxAgeHours=30&ignore=${stale},${never}`);

    expect(body.ignored).toEqual([stale, never]);
    expect(body.accounts.map((a) => a.accountKey)).not.toContain(stale);
    expect(body.accounts.map((a) => a.accountKey)).not.toContain(never);
    expect(body.problems.map((p) => p.accountKey)).not.toContain(stale);
    expect(body.warnings.map((w) => w.accountKey)).not.toContain(never);

    // The accounts that are still in scope are unaffected.
    expect(find(body.accounts, fresh).status).toBe('ok');
    expect(find(body.accounts, bridged).status).toBe('ok');
  });

  it('does not prune when retention is disabled', async () => {
    const { body } = await callHealth();
    expect(body.pruned).toBe(0);
  });
});
