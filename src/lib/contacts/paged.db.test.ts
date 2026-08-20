// DB-backed tests for the paged, cross-account contacts query.
// Self-skip unless RUN_DB_TESTS=1 so `npm test` stays green without a
// database. Run locally with:  RUN_DB_TESTS=1 npm test
//
// The thing under test is the SQL identity grouping. The group Contacts view
// used to pull every contact from every rooftop into the browser and dedupe
// there; `listContactsPaged` moves that into one query so the page size is
// meaningful. If the grouping is wrong the page silently shows the wrong
// PEOPLE — duplicated, or merged when they shouldn't be — and no error fires.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { listContactsPaged } from './queries';

const RUN = !!process.env.RUN_DB_TESTS;
const SOURCE = '__vitest_paged__';
const A = '__vitest_paged_a';
const B = '__vitest_paged_b';

async function wipe() {
  await prisma.contact.deleteMany({ where: { source: SOURCE } });
  await prisma.account.deleteMany({ where: { key: { in: [A, B] } } });
}

describe.skipIf(!RUN)('listContactsPaged', () => {
  beforeAll(async () => {
    await wipe();
    // Contact.accountKey is FK'd to Account.key, so the rooftops have to exist.
    await prisma.account.createMany({
      data: [
        { key: A, dealer: 'Vitest Rooftop A' },
        { key: B, dealer: 'Vitest Rooftop B' },
      ],
    });
    const day = (n: number) => new Date(Date.UTC(2026, 0, n));
    await prisma.contact.createMany({
      data: [
        // Same shopper, two rooftops, same email in different case.
        { accountKey: A, firstName: 'Ada', lastName: 'Email', email: 'ada@example.com', source: SOURCE, dateAdded: day(5) },
        { accountKey: B, firstName: 'Ada', lastName: 'Email', email: 'ADA@example.com', source: SOURCE, dateAdded: day(4) },
        // Same shopper, two rooftops, no email, phone written two ways.
        { accountKey: A, firstName: 'Bo', lastName: 'Phone', phone: '(801) 555-0100', source: SOURCE, dateAdded: day(3) },
        { accountKey: B, firstName: 'Bo', lastName: 'Phone', phone: '+18015550100', source: SOURCE, dateAdded: day(2) },
        // Neither email nor phone — nothing to merge on.
        { accountKey: A, firstName: 'Cy', lastName: 'Ghost', source: SOURCE, dateAdded: day(1) },
        { accountKey: B, firstName: 'Di', lastName: 'Ghost', source: SOURCE, dateAdded: day(1) },
      ],
    });
  });

  afterAll(async () => {
    await wipe();
  });

  it('counts distinct people, not rows', async () => {
    const res = await listContactsPaged({ accountKeys: [A, B], pageSize: 50, search: SOURCE });
    // 6 rows in, 4 people out: Ada, Bo, Cy, Di.
    expect(res.total).toBe(4);
    expect(res.contacts).toHaveLength(4);
  });

  it('merges one shopper across rooftops on a case-insensitive email', async () => {
    const res = await listContactsPaged({ accountKeys: [A, B], pageSize: 50, search: SOURCE });
    const ada = res.contacts.find((c) => c.lastName === 'Email');
    expect(ada?._accountKeys.sort()).toEqual([A, B]);
  });

  it('merges on phone across formatting differences', async () => {
    const res = await listContactsPaged({ accountKeys: [A, B], pageSize: 50, search: SOURCE });
    const bo = res.contacts.find((c) => c.lastName === 'Phone');
    expect(bo?._accountKeys.sort()).toEqual([A, B]);
  });

  it('does NOT merge rows that have no email and no phone', async () => {
    const res = await listContactsPaged({ accountKeys: [A, B], pageSize: 50, search: SOURCE });
    const ghosts = res.contacts.filter((c) => c.lastName === 'Ghost');
    expect(ghosts).toHaveLength(2);
    // Each keyed to itself, so each carries exactly its own rooftop.
    for (const g of ghosts) expect(g._accountKeys).toHaveLength(1);
  });

  it('paginates over PEOPLE with no repeats across pages', async () => {
    const p0 = await listContactsPaged({ accountKeys: [A, B], page: 0, pageSize: 2, search: SOURCE });
    const p1 = await listContactsPaged({ accountKeys: [A, B], page: 1, pageSize: 2, search: SOURCE });
    expect(p0.total).toBe(4);
    expect(p1.total).toBe(4);
    expect(p0.contacts).toHaveLength(2);
    expect(p1.contacts).toHaveLength(2);
    const ids = [...p0.contacts, ...p1.contacts].map((c) => c.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('scopes to the accounts asked for', async () => {
    const res = await listContactsPaged({ accountKeys: [A], pageSize: 50, search: SOURCE });
    // Ada and Bo still appear (their A-side row), plus Cy. Di is B-only.
    expect(res.total).toBe(3);
    for (const c of res.contacts) expect(c._accountKeys).toEqual([A]);
  });

  it('returns an empty page rather than querying for an empty scope', async () => {
    const res = await listContactsPaged({ accountKeys: [], pageSize: 50 });
    expect(res).toMatchObject({ contacts: [], total: 0 });
  });

  it('sorts by recency across the whole set, newest first', async () => {
    const res = await listContactsPaged({
      accountKeys: [A, B], pageSize: 50, search: SOURCE, sort: 'dateAdded', dir: 'desc',
    });
    // Ada Jan-5, Bo Jan-3, then the two Jan-1 ghosts.
    expect(res.contacts.slice(0, 2).map((c) => c.lastName)).toEqual(['Email', 'Phone']);
  });

  it('reverses when asked', async () => {
    const res = await listContactsPaged({
      accountKeys: [A, B], pageSize: 50, search: SOURCE, sort: 'dateAdded', dir: 'asc',
    });
    expect(res.contacts.at(-1)?.lastName).toBe('Email');
  });

  it('sorts by name across PAGES, not just within one', async () => {
    // The bug this guards: client-side sort over a server-paginated slice
    // orders only the visible rows, so page 2 can start before page 1 ended.
    const p0 = await listContactsPaged({
      accountKeys: [A, B], page: 0, pageSize: 2, search: SOURCE, sort: 'fullName', dir: 'asc',
    });
    const p1 = await listContactsPaged({
      accountKeys: [A, B], page: 1, pageSize: 2, search: SOURCE, sort: 'fullName', dir: 'asc',
    });
    const names = [...p0.contacts, ...p1.contacts].map((c) => c.firstName);
    expect(names).toEqual([...names].sort());
  });

  it('falls back to the default sort for an unknown key', async () => {
    const res = await listContactsPaged({
      accountKeys: [A, B], pageSize: 50, search: SOURCE,
      sort: 'bogus; DROP TABLE "Contact"' as never,
    });
    expect(res.total).toBe(4);
  });

  it('matches a phone search on digits, ignoring punctuation', async () => {
    const res = await listContactsPaged({ accountKeys: [A, B], pageSize: 50, search: '8015550100' });
    expect(res.contacts.some((c) => c.lastName === 'Phone')).toBe(true);
  });
});
