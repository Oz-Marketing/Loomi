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
    await prisma.budgetPlan.deleteMany({ where: { accountKey: { startsWith: PREFIX } } });
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

  it('prefers the plan default over the account rate', async () => {
    await budget.upsertPlan({ accountKey: acctA, year: YEAR, defaultMarkup: 0.7 });
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
    await expect(
      budget.createLine(
        { accountKey: acctA, period: `${YEAR}-03`, channel: 'tiktok', amount: 100 },
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
    await budget.upsertPlan({ accountKey: acctA, year: YEAR, declaredTotal: 10_000 });
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

  it('generates twelve retainer months and is safe to re-run', async () => {
    await budget.upsertPlan({ accountKey: acctA, year: YEAR, monthlyRetainer: 2500 });
    const first = await budget.generateRetainerLines(acctA, YEAR, { channel: 'meta' }, null);
    expect(first).toHaveLength(12);
    expect(first.every((l) => l.bucket === 'base')).toBe(true);

    // Re-running must not double anyone's budget.
    const second = await budget.generateRetainerLines(acctA, YEAR, { channel: 'meta' }, null);
    expect(second).toHaveLength(0);

    const s = await budget.getAccountSummary(acctA, YEAR);
    expect(s.totalCommitted).toBe(30_000);
  });

  it('refuses to generate without a retainer set', async () => {
    await budget.upsertPlan({ accountKey: acctA, year: YEAR, declaredTotal: 1000 });
    await expect(budget.generateRetainerLines(acctA, YEAR, {}, null)).rejects.toThrow(
      /monthly retainer/,
    );
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
});
