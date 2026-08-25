// A segment resolved from a GROUP account must roll up its rooftops.
//
// The bug this pins: a group account (Young Powersports, Young Automotive
// Group) owns no contacts of its own — every contact hangs off a rooftop
// beneath it. The segment builder resolved against the selected account's
// own key alone, so a filter matching thousands of people one level down
// previewed as "0 contacts match, 0% of 0 total". Nothing on screen said
// the number was scoped to an account that holds nobody.
//
// Two properties are asserted, because a naive `accountKey IN (...)` gets
// the first and fails the second:
//
//   1. The group's count is the union of its rooftops.
//   2. It counts PEOPLE, not rows. Contacts are unique per
//      (accountKey, email), so a shopper who bought at two rooftops is
//      two rows and must still count once — the same grouping the group
//      Contacts list uses, or the preview and the list it links to would
//      disagree.
//
// Self-skips unless RUN_DB_TESTS=1, per the convention in
// vitest.config.ts.  Run with:  RUN_DB_TESTS=1 npm test
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { listContactsPaged } from '@/lib/contacts/queries';
import { getFilterableFields, type FilterDefinition } from '@/lib/smart-list-types';
import { countSegment } from './resolve';
import { countSegmentForAccounts, previewSegmentForAccounts } from './lookup';

const RUN = !!process.env.RUN_DB_TESTS;

const GROUP = '__vitest_rollup_group';
const ROOFTOP_A = '__vitest_rollup_a';
const ROOFTOP_B = '__vitest_rollup_b';
const ALL_KEYS = [GROUP, ROOFTOP_A, ROOFTOP_B];

const day = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * day);

const fields = getFilterableFields(null);

/** "Purchase Date is before <today>" — the filter from the bug report. */
const BOUGHT_BEFORE_TODAY: FilterDefinition = {
  version: 1,
  logic: 'AND',
  groups: [
    {
      id: 'g',
      logic: 'AND',
      conditions: [
        {
          id: 'c0',
          field: 'purchaseDate',
          operator: 'before',
          value: new Date().toISOString().slice(0, 10),
          value2: undefined,
        },
      ],
    },
  ],
};

async function seed(accountKey: string, rows: Array<{ email: string; purchaseDate: Date | null }>) {
  for (const row of rows) {
    await prisma.contact.create({
      data: {
        accountKey,
        email: row.email,
        purchaseDate: row.purchaseDate,
        dateAdded: daysAgo(30),
      },
      select: { id: true },
    });
  }
}

describe.skipIf(!RUN)('segment resolution rolls up a group account', () => {
  beforeAll(async () => {
    await prisma.contact.deleteMany({ where: { accountKey: { in: ALL_KEYS } } });
    await prisma.account.deleteMany({ where: { key: { in: ALL_KEYS } } });
    await prisma.account.create({ data: { key: GROUP, dealer: 'Vitest Group' } });
    await prisma.account.create({
      data: { key: ROOFTOP_A, dealer: 'Vitest Rooftop A', parentAccountKey: GROUP },
    });
    await prisma.account.create({
      data: { key: ROOFTOP_B, dealer: 'Vitest Rooftop B', parentAccountKey: GROUP },
    });

    // Three buyers at A, two at B — and `shared@` bought at both, so the
    // row count (5) and the people count (4) differ on purpose.
    await seed(ROOFTOP_A, [
      { email: 'a1@example.com', purchaseDate: daysAgo(30) },
      { email: 'a2@example.com', purchaseDate: daysAgo(400) },
      { email: 'shared@example.com', purchaseDate: daysAgo(10) },
      { email: 'never@example.com', purchaseDate: null },
    ]);
    await seed(ROOFTOP_B, [
      { email: 'b1@example.com', purchaseDate: daysAgo(5) },
      { email: 'shared@example.com', purchaseDate: daysAgo(200) },
    ]);
  });

  afterAll(async () => {
    await prisma.contact.deleteMany({ where: { accountKey: { in: ALL_KEYS } } });
    await prisma.account.deleteMany({ where: { key: { in: ALL_KEYS } } });
  });

  it('the group itself holds no contacts — the old single-key path', async () => {
    // Not a regression to fix in `countSegment`: scoping to one account is
    // exactly what it promises. This is the number the builder was showing.
    const own = await countSegment(GROUP, BOUGHT_BEFORE_TODAY, fields);
    expect(own.count).toBe(0);
  });

  it('counts distinct people across the subtree', async () => {
    const rolled = await countSegmentForAccounts(BOUGHT_BEFORE_TODAY, [
      GROUP,
      ROOFTOP_A,
      ROOFTOP_B,
    ]);
    // a1, a2, b1 and shared — five matching ROWS, four people.
    expect(rolled.count).toBe(4);
    expect(rolled.errors).toEqual([]);
    expect(rolled.strategy).toBe('sql');
  });

  it('a single rooftop is unchanged by the cross-account path', async () => {
    const single = await countSegmentForAccounts(BOUGHT_BEFORE_TODAY, [ROOFTOP_A]);
    const legacy = await countSegment(ROOFTOP_A, BOUGHT_BEFORE_TODAY, fields);
    expect(single.count).toBe(legacy.count);
    expect(single.count).toBe(3);
  });

  it('previews the roll-up with a sample, a roster total and reachability', async () => {
    const preview = await previewSegmentForAccounts(
      BOUGHT_BEFORE_TODAY,
      [GROUP, ROOFTOP_A, ROOFTOP_B],
      { sampleSize: 10 },
    );
    expect(preview.count).toBe(4);
    // Five people across the two rooftops (never@ included, shared@ once).
    expect(preview.accountTotal).toBe(5);
    // Everyone seeded has an email, nobody has a phone.
    expect(preview.reachable.email).toBe(4);
    expect(preview.reachable.phone).toBe(0);
    // The sample is one row per person, drawn from both rooftops.
    expect(preview.contacts).toHaveLength(4);
    const emails = preview.contacts.map((c) => c.email.toLowerCase()).sort();
    expect(emails).toEqual([
      'a1@example.com',
      'a2@example.com',
      'b1@example.com',
      'shared@example.com',
    ]);
  });

  it('agrees with the Contacts list it links to', async () => {
    // The number in the preview and the number of rows behind "View
    // contacts" have to be the same, or fixing the roll-up just moves the
    // discrepancy one click to the right. Both group by contact identity.
    const rolled = await countSegmentForAccounts(BOUGHT_BEFORE_TODAY, [
      GROUP,
      ROOFTOP_A,
      ROOFTOP_B,
    ]);
    const page = await listContactsPaged({
      accountKeys: [GROUP, ROOFTOP_A, ROOFTOP_B],
      pageSize: 50,
    });
    expect(page.total).toBe(5);
    expect(rolled.count).toBe(4);
    // …and the person who bought at both rooftops is one row carrying both.
    const shared = page.contacts.find((c) => c.email.toLowerCase() === 'shared@example.com');
    expect(shared?._accountKeys.sort()).toEqual([ROOFTOP_A, ROOFTOP_B].sort());
  });

  it('an empty scope resolves to nothing rather than everything', async () => {
    // The predicate builder must not degrade to a bare WHERE — this is the
    // case where "no clauses" could have meant "match the whole table".
    const none = await countSegmentForAccounts(BOUGHT_BEFORE_TODAY, []);
    expect(none.count).toBe(0);
  });
});
