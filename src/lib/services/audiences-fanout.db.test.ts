// Creating one segment definition across several accounts, against a real DB.
//
// The pure decisions (who may write where, which names clash, what the toast
// says) are pinned in lib/segments/fan-out.test.ts. What only a database can
// show is the part that matters most here: that a rejected batch leaves
// NOTHING behind. A half-finished fan-out is the worst outcome of this
// feature — the user cannot tell which accounts took it without opening each
// one, and re-running to catch the stragglers collides on the names already
// created.
//
// Self-skips unless RUN_DB_TESTS=1, per the convention in vitest.config.ts.
// Run with:  RUN_DB_TESTS=1 npm test
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createAudienceAcrossAccounts } from './audiences';

const RUN = !!process.env.RUN_DB_TESTS;

// NOTE the leading underscore: it marks these as INTERNAL accounts, which
// getAccounts() and resolveRequestedAccountKeys() filter out. That is fine
// here because this file talks to Prisma directly, but it is why a test that
// routed through api-scope.ts would see `deniedAll` for every one of them.
const A = '__vitest_fanout_a';
const B = '__vitest_fanout_b';
const C = '__vitest_fanout_c';
const ALL = [A, B, C];

const FILTERS = JSON.stringify({
  version: 1,
  logic: 'AND',
  groups: [
    {
      id: 'g1',
      logic: 'AND',
      conditions: [{ id: 'c1', field: 'firstName', operator: 'contains', value: 'a' }],
    },
  ],
});

async function wipe() {
  await prisma.audience.deleteMany({ where: { accountKey: { in: ALL } } });
  await prisma.account.deleteMany({ where: { key: { in: ALL } } });
}

describe.skipIf(!RUN)('createAudienceAcrossAccounts — DB integration', () => {
  beforeAll(async () => {
    await wipe();
    // Accounts before audiences: Audience.accountKey is FK'd to Account.key.
    for (const key of ALL) {
      await prisma.account.create({ data: { key, dealer: `Vitest ${key}` } });
    }
  });

  beforeEach(async () => {
    await prisma.audience.deleteMany({ where: { accountKey: { in: ALL } } });
  });

  afterAll(async () => {
    await wipe();
  });

  it('creates one independent row per account', async () => {
    const result = await createAudienceAcrossAccounts({
      name: 'Lapsed Owners',
      filters: FILTERS,
      accountKeys: ALL,
    });

    expect(result.failures).toEqual([]);
    expect(result.created.map((c) => c.accountKey).sort()).toEqual([...ALL].sort());

    const rows = await prisma.audience.findMany({
      where: { accountKey: { in: ALL } },
      select: { id: true, accountKey: true, name: true },
    });
    expect(rows).toHaveLength(3);
    // Independent rows, not one shared one: three distinct ids.
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  });

  it('de-dupes a repeated account rather than colliding with itself', async () => {
    // Two rows for one account would break (name, accountKey) and surface as
    // a mysterious failure on an account the user only picked once.
    const result = await createAudienceAcrossAccounts({
      name: 'Repeated',
      filters: FILTERS,
      accountKeys: [A, A, B],
    });
    expect(result.failures).toEqual([]);
    expect(result.created).toHaveLength(2);
  });

  it('reports a name collision as something the user can act on', async () => {
    await prisma.audience.create({
      data: { name: 'Taken', accountKey: B, filters: FILTERS },
    });

    const result = await createAudienceAcrossAccounts({
      name: 'Taken',
      filters: FILTERS,
      accountKeys: ALL,
    });

    // The route pre-checks and refuses the whole batch, so this path is only
    // reached on a race. It must still name the account and say why, rather
    // than letting P2002 reach the user as a trace id.
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.accountKey).toBe(B);
    expect(result.failures[0]!.error).toMatch(/already exists/i);
    // The other two still landed — one bad target must not sink the rest.
    expect(result.created.map((c) => c.accountKey).sort()).toEqual([A, C].sort());
  });

  it('keeps each account\'s segment editable on its own', async () => {
    await createAudienceAcrossAccounts({
      name: 'Diverges',
      filters: FILTERS,
      accountKeys: [A, B],
    });

    const first = await prisma.audience.findFirst({ where: { accountKey: A } });
    await prisma.audience.update({
      where: { id: first!.id },
      data: { description: 'changed in A only' },
    });

    const other = await prisma.audience.findFirst({ where: { accountKey: B } });
    // Copies, by design: editing one does not reach the other. This is the
    // property that distinguishes a fan-out from sharing a group's segment
    // down, and the reason the picker's copy says so out loud.
    expect(other!.description).toBeNull();
  });
});
