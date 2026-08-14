// DB-backed tests for the audience sync run: resolve → gate → diff →
// record.
//
// The diff is the part worth testing hard. Everything downstream trusts
// it: an add that doesn't happen is a customer who never sees the ad, a
// remove that doesn't happen is someone still being targeted after they
// left the segment, and a membership row written for an upload that
// failed means neither ever gets retried.
//
// Self-skips unless RUN_DB_TESTS=1.  Run with:  RUN_DB_TESTS=1 npm test
import 'dotenv/config';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { runAudienceSync } from './run';
import type { FilterDefinition } from '@/lib/smart-list-types';

const RUN = !!process.env.RUN_DB_TESTS;
const ACCOUNT = '__vitest_sync';

/** Segment: contacts tagged 'target'. */
const DEFINITION: FilterDefinition = {
  version: 1,
  logic: 'AND',
  groups: [
    {
      id: 'g',
      logic: 'AND',
      conditions: [
        { id: 'c', field: 'tags', operator: 'includes_any', value: 'target' },
      ],
    },
  ],
};

async function reset() {
  await prisma.audienceSyncRun.deleteMany({
    where: { sync: { accountKey: ACCOUNT } },
  });
  await prisma.audienceSyncMember.deleteMany({
    where: { sync: { accountKey: ACCOUNT } },
  });
  await prisma.audienceSync.deleteMany({ where: { accountKey: ACCOUNT } });
  await prisma.audience.deleteMany({ where: { accountKey: ACCOUNT } });
  await prisma.contact.deleteMany({ where: { accountKey: ACCOUNT } });
  await prisma.account.deleteMany({ where: { key: ACCOUNT } });
}

async function setup(opts: { consent?: boolean } = {}) {
  await reset();
  await prisma.account.create({
    data: {
      key: ACCOUNT,
      dealer: 'Vitest Sync',
      ...(opts.consent === false
        ? {}
        : {
            audienceSyncConsentBasis: 'first_party_disclosure',
            audienceSyncConsentAt: new Date(),
          }),
    },
  });
  const audience = await prisma.audience.create({
    data: {
      name: '__vitest Target Segment',
      accountKey: ACCOUNT,
      filters: JSON.stringify(DEFINITION),
    },
    select: { id: true },
  });
  const sync = await prisma.audienceSync.create({
    data: {
      audienceId: audience.id,
      accountKey: ACCOUNT,
      provider: 'dry_run',
      status: 'active',
      schedule: 'manual',
    },
    select: { id: true },
  });
  return { audienceId: audience.id, syncId: sync.id };
}

async function addContact(email: string, tags: string[]) {
  return prisma.contact.create({
    data: { accountKey: ACCOUNT, email, tags },
    select: { id: true },
  });
}

describe.skipIf(!RUN)('audience sync run', () => {
  let syncId = '';

  beforeEach(async () => {
    ({ syncId } = await setup());
  });

  afterAll(reset);

  it('first run adds every eligible member', async () => {
    await addContact('a@example.com', ['target']);
    await addContact('b@example.com', ['target']);
    await addContact('c@example.com', ['other']);

    const result = await runAudienceSync(syncId);
    expect(result.status).toBe('success');
    expect(result.added).toBe(2);
    expect(result.removed).toBe(0);
    expect(result.total).toBe(2);
    // The only adapter wired is the dry run, so nothing left the building.
    expect(result.dryRun).toBe(true);

    const members = await prisma.audienceSyncMember.count({ where: { syncId } });
    expect(members).toBe(2);
  });

  it('a second run with no changes adds and removes nothing', async () => {
    await addContact('a@example.com', ['target']);
    await runAudienceSync(syncId);

    const second = await runAudienceSync(syncId);
    expect(second.added).toBe(0);
    expect(second.removed).toBe(0);
    // …but still records a run, so "nothing changed" stays
    // distinguishable from "stopped running".
    const runs = await prisma.audienceSyncRun.count({ where: { syncId } });
    expect(runs).toBe(2);
  });

  it('drops members that left the segment', async () => {
    const a = await addContact('a@example.com', ['target']);
    await addContact('b@example.com', ['target']);
    await runAudienceSync(syncId);

    // A leaves the segment.
    await prisma.contact.update({ where: { id: a.id }, data: { tags: ['other'] } });

    const result = await runAudienceSync(syncId);
    expect(result.removed).toBe(1);
    expect(result.added).toBe(0);
    expect(result.total).toBe(1);

    const remaining = await prisma.audienceSyncMember.findMany({
      where: { syncId },
      select: { contactId: true },
    });
    expect(remaining.map((m) => m.contactId)).not.toContain(a.id);
  });

  it('treats a changed email as remove + add', async () => {
    const a = await addContact('old@example.com', ['target']);
    await runAudienceSync(syncId);

    // The platform has no idea these are the same person — the old hash
    // has to come out and the new one go in.
    await prisma.contact.update({
      where: { id: a.id },
      data: { email: 'new@example.com' },
    });

    const result = await runAudienceSync(syncId);
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.total).toBe(1);
  });

  it('records the eligibility breakdown on the run', async () => {
    await addContact('good@example.com', ['target']);
    await prisma.contact.create({
      data: {
        accountKey: ACCOUNT,
        email: 'gone@example.com',
        tags: ['target'],
        dnd: { email: true },
      },
    });

    await runAudienceSync(syncId);
    const run = await prisma.audienceSyncRun.findFirst({
      where: { syncId },
      orderBy: { startedAt: 'desc' },
    });
    expect(run?.segmentSize).toBe(2);
    expect(run?.eligible).toBe(1);
    expect(run?.excludedOptedOut).toBe(1);
  });

  it('records a failed run instead of throwing when consent is missing', async () => {
    await prisma.account.update({
      where: { key: ACCOUNT },
      data: { audienceSyncConsentBasis: null, audienceSyncConsentAt: null },
    });
    await addContact('a@example.com', ['target']);

    const result = await runAudienceSync(syncId);
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/consent/i);

    // Nothing was recorded as a member — a failed run must not leave the
    // baseline believing those contacts are live, or the next run would
    // never resend them.
    expect(await prisma.audienceSyncMember.count({ where: { syncId } })).toBe(0);

    const sync = await prisma.audienceSync.findUnique({ where: { id: syncId } });
    expect(sync?.status).toBe('error');
    expect(sync?.lastError).toMatch(/consent/i);
  });

  it('refuses a segment with no conditions rather than emptying the list', async () => {
    await addContact('a@example.com', ['target']);
    await runAudienceSync(syncId);

    const sync = await prisma.audienceSync.findUnique({
      where: { id: syncId },
      select: { audienceId: true },
    });
    // Someone half-saves a segment. Under the fail-closed engine that
    // resolves to nobody — which must NOT be read as an instruction to
    // clear the remote audience.
    await prisma.audience.update({
      where: { id: sync!.audienceId },
      data: { filters: JSON.stringify({ version: 1, logic: 'AND', groups: [] }) },
    });

    const result = await runAudienceSync(syncId);
    expect(result.status).toBe('skipped');
    expect(result.skipReason).toBe('segment_has_no_conditions');
    // Membership untouched.
    expect(await prisma.audienceSyncMember.count({ where: { syncId } })).toBe(1);
  });

  it('records the delta but uploads nothing for a provider with no adapter', async () => {
    // Meta has no adapter yet. (google_ads does, as of the Customer
    // Match work — see the next case.)
    await prisma.audienceSync.update({
      where: { id: syncId },
      data: { provider: 'meta' },
    });
    await addContact('a@example.com', ['target']);

    const result = await runAudienceSync(syncId);
    expect(result.status).toBe('skipped');
    expect(result.skipReason).toBe('no_adapter_for_meta');
    expect(result.added).toBe(1);
    expect(result.dryRun).toBe(true);

    // Crucially, membership is NOT recorded — the next run must still
    // see these as pending once the adapter exists.
    expect(await prisma.audienceSyncMember.count({ where: { syncId } })).toBe(0);
  });

  it('fails loudly, and records nothing, when Google credentials are absent', async () => {
    // google_ads now resolves a real adapter, so the run genuinely
    // attempts an upload. Without credentials it must fail with a clear
    // reason rather than silently succeeding — and above all it must not
    // record membership it never actually sent.
    await prisma.audienceSync.update({
      where: { id: syncId },
      data: { provider: 'google_ads' },
    });
    await addContact('a@example.com', ['target']);

    const result = await runAudienceSync(syncId);
    expect(result.status).toBe('failed');
    expect(result.error).toBeTruthy();
    expect(await prisma.audienceSyncMember.count({ where: { syncId } })).toBe(0);

    // The failure is recorded on the sync itself, so a broken
    // destination is visible without reading logs.
    const after = await prisma.audienceSync.findUnique({ where: { id: syncId } });
    expect(after!.status).toBe('error');
    expect(after!.lastError).toBeTruthy();
  });
});
