// DB-backed integration tests for the budget ledger (docs/budget-module.md).
// Self-skip unless RUN_DB_TESTS=1 so `npm test` stays green without a
// database. Run locally with:  RUN_DB_TESTS=1 npm test
//
// Requires DATABASE_URL. Creates rows under a unique key prefix and
// cascade-deletes them in afterAll.
//
// These cover the arithmetic, not the plumbing — this is money code, and the
// failure modes that matter (a re-derived markup rewriting history, money
// vanishing on a release, a Google/YouTube split double-counting into the
// pacer) are all sum-level bugs that typecheck perfectly.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import * as budget from './budget';

const RUN = !!process.env.RUN_DB_TESTS;
const PREFIX = '__vitest_budget_';
const acctA = `${PREFIX}a`;
const acctB = `${PREFIX}b`;
const YEAR = 2031; // far future — can't collide with real data

const toN = (d: unknown) => Number(d);

/** A full-calendar-year agreement, which is what most tests want. */
function agreement(accountKey: string, over: Partial<budget.AgreementInput> = {}) {
  return budget.createAgreement({
    accountKey,
    name: 'Vitest Agreement',
    startDate: `${YEAR}-01-01`,
    endDate: `${YEAR}-12-31`,
    ...over,
  });
}

describe.skipIf(!RUN)('budget ledger — DB integration', () => {
  beforeAll(async () => {
    await prisma.account.deleteMany({ where: { key: { startsWith: PREFIX } } });
    await prisma.account.createMany({
      data: [
        { key: acctA, dealer: 'Vitest Budget A', markup: 0.8 },
        { key: acctB, dealer: 'Vitest Budget B', markup: 0.5 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.account.deleteMany({ where: { key: { startsWith: PREFIX } } });
  });

  beforeEach(async () => {
    // Lines cascade from the account, but each test wants a clean year.
    await prisma.budgetLine.deleteMany({ where: { accountKey: { startsWith: PREFIX } } });
    await prisma.clientAgreement.deleteMany({ where: { accountKey: { startsWith: PREFIX } } });
    // Pacer plans too — the Phase 3 tests set managedByBudget, and a leaked
    // flag would make an earlier test's state decide a later one's result.
    await prisma.metaAdsPacerPlan.deleteMany({
      where: { accountKey: { startsWith: PREFIX } },
    });
  });

  // ── Markup snapshot ──

  it('freezes markup on the line so a later account change cannot rewrite it', async () => {
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-03`, channel: 'meta', amount: 1000 },
      null,
    );
    expect(line.markupSnapshot).toBe(0.8);
    expect(line.spendTarget).toBeCloseTo(800, 2);

    await prisma.account.update({ where: { key: acctA }, data: { markup: 0.6 } });
    const after = await budget.getLine(line.id);
    expect(after!.markupSnapshot).toBe(0.8); // unchanged — this is the point
    expect(after!.spendTarget).toBeCloseTo(800, 2);

    // A NEW line picks up the new rate; only history is frozen.
    const fresh = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-04`, channel: 'meta', amount: 1000 },
      null,
    );
    expect(fresh.markupSnapshot).toBe(0.6);

    await prisma.account.update({ where: { key: acctA }, data: { markup: 0.8 } });
  });

  it('prefers an explicit per-line markup over the account rate', async () => {
    // A radio buy whose margin differs from the account's digital rate.
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-03`, channel: 'radio', amount: 1000, markup: 0.9 },
      null,
    );
    expect(line.markupSnapshot).toBe(0.9);
  });

  it('prefers the agreement default over the account rate', async () => {
    await agreement(acctA, { defaultMarkup: 0.7 });
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-03`, channel: 'meta', amount: 1000 },
      null,
    );
    expect(line.markupSnapshot).toBe(0.7);
  });

  // ── Invariants ──

  it('rejects a year that disagrees with the period', async () => {
    await expect(
      budget.createLine(
        { accountKey: acctA, year: YEAR + 1, period: `${YEAR}-03`, channel: 'meta', amount: 100 },
        null,
      ),
    ).rejects.toThrow(/disagrees/);
  });

  it('rejects an unknown channel', async () => {
    // Deliberately nonsense — 'tiktok' used to stand in here and became a real
    // channel when the registry grew to mirror Oz Reports' 44.
    await expect(
      budget.createLine(
        { accountKey: acctA, period: `${YEAR}-03`, channel: 'carrier_pigeon', amount: 100 },
        null,
      ),
    ).rejects.toThrow(/Unknown budget channel/);
  });

  it('stores a pool line with its year and no placement', async () => {
    const line = await budget.createLine(
      { accountKey: acctA, year: YEAR, amount: 5000, source: 'pool', status: 'committed' },
      null,
    );
    expect(line.period).toBeNull();
    expect(line.channel).toBeNull();
    expect(line.year).toBe(YEAR);
    expect(line.isPool).toBe(true);
  });

  // ── Summary math ──

  it('separates allocated from pool and flags over-allocation', async () => {
    await agreement(acctA, { committedAmount: 10_000 });
    await budget.createLines(
      [
        { accountKey: acctA, period: `${YEAR}-01`, channel: 'meta', amount: 3000, status: 'committed' },
        { accountKey: acctA, period: `${YEAR}-02`, channel: 'google', amount: 2000, status: 'committed' },
        { accountKey: acctA, year: YEAR, amount: 1000, status: 'committed', source: 'pool' },
        // `planned` is deliberately excluded from every rollup.
        { accountKey: acctA, period: `${YEAR}-03`, channel: 'meta', amount: 9999, status: 'planned' },
      ],
      null,
    );

    const s = await budget.getAccountSummary(acctA, YEAR);
    expect(s.allocated).toBe(5000);
    expect(s.pool).toBe(1000);
    expect(s.totalCommitted).toBe(6000);
    expect(s.unplanned).toBe(4000);
    expect(s.overAllocated).toBe(false);

    // Push past the declared total — a warning state, never an error.
    await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-04`, channel: 'meta', amount: 5000, status: 'committed' },
      null,
    );
    const over = await budget.getAccountSummary(acctA, YEAR);
    expect(over.totalCommitted).toBe(11_000);
    expect(over.unplanned).toBe(-1000);
    expect(over.overAllocated).toBe(true);
  });

  it('reports no over-allocation when the account has no declared total', async () => {
    await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-01`, channel: 'meta', amount: 50_000, status: 'committed' },
      null,
    );
    const s = await budget.getAccountSummary(acctA, YEAR);
    expect(s.declaredTotal).toBeNull();
    expect(s.unplanned).toBeNull();
    expect(s.overAllocated).toBe(false);
  });

  it('groups by channel and period using each line’s own markup', async () => {
    await budget.createLines(
      [
        { accountKey: acctA, period: `${YEAR}-01`, channel: 'meta', amount: 1000, status: 'committed' },
        { accountKey: acctA, period: `${YEAR}-01`, channel: 'meta', amount: 500, status: 'committed' },
        { accountKey: acctA, period: `${YEAR}-02`, channel: 'radio', amount: 2000, markup: 1, status: 'committed' },
      ],
      null,
    );
    const s = await budget.getAccountSummary(acctA, YEAR);
    const meta = s.byChannel.find((c) => c.channel === 'meta')!;
    expect(meta.amount).toBe(1500);
    expect(meta.spendTarget).toBeCloseTo(1200, 2); // 1500 × 0.8
    const radio = s.byChannel.find((c) => c.channel === 'radio')!;
    expect(radio.spendTarget).toBeCloseTo(2000, 2); // markup 1 — no agency cut
    expect(s.byPeriod.map((p) => p.period)).toEqual([`${YEAR}-01`, `${YEAR}-02`]);
  });

  // ── Allocation ──

  it('splits a pool line, leaving the remainder in the pool', async () => {
    const pool = await budget.createLine(
      { accountKey: acctA, year: YEAR, amount: 10_000, status: 'committed', source: 'pool' },
      null,
    );
    const res = await budget.allocateFromLine(
      pool.id,
      { amount: 4000, period: `${YEAR}-06`, channel: 'meta' },
      null,
    );
    expect(res!.allocated.amount).toBe(4000);
    expect(res!.allocated.period).toBe(`${YEAR}-06`);
    expect(res!.source.amount).toBe(6000);

    // The account's total is unchanged — money moved, it didn't multiply.
    const s = await budget.getAccountSummary(acctA, YEAR);
    expect(s.totalCommitted).toBe(10_000);
    expect(s.allocated).toBe(4000);
    expect(s.pool).toBe(6000);
  });

  it('carries the source markup onto the child rather than re-resolving', async () => {
    const pool = await budget.createLine(
      { accountKey: acctA, year: YEAR, amount: 1000, markup: 0.42, status: 'committed' },
      null,
    );
    const res = await budget.allocateFromLine(
      pool.id,
      { amount: 500, period: `${YEAR}-06`, channel: 'meta' },
      null,
    );
    // Re-resolving here would let a markup change leak into old money by the
    // back door — the split isn't a new commitment.
    expect(res!.allocated.markupSnapshot).toBe(0.42);
  });

  it('archives a fully-drained source and links both sides of the split', async () => {
    const pool = await budget.createLine(
      { accountKey: acctA, year: YEAR, amount: 2000, status: 'committed' },
      null,
    );
    const res = await budget.allocateFromLine(
      pool.id,
      { amount: 2000, period: `${YEAR}-07`, channel: 'google' },
      null,
    );
    expect(res!.source.amount).toBe(0);

    const srcRow = await prisma.budgetLine.findUnique({ where: { id: pool.id } });
    expect(srcRow!.archivedAt).not.toBeNull();

    const srcEvents = await budget.listLineEvents(pool.id);
    const alloc = srcEvents.find((e) => e.action === 'allocated')!;
    expect(alloc.counterpartyLineId).toBe(res!.allocated.id);
    const dstEvents = await budget.listLineEvents(res!.allocated.id);
    expect(dstEvents[0]!.counterpartyLineId).toBe(pool.id);
    expect(dstEvents[0]!.groupId).toBe(alloc.groupId);

    // The drained line drops out of the totals; the child carries the money.
    const s = await budget.getAccountSummary(acctA, YEAR);
    expect(s.totalCommitted).toBe(2000);
    expect(s.pool).toBe(0);
  });

  it('refuses to allocate more than the source holds', async () => {
    const pool = await budget.createLine(
      { accountKey: acctA, year: YEAR, amount: 100, status: 'committed' },
      null,
    );
    await expect(
      budget.allocateFromLine(pool.id, { amount: 101, period: `${YEAR}-06`, channel: 'meta' }, null),
    ).rejects.toThrow(/only holds/);
  });

  // ── Release ──

  it('returns money to the pool instead of vanishing it', async () => {
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-05`, channel: 'meta', amount: 3000, status: 'committed' },
      null,
    );
    const pooled = await budget.returnToPool(line.id, null, 'client pulled the campaign');
    expect(pooled!.amount).toBe(3000);
    expect(pooled!.isPool).toBe(true);

    const s = await budget.getAccountSummary(acctA, YEAR);
    expect(s.totalCommitted).toBe(3000); // still on the books
    expect(s.allocated).toBe(0);
    expect(s.pool).toBe(3000);
  });

  it('drops the money entirely on a plain cancel', async () => {
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-05`, channel: 'meta', amount: 3000, status: 'committed' },
      null,
    );
    await budget.archiveLine(line.id, null);
    const s = await budget.getAccountSummary(acctA, YEAR);
    expect(s.totalCommitted).toBe(0);
  });

  it('refuses to return a settled line to the pool', async () => {
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-05`, channel: 'meta', amount: 100, status: 'settled' },
      null,
    );
    await expect(budget.returnToPool(line.id, null)).rejects.toThrow(/settled/);
  });

  // ── Pacer rollup ──

  it('rolls google and youtube into one platform total, split by bucket', async () => {
    await budget.createLines(
      [
        { accountKey: acctA, period: `${YEAR}-08`, channel: 'google', amount: 1000, status: 'committed', bucket: 'base' },
        { accountKey: acctA, period: `${YEAR}-08`, channel: 'youtube', amount: 500, status: 'committed', bucket: 'base' },
        { accountKey: acctA, period: `${YEAR}-08`, channel: 'google', amount: 250, status: 'committed', bucket: 'added' },
        // Wrong platform, wrong month, and not committed — all must be ignored.
        { accountKey: acctA, period: `${YEAR}-08`, channel: 'meta', amount: 9999, status: 'committed' },
        { accountKey: acctA, period: `${YEAR}-09`, channel: 'google', amount: 8888, status: 'committed' },
        { accountKey: acctA, period: `${YEAR}-08`, channel: 'google', amount: 7777, status: 'planned' },
      ],
      null,
    );
    const goals = await budget.getPacerBudgetGoals(acctA, `${YEAR}-08`, 'google');
    expect(goals.base).toBe(1500);
    expect(goals.added).toBe(250);
    expect(goals.lineCount).toBe(3);

    const metaGoals = await budget.getPacerBudgetGoals(acctA, `${YEAR}-08`, 'meta');
    expect(metaGoals.base + metaGoals.added).toBe(9999);
  });

  it('keys the pacer rollup off the SPEND account, not the billed one', async () => {
    // A co-op line billed to the group but spending from a rooftop paces on the
    // rooftop's plan — getting this backwards would pace the wrong account.
    await budget.createLine(
      {
        accountKey: acctA,
        spendAccountKey: acctB,
        period: `${YEAR}-08`,
        channel: 'meta',
        amount: 4000,
        status: 'committed',
      },
      null,
    );
    const billed = await budget.getPacerBudgetGoals(acctA, `${YEAR}-08`, 'meta');
    expect(billed.lineCount).toBe(0);
    const spending = await budget.getPacerBudgetGoals(acctB, `${YEAR}-08`, 'meta');
    expect(spending.added).toBe(4000);

    // …while the account SUMMARY still bills it to A.
    const s = await budget.getAccountSummary(acctA, YEAR);
    expect(s.totalCommitted).toBe(4000);
  });

  it('defaults retainer money to base and everything else to added', async () => {
    const retainer = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-08`, channel: 'meta', amount: 100, source: 'retainer' },
      null,
    );
    const request = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-08`, channel: 'meta', amount: 100, source: 'task' },
      null,
    );
    expect(retainer.bucket).toBe('base');
    expect(request.bucket).toBe('added');
  });

  // ── Retainer generation ──

  it('generates twelve fee months and is safe to re-run', async () => {
    const a = await agreement(acctA, {
      fees: [{ channel: 'managed_marketing_services', monthlyAmount: 2500 }],
    });
    const first = await budget.generateAgreementFeeLines(a.id, YEAR, null);
    expect(first).toHaveLength(12);
    expect(first.every((l) => l.bucket === 'base')).toBe(true);

    // Re-running must not double anyone's budget.
    const second = await budget.generateAgreementFeeLines(a.id, YEAR, null);
    expect(second).toHaveLength(0);

    const s = await budget.getAccountSummary(acctA, YEAR);
    expect(s.totalCommitted).toBe(30_000);
  });

  it('generates one line per fee per month, across every fee', async () => {
    const a = await agreement(acctA, {
      fees: [
        { channel: 'managed_marketing_services', monthlyAmount: 2000 },
        { channel: 'management_fee', monthlyAmount: 500 },
      ],
    });
    const lines = await budget.generateAgreementFeeLines(a.id, YEAR, null);
    expect(lines).toHaveLength(24);
    expect(lines.filter((l) => l.channel === 'management_fee')).toHaveLength(12);
    expect((await budget.getAccountSummary(acctA, YEAR)).totalCommitted).toBe(30_000);
  });

  it('lays out only the months of the year the term actually covers', async () => {
    // An Apr-to-Mar term touches 9 months of YEAR and 3 of the next. Laying out
    // 12 in either year would invent money outside the contract.
    const a = await agreement(acctA, {
      startDate: `${YEAR}-04-01`,
      endDate: `${YEAR + 1}-03-31`,
      fees: [{ channel: 'management_fee', monthlyAmount: 1000 }],
    });
    const thisYear = await budget.generateAgreementFeeLines(a.id, YEAR, null);
    expect(thisYear).toHaveLength(9);
    expect(thisYear[0].period).toBe(`${YEAR}-04`);

    const nextYear = await budget.generateAgreementFeeLines(a.id, YEAR + 1, null);
    expect(nextYear).toHaveLength(3);
    expect(nextYear.at(-1)!.period).toBe(`${YEAR + 1}-03`);
  });

  it('refuses to generate for an agreement with no fees', async () => {
    const a = await agreement(acctA, { committedAmount: 1000 });
    await expect(budget.generateAgreementFeeLines(a.id, YEAR, null)).rejects.toThrow(
      /no recurring fees/,
    );
  });

  // ── Agreement linkage ──

  it('links a new line to the agreement covering its month', async () => {
    const a = await agreement(acctA, { committedAmount: 120_000 });
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-05`, channel: 'meta', amount: 5000, status: 'committed' },
      null,
    );
    expect(line.agreementId).toBe(a.id);
  });

  it('leaves a line unlinked when two agreements overlap the month', async () => {
    // A renewal signed before the old term expires is the normal way renewals
    // happen, and there's no defensible way to guess which one new money
    // belongs to. A wrongly linked line looks correct; an unlinked one is
    // visibly unlinked.
    await agreement(acctA, { name: 'Original' });
    await agreement(acctA, { name: 'Renewal', startDate: `${YEAR}-06-01`, endDate: `${YEAR + 1}-05-31` });

    const overlapping = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-07`, channel: 'meta', amount: 1000, status: 'committed' },
      null,
    );
    expect(overlapping.agreementId).toBeNull();

    // A month only the first term covers still links cleanly.
    const clean = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-02`, channel: 'meta', amount: 1000, status: 'committed' },
      null,
    );
    expect(clean.agreementId).not.toBeNull();
  });

  it('leaves a line outside every term unlinked', async () => {
    await agreement(acctA, { startDate: `${YEAR}-01-01`, endDate: `${YEAR}-03-31` });
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-09`, channel: 'meta', amount: 1000, status: 'committed' },
      null,
    );
    expect(line.agreementId).toBeNull();
  });

  it('never auto-links a pool line', async () => {
    // Money with no month hasn't been committed to anything yet; it picks up
    // an agreement when it's placed.
    await agreement(acctA, {});
    const pool = await budget.createLine(
      { accountKey: acctA, year: YEAR, amount: 9000, status: 'committed', source: 'pool' },
      null,
    );
    expect(pool.agreementId).toBeNull();
  });

  it('honours an explicitly named agreement over the covering one', async () => {
    const first = await agreement(acctA, { name: 'First' });
    await agreement(acctA, { name: 'Second', startDate: `${YEAR}-06-01`, endDate: `${YEAR + 1}-05-31` });
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-07`, channel: 'meta', amount: 1000, status: 'committed', agreementId: first.id },
      null,
    );
    expect(line.agreementId).toBe(first.id);
  });

  it('reports what has been booked against each agreement', async () => {
    await agreement(acctA, { committedAmount: 120_000 });
    await budget.createLines(
      [
        { accountKey: acctA, period: `${YEAR}-01`, channel: 'meta', amount: 30_000, status: 'committed' },
        { accountKey: acctA, period: `${YEAR}-02`, channel: 'meta', amount: 20_000, status: 'committed' },
        // Planned money isn't booked — it's excluded from every rollup.
        { accountKey: acctA, period: `${YEAR}-03`, channel: 'meta', amount: 99_000, status: 'planned' },
      ],
      null,
    );
    const [listed] = await budget.listAgreements(acctA, { year: YEAR });
    expect(listed.booked).toBe(50_000);
    expect(listed.commitmentForYear).toBe(120_000);
  });

  it('counts a flight\'s months against the agreement they fall in', async () => {
    const a = await agreement(acctA, { committedAmount: 100_000 });
    await budget.createFlight(
      { accountKey: acctA, channel: 'radio', startDate: `${YEAR}-03-01`, endDate: `${YEAR}-04-30`, amount: 61_000 },
      null,
    );
    const [listed] = await budget.listAgreements(acctA, { year: YEAR });
    expect(listed.booked).toBe(61_000);
    expect(listed.id).toBe(a.id);
  });

  it('adopts budget that was already entered before the agreement existed', async () => {
    // The ordinary sequence: money goes in first, paperwork follows. Without
    // adoption a new agreement reads 0% drawn while the year is visibly full
    // of its money, which makes the number look broken.
    await budget.createLines(
      [
        { accountKey: acctA, period: `${YEAR}-01`, channel: 'meta', amount: 10_000, status: 'committed' },
        { accountKey: acctA, period: `${YEAR}-02`, channel: 'meta', amount: 15_000, status: 'committed' },
        { accountKey: acctA, year: YEAR, amount: 5_000, status: 'committed', source: 'pool' },
      ],
      null,
    );
    await agreement(acctA, { committedAmount: 100_000 });

    const [listed] = await budget.listAgreements(acctA, { year: YEAR });
    // The two placed lines, not the pool line — pool money isn't committed to
    // anything until it's placed.
    expect(listed.booked).toBe(25_000);
  });

  it('does not re-point a line already attached to another agreement', async () => {
    const first = await agreement(acctA, { name: 'First', committedAmount: 50_000 });
    await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-02`, channel: 'meta', amount: 8_000, status: 'committed' },
      null,
    );
    // A second, wholly overlapping term. Adoption must not steal the line.
    await agreement(acctA, { name: 'Second', committedAmount: 50_000 });

    const all = await budget.listAgreements(acctA, { year: YEAR });
    expect(all.find((a) => a.id === first.id)!.booked).toBe(8_000);
    expect(all.find((a) => a.id !== first.id)!.booked).toBe(0);
  });

  // ── Categorising ──

  it('groups what needs a type by channel, biggest money first', async () => {
    await budget.createLines(
      [
        { accountKey: acctA, period: `${YEAR}-01`, channel: 'other', amount: 5000, status: 'committed', lineType: 'unclassified', label: 'Mystery spend' },
        { accountKey: acctA, period: `${YEAR}-02`, channel: 'other', amount: 3000, status: 'committed', lineType: 'unclassified' },
        { accountKey: acctA, period: `${YEAR}-01`, channel: 'referral', amount: 900, status: 'committed', lineType: 'unclassified' },
        // Already typed — must not appear.
        { accountKey: acctA, period: `${YEAR}-01`, channel: 'meta', amount: 50_000, status: 'committed' },
      ],
      null,
    );

    const groups = await budget.getUnclassified(acctA, YEAR);
    expect(groups.map((g) => g.channel)).toEqual(['other', 'referral']);
    expect(groups[0].lines).toBe(2);
    expect(groups[0].amount).toBe(8000);
    expect(groups[0].examples).toContain('Mystery spend');
  });

  it('types a whole channel at once and leaves the others alone', async () => {
    await budget.createLines(
      [
        { accountKey: acctA, period: `${YEAR}-01`, channel: 'other', amount: 5000, status: 'committed', lineType: 'unclassified' },
        { accountKey: acctA, period: `${YEAR}-02`, channel: 'other', amount: 3000, status: 'committed', lineType: 'unclassified' },
        { accountKey: acctA, period: `${YEAR}-01`, channel: 'referral', amount: 900, status: 'committed', lineType: 'unclassified' },
      ],
      null,
    );

    expect(await budget.categoriseChannel(acctA, YEAR, 'other', 'service', null)).toBe(2);
    const groups = await budget.getUnclassified(acctA, YEAR);
    expect(groups.map((g) => g.channel)).toEqual(['referral']);
  });

  it('never overrules a type someone already set by hand', async () => {
    // The safety property of a bulk action: it can only fill blanks. Otherwise
    // one click could undo a morning of careful per-line work.
    const [bulk, decided] = await budget.createLines(
      [
        { accountKey: acctA, period: `${YEAR}-01`, channel: 'other', amount: 1000, status: 'committed', lineType: 'unclassified' },
        { accountKey: acctA, period: `${YEAR}-02`, channel: 'other', amount: 2000, status: 'committed', lineType: 'production' },
      ],
      null,
    );

    expect(await budget.categoriseChannel(acctA, YEAR, 'other', 'fee', null)).toBe(1);
    const after = await budget.getLine(decided.id);
    expect(after!.lineType).toBe('production');
    expect((await budget.getLine(bulk.id))!.lineType).toBe('fee');
  });

  it('is idempotent — a second run finds nothing left to do', async () => {
    await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-01`, channel: 'other', amount: 1000, status: 'committed', lineType: 'unclassified' },
      null,
    );
    expect(await budget.categoriseChannel(acctA, YEAR, 'other', 'fee', null)).toBe(1);
    expect(await budget.categoriseChannel(acctA, YEAR, 'other', 'fee', null)).toBe(0);
  });

  it('refuses to assign "unclassified" as a type', async () => {
    await expect(
      budget.categoriseChannel(acctA, YEAR, 'other', 'unclassified', null),
    ).rejects.toThrow(/not a line type to assign/);
  });

  it('moves money out of uncosted once a type is assigned', async () => {
    // The point of the whole exercise: an untyped line's margin is UNKNOWN, so
    // it sits in `uncostedAmount` dragging the revenue figure's credibility
    // down. Typing it as a fee resolves it to revenue with no cost.
    await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-01`, channel: 'other', amount: 4000, status: 'committed', lineType: 'unclassified' },
      null,
    );
    expect((await budget.getAccountSummary(acctA, YEAR)).uncostedAmount).toBe(4000);

    await budget.categoriseChannel(acctA, YEAR, 'other', 'fee', null);
    const after = await budget.getAccountSummary(acctA, YEAR);
    expect(after.uncostedAmount).toBe(0);
    expect(after.knownRevenue).toBe(4000);
  });

  it('records who decided, on every line it touched', async () => {
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-01`, channel: 'other', amount: 1000, status: 'committed', lineType: 'unclassified' },
      null,
    );
    await budget.categoriseChannel(acctA, YEAR, 'other', 'fee', null);
    const events = await budget.listLineEvents(line.id);
    expect(events.some((e) => e.field === 'lineType' && e.toValue === 'fee')).toBe(true);
  });

  // ── Flights ──

  it('lays a flight out across months, weighted by days, summing to the total', async () => {
    const lines = await budget.createFlight(
      {
        accountKey: acctA,
        channel: 'radio',
        startDate: `${YEAR}-03-20`,
        endDate: `${YEAR}-05-10`,
        amount: 52_000,
        label: 'Spring Radio',
      },
      null,
    );
    expect(lines.map((l) => l.period)).toEqual([`${YEAR}-03`, `${YEAR}-04`, `${YEAR}-05`]);
    // 12 / 30 / 10 days, not an even third each.
    expect(lines.map((l) => l.amount)).toEqual([12_000, 30_000, 10_000]);
    expect(new Set(lines.map((l) => l.flightId)).size).toBe(1);
    expect(lines.every((l) => l.flightStart === `${YEAR}-03-20`)).toBe(true);

    const s = await budget.getAccountSummary(acctA, YEAR);
    expect(s.totalCommitted).toBe(52_000);
  });

  it('re-splits when the total changes', async () => {
    const [line] = await budget.createFlight(
      { accountKey: acctA, channel: 'radio', startDate: `${YEAR}-03-01`, endDate: `${YEAR}-04-30`, amount: 61_000 },
      null,
    );
    const updated = await budget.updateFlight(line.flightId!, { amount: 122_000 }, null);
    expect(updated!.amount).toBe(122_000);
    // 31 and 30 days of a 61-day flight.
    expect(updated!.months.map((m) => m.amount)).toEqual([62_000, 60_000]);
  });

  it('cancels months that fall outside a shortened range', async () => {
    const [line] = await budget.createFlight(
      { accountKey: acctA, channel: 'radio', startDate: `${YEAR}-03-01`, endDate: `${YEAR}-05-31`, amount: 92_000 },
      null,
    );
    const updated = await budget.updateFlight(
      line.flightId!,
      { endDate: `${YEAR}-04-30` },
      null,
    );
    // May is dropped from the range — canceled, not deleted, so the trail
    // survives, and excluded from the rollup.
    const may = updated!.months.find((m) => m.period === `${YEAR}-05`);
    expect(may?.status).toBe('canceled');
    const s = await budget.getAccountSummary(acctA, YEAR);
    expect(s.totalCommitted).toBe(92_000);
  });

  it('extends into new months when the range grows', async () => {
    const [line] = await budget.createFlight(
      { accountKey: acctA, channel: 'radio', startDate: `${YEAR}-03-01`, endDate: `${YEAR}-03-31`, amount: 31_000 },
      null,
    );
    const updated = await budget.updateFlight(line.flightId!, { endDate: `${YEAR}-04-30` }, null);
    expect(updated!.months.filter((m) => m.status !== 'canceled')).toHaveLength(2);
    expect(updated!.amount).toBe(31_000);
  });

  it('never rewrites a settled month, and spreads the rest around it', async () => {
    // The rule that matters: a settled line has a recorded actual and has been
    // reported on. Re-splitting it because a LATER month moved would change
    // history to fix the future.
    const lines = await budget.createFlight(
      { accountKey: acctA, channel: 'radio', startDate: `${YEAR}-03-01`, endDate: `${YEAR}-04-30`, amount: 61_000 },
      null,
    );
    const march = lines.find((l) => l.period === `${YEAR}-03`)!;
    await budget.settleLineManually(march.id, 30_000, null);

    const updated = await budget.updateFlight(lines[0].flightId!, { amount: 100_000 }, null);
    const m = updated!.months.find((x) => x.period === `${YEAR}-03`)!;
    const a = updated!.months.find((x) => x.period === `${YEAR}-04`)!;
    expect(m.status).toBe('settled');
    expect(m.amount).toBe(31_000); // untouched
    expect(a.amount).toBe(69_000); // absorbs the whole change
    expect(updated!.amount).toBe(100_000);
  });

  it('refuses a new total below what settled months already hold', async () => {
    const lines = await budget.createFlight(
      { accountKey: acctA, channel: 'radio', startDate: `${YEAR}-03-01`, endDate: `${YEAR}-04-30`, amount: 61_000 },
      null,
    );
    await budget.settleLineManually(lines[0].id, 1000, null);
    await expect(
      budget.updateFlight(lines[0].flightId!, { amount: 5_000 }, null),
    ).rejects.toThrow(/Settled months/);
  });

  it('cancels every open month but leaves settled ones as history', async () => {
    const lines = await budget.createFlight(
      { accountKey: acctA, channel: 'radio', startDate: `${YEAR}-03-01`, endDate: `${YEAR}-05-31`, amount: 92_000 },
      null,
    );
    await budget.settleLineManually(lines[0].id, 1000, null);
    expect(await budget.cancelFlight(lines[0].flightId!)).toBe(2);
    const after = await budget.getFlight(lines[0].flightId!);
    expect(after!.months.filter((m) => m.status === 'canceled')).toHaveLength(2);
    expect(after!.settledMonths).toBe(1);
  });

  it('spans the new year, each month carrying its own year', async () => {
    const lines = await budget.createFlight(
      {
        accountKey: acctA,
        channel: 'radio',
        startDate: `${YEAR}-12-15`,
        endDate: `${YEAR + 1}-01-14`,
        amount: 31_000,
      },
      null,
    );
    expect(lines.map((l) => l.year)).toEqual([YEAR, YEAR + 1]);
    expect(lines.map((l) => l.amount)).toEqual([17_000, 14_000]);
    // Each year's rollup sees only its own share.
    expect((await budget.getAccountSummary(acctA, YEAR)).totalCommitted).toBe(17_000);
    expect((await budget.getAccountSummary(acctA, YEAR + 1)).totalCommitted).toBe(14_000);
  });

  it('rejects a reversed range', async () => {
    await expect(
      budget.createFlight(
        { accountKey: acctA, channel: 'radio', startDate: `${YEAR}-05-10`, endDate: `${YEAR}-03-01`, amount: 1000 },
        null,
      ),
    ).rejects.toThrow(/ends before it starts/);
  });

  // ── Editing ──

  it('placing a pool line records the allocation in its trail', async () => {
    const line = await budget.createLine(
      { accountKey: acctA, year: YEAR, amount: 1000, status: 'committed' },
      null,
    );
    await budget.updateLine(line.id, { period: `${YEAR}-10`, channel: 'meta' }, null);

    const events = await budget.listLineEvents(line.id);
    expect(events.some((e) => e.action === 'allocated')).toBe(true);

    const s = await budget.getAccountSummary(acctA, YEAR);
    expect(s.allocated).toBe(1000);
    expect(s.pool).toBe(0);
  });

  it('clears settledAt when a settled line is reopened', async () => {
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-10`, channel: 'meta', amount: 100 },
      null,
    );
    const settled = await budget.updateLine(line.id, { status: 'settled' }, null);
    expect(settled!.settledAt).not.toBeNull();
    const reopened = await budget.updateLine(line.id, { status: 'committed' }, null);
    expect(reopened!.settledAt).toBeNull();
  });

  // ── Phase 3: pacer binding ──
  //
  // These need a MetaAdsPacerPlan, which the other blocks don't, so the plan is
  // created per-test and torn down with the account.

  async function withPlan(accountKey: string) {
    return prisma.metaAdsPacerPlan.upsert({
      where: { accountKey },
      create: { accountKey },
      update: {},
      select: { id: true },
    });
  }

  it('does nothing when the account has no pacer plan', async () => {
    await budget.createLine(
      { accountKey: acctB, period: `${YEAR}-08`, channel: 'meta', amount: 100, status: 'committed' },
      null,
    );
    const r = await budget.syncPeriodBudgetFromLines(acctB, `${YEAR}-08`, 'meta');
    expect(r).toEqual({ synced: false, reason: 'no_plan' });
  });

  it('does nothing until the period is explicitly managed', async () => {
    await withPlan(acctA);
    await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-08`, channel: 'meta', amount: 5000, status: 'committed' },
      null,
    );
    // The whole point of opt-in: lines existing is NOT consent to take over.
    expect(await budget.syncPeriodBudgetFromLines(acctA, `${YEAR}-08`, 'meta')).toEqual({
      synced: false,
      reason: 'not_managed',
    });
  });

  it('writes the goals on manage, splitting base and added', async () => {
    const plan = await withPlan(acctA);
    await budget.createLines(
      [
        { accountKey: acctA, period: `${YEAR}-08`, channel: 'meta', amount: 4000, status: 'committed', source: 'retainer' },
        { accountKey: acctA, period: `${YEAR}-08`, channel: 'meta', amount: 1500, status: 'committed', source: 'task' },
      ],
      null,
    );
    const r = await budget.setPeriodManaged(acctA, `${YEAR}-08`, 'meta', true, null);
    expect(r.synced).toBe(true);

    const row = await prisma.metaAdsPacerPeriodBudget.findUnique({
      where: { planId_period: { planId: plan.id, period: `${YEAR}-08` } },
    });
    expect(Number(row!.baseBudgetGoal)).toBe(4000);
    expect(Number(row!.addedBudgetGoal)).toBe(1500);
    // Google's pair is untouched — the two specialists own separate numbers.
    expect(row!.googleBaseBudgetGoal).toBeNull();
    expect(row!.googleManagedByBudget).toBe(false);
  });

  it('re-syncs automatically when a line changes', async () => {
    const plan = await withPlan(acctA);
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-08`, channel: 'meta', amount: 1000, status: 'committed', source: 'task' },
      null,
    );
    await budget.setPeriodManaged(acctA, `${YEAR}-08`, 'meta', true, null);

    await budget.updateLine(line.id, { amount: 2500 }, null);
    const after = await prisma.metaAdsPacerPeriodBudget.findUnique({
      where: { planId_period: { planId: plan.id, period: `${YEAR}-08` } },
    });
    expect(Number(after!.addedBudgetGoal)).toBe(2500);
  });

  it('re-syncs BOTH months when a line moves between them', async () => {
    const plan = await withPlan(acctA);
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-08`, channel: 'meta', amount: 3000, status: 'committed', source: 'task' },
      null,
    );
    await budget.setPeriodManaged(acctA, `${YEAR}-08`, 'meta', true, null);
    await budget.setPeriodManaged(acctA, `${YEAR}-09`, 'meta', true, null);

    await budget.updateLine(line.id, { period: `${YEAR}-09` }, null);

    // The month it LEFT must drop to zero — syncing only the destination would
    // leave August still claiming money that moved to September.
    const aug = await prisma.metaAdsPacerPeriodBudget.findUnique({
      where: { planId_period: { planId: plan.id, period: `${YEAR}-08` } },
    });
    const sep = await prisma.metaAdsPacerPeriodBudget.findUnique({
      where: { planId_period: { planId: plan.id, period: `${YEAR}-09` } },
    });
    expect(Number(aug!.addedBudgetGoal)).toBe(0);
    expect(Number(sep!.addedBudgetGoal)).toBe(3000);
  });

  it('drops a managed month to $0 rather than leaving a stale goal', async () => {
    const plan = await withPlan(acctA);
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-08`, channel: 'meta', amount: 800, status: 'committed', source: 'task' },
      null,
    );
    await budget.setPeriodManaged(acctA, `${YEAR}-08`, 'meta', true, null);
    await budget.archiveLine(line.id, null);

    const row = await prisma.metaAdsPacerPeriodBudget.findUnique({
      where: { planId_period: { planId: plan.id, period: `${YEAR}-08` } },
    });
    // A managed month with no lines is a real $0, not "unset".
    expect(Number(row!.addedBudgetGoal)).toBe(0);
  });

  it('leaves the last synced value in place when unmanaged', async () => {
    const plan = await withPlan(acctA);
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-08`, channel: 'meta', amount: 1200, status: 'committed', source: 'task' },
      null,
    );
    await budget.setPeriodManaged(acctA, `${YEAR}-08`, 'meta', true, null);
    await budget.setPeriodManaged(acctA, `${YEAR}-08`, 'meta', false, null);

    const row = await prisma.metaAdsPacerPeriodBudget.findUnique({
      where: { planId_period: { planId: plan.id, period: `${YEAR}-08` } },
    });
    expect(row!.managedByBudget).toBe(false);
    expect(Number(row!.addedBudgetGoal)).toBe(1200);

    // And further ledger edits no longer reach it — the specialist owns it now.
    await budget.updateLine(line.id, { amount: 9999 }, null);
    const after = await prisma.metaAdsPacerPeriodBudget.findUnique({
      where: { planId_period: { planId: plan.id, period: `${YEAR}-08` } },
    });
    expect(Number(after!.addedBudgetGoal)).toBe(1200);
  });

  it('syncs the SPEND account\u2019s pacer for a cross-account line', async () => {
    const planB = await withPlan(acctB);
    await budget.setPeriodManaged(acctB, `${YEAR}-08`, 'meta', true, null);
    await budget.createLine(
      {
        accountKey: acctA,
        spendAccountKey: acctB,
        period: `${YEAR}-08`,
        channel: 'meta',
        amount: 750,
        status: 'committed',
        source: 'task',
      },
      null,
    );
    const row = await prisma.metaAdsPacerPeriodBudget.findUnique({
      where: { planId_period: { planId: planB.id, period: `${YEAR}-08` } },
    });
    expect(Number(row!.addedBudgetGoal)).toBe(750);
  });

  it('reports management state per platform', async () => {
    await withPlan(acctA);
    await budget.setPeriodManaged(acctA, `${YEAR}-08`, 'google', true, null);
    expect(await budget.getPeriodManagement(acctA, `${YEAR}-08`)).toEqual({
      meta: false,
      google: true,
    });
  });

  it('writes an audit entry naming the ledger as the source', async () => {
    const plan = await withPlan(acctA);
    await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-08`, channel: 'meta', amount: 300, status: 'committed' },
      null,
    );
    await budget.setPeriodManaged(acctA, `${YEAR}-08`, 'meta', true, null);

    const entries = await prisma.metaAdsPacerAuditEntry.findMany({
      where: { planId: plan.id, period: `${YEAR}-08` },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.some((e) => e.summary.includes('managed by the budget ledger'))).toBe(true);
    expect(entries.some((e) => e.summary.includes('synced from ledger'))).toBe(true);
  });

  // ── Phase 4: settlement ──

  async function pacerAd(
    planId: string,
    period: string,
    opts: { actual: number; source?: string; platform?: string; allocation?: number },
  ) {
    return prisma.metaAdsPacerAd.create({
      data: {
        planId,
        period,
        name: `vitest ad ${opts.actual}`,
        platform: opts.platform ?? null,
        budgetSource: opts.source ?? 'base',
        allocation: String(opts.allocation ?? opts.actual),
        pacerActual: String(opts.actual),
      },
      select: { id: true },
    });
  }

  it('refuses to settle a month that has not closed', async () => {
    await withPlan(acctA);
    const current = new Date().toISOString().slice(0, 7);
    await budget.createLine(
      { accountKey: acctA, period: current, channel: 'meta', amount: 1000, status: 'committed' },
      null,
    );
    const r = await budget.settlePlatformPeriod(acctA, current, 'meta', null);
    expect(r.skipped).toBe('not_closed');
    expect(r.settled).toBe(0);
  });

  it('splits actual across a bucket in proportion to spend target', async () => {
    const plan = await withPlan(acctA);
    // markup 0.8 → targets are 8000 and 2000, so a 5000 actual splits 4000/1000.
    const a = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-01`, channel: 'meta', amount: 10_000, status: 'committed', source: 'retainer' },
      null,
    );
    const b = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-01`, channel: 'meta', amount: 2_500, status: 'committed', source: 'retainer' },
      null,
    );
    await pacerAd(plan.id, `${YEAR}-01`, { actual: 5000, source: 'base' });

    // YEAR is in the future, so force past the closed-month guard.
    const r = await budget.settlePlatformPeriod(acctA, `${YEAR}-01`, 'meta', null, { force: true });
    expect(r.settled).toBe(2);
    expect(r.attributed).toBeCloseTo(5000, 2);
    expect(r.orphaned).toBe(0);

    const after = await Promise.all([budget.getLine(a.id), budget.getLine(b.id)]);
    expect(after[0]!.actualAmount).toBeCloseTo(4000, 2);
    expect(after[1]!.actualAmount).toBeCloseTo(1000, 2);
    expect(after.every((l) => l!.status === 'settled')).toBe(true);
    // Every cent lands somewhere.
    expect(after[0]!.actualAmount! + after[1]!.actualAmount!).toBeCloseTo(5000, 2);
  });

  it('keeps base and added spend in their own buckets', async () => {
    const plan = await withPlan(acctA);
    const base = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-02`, channel: 'meta', amount: 1000, status: 'committed', source: 'retainer' },
      null,
    );
    const added = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-02`, channel: 'meta', amount: 1000, status: 'committed', source: 'task' },
      null,
    );
    await pacerAd(plan.id, `${YEAR}-02`, { actual: 900, source: 'base' });
    await pacerAd(plan.id, `${YEAR}-02`, { actual: 300, source: 'added' });

    await budget.settlePlatformPeriod(acctA, `${YEAR}-02`, 'meta', null, { force: true });

    // Cross-contamination here would misreport which work overspent.
    expect((await budget.getLine(base.id))!.actualAmount).toBeCloseTo(900, 2);
    expect((await budget.getLine(added.id))!.actualAmount).toBeCloseTo(300, 2);
  });

  it('reports spend with no line behind it as orphaned', async () => {
    const plan = await withPlan(acctA);
    await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-03`, channel: 'meta', amount: 1000, status: 'committed', source: 'retainer' },
      null,
    );
    // Added-bucket spend with no added-bucket line to absorb it.
    await pacerAd(plan.id, `${YEAR}-03`, { actual: 800, source: 'base' });
    await pacerAd(plan.id, `${YEAR}-03`, { actual: 250, source: 'added' });

    const r = await budget.settlePlatformPeriod(acctA, `${YEAR}-03`, 'meta', null, { force: true });
    expect(r.settled).toBe(1);
    expect(r.orphaned).toBeCloseTo(250, 2);
  });

  it('is safe to re-run — settled lines are left alone', async () => {
    const plan = await withPlan(acctA);
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-04`, channel: 'meta', amount: 1000, status: 'committed', source: 'retainer' },
      null,
    );
    await pacerAd(plan.id, `${YEAR}-04`, { actual: 700, source: 'base' });

    const first = await budget.settlePlatformPeriod(acctA, `${YEAR}-04`, 'meta', null, { force: true });
    const second = await budget.settlePlatformPeriod(acctA, `${YEAR}-04`, 'meta', null, { force: true });
    expect(first.settled).toBe(1);
    expect(second.settled).toBe(0);
    expect((await budget.getLine(line.id))!.actualAmount).toBeCloseTo(700, 2);
  });

  it('settles a non-platform line by hand', async () => {
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-05`, channel: 'radio', amount: 5000, markup: 1, status: 'committed' },
      null,
    );
    const settled = await budget.settleLineManually(line.id, 4800, null);
    expect(settled!.status).toBe('settled');
    expect(settled!.actualAmount).toBe(4800);
    expect(settled!.settledAt).not.toBeNull();

    const events = await budget.listLineEvents(line.id);
    expect(events[0]!.summary).toContain('under');
  });

  it('reopening clears the recorded actual', async () => {
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-05`, channel: 'radio', amount: 1000, status: 'committed' },
      null,
    );
    await budget.settleLineManually(line.id, 900, null);
    const reopened = await budget.unsettleLine(line.id, null);
    // Leaving the actual on a line that no longer claims to be settled would
    // orphan the number in every rollup that reads it.
    expect(reopened!.status).toBe('committed');
    expect(reopened!.actualAmount).toBeNull();
    expect(reopened!.settledAt).toBeNull();
  });

  it('refuses to reopen a line that was never settled', async () => {
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-05`, channel: 'radio', amount: 100, status: 'committed' },
      null,
    );
    expect(await budget.unsettleLine(line.id, null)).toBeNull();
  });

  it('settled money still counts against the year', async () => {
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-06`, channel: 'radio', amount: 3000, status: 'committed' },
      null,
    );
    await budget.settleLineManually(line.id, 2500, null);
    const s = await budget.getAccountSummary(acctA, YEAR);
    // Closing a month must not make the budget disappear from the year — the
    // client still paid it.
    expect(s.totalCommitted).toBe(3000);
    expect(s.allocated).toBe(3000);
  });

  // ── Regression: the managed-period guard must compare VALUES ──

  it('a managed month still accepts an ad-only save that echoes the goals', async () => {
    // The planner's autosave always spreads the current goals into its payload
    // alongside the ads. A guard that rejected on the PRESENCE of those keys
    // 409'd every ad edit on a managed month — allocation, status, dates — and
    // the client swallowed it, so work silently didn't save. This pins the
    // stored value against an unchanged echo.
    const plan = await withPlan(acctA);
    await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-08`, channel: 'meta', amount: 4000, status: 'committed', source: 'retainer' },
      null,
    );
    await budget.setPeriodManaged(acctA, `${YEAR}-08`, 'meta', true, null);

    const before = await prisma.metaAdsPacerPeriodBudget.findUnique({
      where: { planId_period: { planId: plan.id, period: `${YEAR}-08` } },
    });
    expect(Number(before!.baseBudgetGoal)).toBe(4000);
    expect(before!.managedByBudget).toBe(true);

    // A ledger change re-syncs it; the goal must track the lines, not freeze.
    await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-08`, channel: 'meta', amount: 1000, status: 'committed', source: 'retainer' },
      null,
    );
    const after = await prisma.metaAdsPacerPeriodBudget.findUnique({
      where: { planId_period: { planId: plan.id, period: `${YEAR}-08` } },
    });
    expect(Number(after!.baseBudgetGoal)).toBe(5000);
    expect(after!.managedByBudget).toBe(true);
  });

  // ── Import (Oz Reports migration) ──

  it('creates on first run and updates on the second — never duplicates', async () => {
    // The whole reason externalId is unique. A second push of 8,000 lines must
    // correct the same ledger, not mint a parallel one.
    const line = {
      externalId: 'ozreports:account_budgets:1',
      accountKey: acctA,
      year: YEAR,
      period: `${YEAR}-04`,
      channel: 'meta',
      amount: 1000,
      markup: 0.77,
      status: 'committed',
    };
    expect(await budget.upsertImportedLines([line], [], null)).toMatchObject({ created: 1, updated: 0 });
    expect(await budget.upsertImportedLines([line], [], null)).toMatchObject({ created: 0, updated: 1 });

    const all = await prisma.budgetLine.findMany({ where: { accountKey: acctA, year: YEAR } });
    expect(all).toHaveLength(1);
  });

  it('applies a corrected source row onto the same line', async () => {
    const base = {
      externalId: 'ozreports:account_budgets:2',
      accountKey: acctA,
      year: YEAR,
      period: `${YEAR}-04`,
      channel: 'meta',
      amount: 1000,
      markup: 0.77,
      status: 'committed',
    };
    await budget.upsertImportedLines([base], [], null);
    await budget.upsertImportedLines(
      [{ ...base, amount: 2500, channel: 'radio', period: `${YEAR}-05` }],
      [],
      null,
    );
    const row = await prisma.budgetLine.findUnique({ where: { externalId: base.externalId } });
    expect(toN(row!.amount)).toBe(2500);
    expect(row!.channel).toBe('radio');
    expect(row!.period).toBe(`${YEAR}-05`);
  });

  it('retires lines whose source row was deleted', async () => {
    // Without this a dual-run leaks: a budget deleted in Oz Reports just stops
    // appearing in the push, so Loomi would keep it forever.
    const line = {
      externalId: 'ozreports:account_budgets:3',
      accountKey: acctA,
      year: YEAR,
      period: `${YEAR}-06`,
      channel: 'meta',
      amount: 900,
      markup: 0.77,
      status: 'committed',
    };
    await budget.upsertImportedLines([line], [], null);
    expect((await budget.getAccountSummary(acctA, YEAR)).totalCommitted).toBe(900);

    const res = await budget.upsertImportedLines([], [line.externalId], null);
    expect(res.archived).toBe(1);
    expect((await budget.getAccountSummary(acctA, YEAR)).totalCommitted).toBe(0);
  });

  it('rejects one bad row without dropping the rest of the batch', async () => {
    // 8,000 lines at a time — a single unusable row must not strand the others.
    const good = {
      externalId: 'ozreports:account_budgets:4',
      accountKey: acctA,
      year: YEAR,
      period: `${YEAR}-07`,
      channel: 'meta',
      amount: 500,
      markup: 0.77,
      status: 'committed',
    };
    const bad = { ...good, externalId: 'ozreports:account_budgets:5', channel: 'carrier_pigeon' };
    const res = await budget.upsertImportedLines([good, bad], [], null);
    expect(res.created).toBe(1);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0]!.externalId).toBe(bad.externalId);
    expect(res.rejected[0]!.reason).toMatch(/Unknown budget channel/);
  });

  it('imports an Oz pool row (for_month 0) as an unplaced line', async () => {
    await budget.upsertImportedLines(
      [{
        externalId: 'ozreports:account_budgets:6',
        accountKey: acctA,
        year: YEAR,
        period: null,
        channel: null,
        amount: 4000,
        markup: 0.77,
        status: 'committed',
      }],
      [],
      null,
    );
    const s = await budget.getAccountSummary(acctA, YEAR);
    expect(s.pool).toBe(4000);
    expect(s.allocated).toBe(0);
  });

  // ── Line type + cost (Phase A) ──

  it('derives cost from markup for media, and zero for a fee', async () => {
    const media = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-01`, channel: 'meta', amount: 10_000, markup: 0.77, status: 'committed' },
      null,
    );
    expect(media.lineType).toBe('media');
    expect(media.effectiveCost).toBeCloseTo(7700, 2);
    expect(media.revenue).toBeCloseTo(2300, 2);
    expect(media.margin).toBeCloseTo(0.23, 4);

    const fee = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-01`, channel: 'management_fee', amount: 2000, status: 'committed' },
      null,
    );
    // A fee has no external cost — the whole amount is revenue, regardless of
    // whatever markup the account happens to carry.
    expect(fee.lineType).toBe('fee');
    expect(fee.effectiveCost).toBe(0);
    expect(fee.revenue).toBe(2000);
    expect(fee.margin).toBe(1);
  });

  it("leaves a service line's cost UNKNOWN until someone enters it", async () => {
    const svc = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-02`, channel: 'data_feed', amount: 5000, status: 'committed' },
      null,
    );
    // The critical case: treating unknown cost as zero would report 100% margin
    // on every un-costed service line — the most flattering possible lie.
    expect(svc.lineType).toBe('service');
    expect(svc.effectiveCost).toBeNull();
    expect(svc.revenue).toBeNull();
    expect(svc.margin).toBeNull();
  });

  it('uses an entered cost in preference to any derivation', async () => {
    const svc = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-02`, channel: 'lead_provider', amount: 4000, cost: 2500, status: 'committed' },
      null,
    );
    expect(svc.effectiveCost).toBe(2500);
    expect(svc.revenue).toBe(1500);

    // Even on media, where a markup exists — that number came off a vendor
    // invoice and must not be overridden by a percentage.
    const media = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-02`, channel: 'meta', amount: 1000, markup: 0.77, cost: 900, status: 'committed' },
      null,
    );
    expect(media.effectiveCost).toBe(900);
    expect(media.revenue).toBe(100);
  });

  it('defaults an unclassifiable channel to unclassified rather than guessing', async () => {
    const line = await budget.createLine(
      { accountKey: acctA, period: `${YEAR}-03`, channel: 'other', amount: 1000, status: 'committed' },
      null,
    );
    expect(line.lineType).toBe('unclassified');
    expect(line.effectiveCost).toBeNull();
  });

  it('splits the year by line type and flags what it cannot cost', async () => {
    await budget.createLines(
      [
        { accountKey: acctA, period: `${YEAR}-04`, channel: 'meta', amount: 10_000, markup: 0.8, status: 'committed' },
        { accountKey: acctA, period: `${YEAR}-04`, channel: 'contribution', amount: 5_000, status: 'committed' },
        { accountKey: acctA, period: `${YEAR}-04`, channel: 'data_feed', amount: 3_000, status: 'committed' },
        { accountKey: acctA, period: `${YEAR}-04`, channel: 'data_feed', amount: 1_000, cost: 400, status: 'committed' },
      ],
      null,
    );
    const s = await budget.getAccountSummary(acctA, YEAR);
    const byType = Object.fromEntries(s.byLineType.map((t) => [t.lineType, t]));

    expect(byType.media!.amount).toBe(10_000);
    expect(byType.media!.revenue).toBeCloseTo(2000, 2);
    expect(byType.media!.costKnown).toBe(true);

    expect(byType.fee!.amount).toBe(5_000);
    expect(byType.fee!.revenue).toBe(5_000);

    // One un-costed line makes the whole type's margin a guess — reported as
    // such rather than quietly showing the costed subset as if it were all.
    expect(byType.service!.amount).toBe(4_000);
    expect(byType.service!.costKnown).toBe(false);
    expect(s.uncostedAmount).toBe(3_000);

    // Known revenue excludes the type it can't compute.
    expect(s.knownRevenue).toBeCloseTo(7000, 2);
  });

  it('re-derives line type when an allocation lands on a different channel', async () => {
    const pool = await budget.createLine(
      { accountKey: acctA, year: YEAR, amount: 8000, status: 'committed' },
      null,
    );
    const res = await budget.allocateFromLine(
      pool.id,
      { amount: 3000, period: `${YEAR}-05`, channel: 'management_fee' },
      null,
    );
    // Inheriting 'unclassified' from the pool would leave real fee revenue
    // invisible in the P&L split.
    expect(res!.allocated.lineType).toBe('fee');
    expect(res!.allocated.revenue).toBe(3000);
  });
});
