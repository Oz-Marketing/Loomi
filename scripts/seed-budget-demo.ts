/**
 * Seed demo data for the budget hub (docs/budget-module.md).
 *
 *   npx tsx scripts/seed-budget-demo.ts            # seed (resets these accounts first)
 *   npx tsx scripts/seed-budget-demo.ts --clear    # remove the demo data, seed nothing
 *
 * Touches THREE demo accounts only (see ACCOUNTS below) and nothing else. Each
 * run clears those accounts' budget rows first so it's re-runnable and the
 * picture stays coherent.
 *
 * Everything goes through the service layer rather than raw inserts, so the
 * event trails, the pacer sync, and the audit entries are all genuinely
 * produced the way the app produces them — a demo built on hand-written rows
 * would show empty histories and an unsynced pacer.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import * as budget from '../src/lib/services/budget';
import * as projects from '../src/lib/services/projects';

// Three accounts, three states worth seeing side by side.
const ACCOUNTS = {
  /** The healthy, fully-worked account. Retainer + add-ons + pool + pacer. */
  main: 'demoAccount001',
  /** Committed past the planned total — shows the over-allocation warning. */
  over: 'demoAccount002',
  /** Traditional-media heavy — channels that never reach a pacer. */
  traditional: 'demoAccount003',
} as const;

const YEAR = 2026;
const p = (m: number) => `${YEAR}-${String(m).padStart(2, '0')}`;

async function actingUserId(): Promise<string | null> {
  // Attribute the history to a real person so the trails read like the app's,
  // not "System" all the way down.
  const u = await prisma.user.findFirst({
    where: { role: { in: ['developer', 'super_admin', 'admin'] } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return u?.id ?? null;
}

async function clear(): Promise<void> {
  const keys = Object.values(ACCOUNTS);
  // Lines cascade their events; plans and the demo tickets go separately.
  const { count: lines } = await prisma.budgetLine.deleteMany({
    where: { OR: [{ accountKey: { in: keys } }, { spendAccountKey: { in: keys } }] },
  });
  const { count: plans } = await prisma.budgetPlan.deleteMany({
    where: { accountKey: { in: keys } },
  });
  // Only the tickets this script created — matched on the marker in their
  // description so a real ticket filed against a demo account survives.
  const { count: tasks } = await prisma.task.deleteMany({
    where: { accountKey: { in: keys }, description: { contains: SEED_MARKER } },
  });
  const { count: inits } = await prisma.initiative.deleteMany({
    where: { accountKey: { in: keys }, description: { contains: SEED_MARKER } },
  });
  // Hand the pacer months back so a re-seed starts from hand-typed goals.
  const planIds = await prisma.metaAdsPacerPlan.findMany({
    where: { accountKey: { in: keys } },
    select: { id: true },
  });
  await prisma.metaAdsPacerPeriodBudget.updateMany({
    where: { planId: { in: planIds.map((x) => x.id) } },
    data: { managedByBudget: false, googleManagedByBudget: false },
  });
  // Only the pacer ads this script created — matched on the name prefix, so a
  // real ad planned against a demo account survives a re-seed.
  const { count: ads } = await prisma.metaAdsPacerAd.deleteMany({
    where: { planId: { in: planIds.map((x) => x.id) }, name: { startsWith: AD_MARKER } },
  });
  if (ads) console.log(`cleared ${ads} demo pacer ads`);
  console.log(
    `cleared: ${lines} lines, ${plans} plans, ${tasks} tasks, ${inits} initiatives`,
  );
}

const SEED_MARKER = '[budget demo seed]';
/** Prefixes the pacer ads this script creates, so clear() removes only its own. */
const AD_MARKER = '[demo] ';

/** File a real funded ticket so the line has genuine ticket provenance. */
async function fundedTicket(
  accountKeys: string[],
  title: string,
  teamKey: string,
  kind: string,
  period: string,
  budgetRows: { channel: string; amount: number }[],
  userId: string | null,
) {
  return projects.createTicket(
    {
      accountKeys,
      title,
      description: `${SEED_MARKER} Demo ticket for the budget hub walkthrough.`,
      departments: [{ teamKey, kind, budget: budgetRows }],
      budgetPeriod: period,
      priority: 'medium',
      createInitiative: false,
    },
    userId,
  );
}

async function seedMain(userId: string | null): Promise<void> {
  const key = ACCOUNTS.main;

  // $18k/mo standing budget against $290k declared — the retainer plus the
  // year's add-ons and the contingency pool still leave headroom, so this
  // account reads healthy next to demoAccount002's over-allocation.
  await budget.upsertPlan({
    accountKey: key,
    year: YEAR,
    declaredTotal: 290_000,
    monthlyRetainer: 18_000,
    userId,
  });

  // The retainer, split across the two paced channels rather than one lump —
  // this is what a real digital retainer looks like on the grid.
  await budget.createLines(
    Array.from({ length: 12 }, (_, i) => i + 1).flatMap((m) => [
      {
        accountKey: key,
        period: p(m),
        channel: 'meta',
        amount: 11_000,
        source: 'retainer',
        status: 'committed',
        label: 'Managed Marketing Service',
      },
      {
        accountKey: key,
        period: p(m),
        channel: 'google',
        amount: 7_000,
        source: 'retainer',
        status: 'committed',
        label: 'Managed Marketing Service',
      },
    ]),
    userId,
  );

  // A YouTube push for the back half of the year, entered directly.
  await budget.createLines(
    [8, 9, 10].map((m) => ({
      accountKey: key,
      period: p(m),
      channel: 'youtube',
      amount: 3_500,
      source: 'adhoc',
      status: 'committed',
      label: 'Q4 pre-roll push',
    })),
    userId,
  );

  // Two funded tickets → task-sourced lines with real provenance links.
  await fundedTicket(
    [key],
    'Labor Day Sales Event — paid social + search',
    'digital-ads',
    'ads',
    p(9),
    [
      { channel: 'meta', amount: 6_500 },
      { channel: 'google', amount: 4_000 },
    ],
    userId,
  );
  await fundedTicket(
    [key],
    'Fall service mailer',
    'graphic-design',
    'print',
    p(10),
    [{ channel: 'print', amount: 9_200 }],
    userId,
  );

  // Unassigned money the rep hasn't placed yet — the pool panel's reason to
  // exist, and the thing the allocate action operates on.
  await budget.createLine(
    {
      accountKey: key,
      year: YEAR,
      amount: 15_000,
      source: 'pool',
      status: 'committed',
      label: 'Q4 contingency — channel TBD',
      notes: 'Client added mid-year; waiting on a plan before it gets placed.',
    },
    userId,
  );

  // Settle the months that have already run, so past periods read as closed
  // and the drawer has a settled line to show.
  const past = await prisma.budgetLine.findMany({
    where: { accountKey: key, year: YEAR, period: { in: [p(1), p(2), p(3)] } },
    select: { id: true },
  });
  for (const l of past) {
    await budget.updateLine(l.id, { status: 'settled' }, userId);
  }

  // Hand August's Meta goals to the ledger so the pacer binding is live and
  // visible (the pacer's goal fields lock, the badge shows). Only if the
  // account actually has a pacer plan.
  const hasPlan = await prisma.metaAdsPacerPlan.findUnique({
    where: { accountKey: key },
    select: { id: true },
  });
  if (hasPlan) {
    await budget.setPeriodManaged(key, p(8), 'meta', true, userId);
    await budget.setPeriodManaged(key, p(8), 'google', true, userId);

    // Unallocated ad rows in the managed month, so the pacer's "Spread the
    // remaining across N unallocated ads" action (§3b) has something to act on.
    // The Completed Run one is deliberate: distribute must skip it.
    await prisma.metaAdsPacerAd.createMany({
      data: [
        { planId: hasPlan.id, period: p(8), position: 0, name: `${AD_MARKER}Summer Retarget`, budgetSource: 'base', adStatus: 'Live' },
        { planId: hasPlan.id, period: p(8), position: 1, name: `${AD_MARKER}Prospecting — Broad`, budgetSource: 'base', adStatus: 'In Draft' },
        { planId: hasPlan.id, period: p(8), position: 2, name: `${AD_MARKER}Old Run`, budgetSource: 'base', adStatus: 'Completed Run' },
      ],
    });
  }

  const s = await budget.getAccountSummary(key, YEAR);
  console.log(
    `${key}: ${s.totalCommitted.toLocaleString()} committed of ${s.declaredTotal?.toLocaleString()} planned` +
      ` (${s.allocated.toLocaleString()} scheduled, ${s.pool.toLocaleString()} pooled)` +
      `${hasPlan ? ' · Aug pacer managed' : ' · no pacer plan, binding skipped'}`,
  );
}

async function seedOver(userId: string | null): Promise<void> {
  const key = ACCOUNTS.over;

  await budget.upsertPlan({
    accountKey: key,
    year: YEAR,
    declaredTotal: 60_000,
    monthlyRetainer: 5_000,
    userId,
  });

  await budget.createLines(
    Array.from({ length: 12 }, (_, i) => ({
      accountKey: key,
      period: p(i + 1),
      channel: 'meta',
      amount: 5_000,
      source: 'retainer',
      status: 'committed',
      label: 'Monthly retainer',
    })),
    userId,
  );

  // The tipping point: a mid-year event the client asked for on top of a fully
  // committed year. Warns, doesn't block — which is the decision on record.
  await fundedTicket(
    [key],
    'Grand reopening — everything on',
    'digital-ads',
    'ads',
    p(8),
    [
      { channel: 'meta', amount: 8_000 },
      { channel: 'google', amount: 5_500 },
    ],
    userId,
  );

  const s = await budget.getAccountSummary(key, YEAR);
  console.log(
    `${key}: ${s.totalCommitted.toLocaleString()} committed of ${s.declaredTotal?.toLocaleString()} planned` +
      ` — overAllocated=${s.overAllocated}`,
  );
}

async function seedTraditional(userId: string | null): Promise<void> {
  const key = ACCOUNTS.traditional;

  await budget.upsertPlan({ accountKey: key, year: YEAR, declaredTotal: 150_000, userId });

  // Non-paced channels: no platform to sync from, settled by hand. Radio runs
  // its own markup, which is what the per-line override is for.
  await budget.createLines(
    [
      ...[6, 7, 8, 9].map((m) => ({
        accountKey: key,
        period: p(m),
        channel: 'radio',
        amount: 12_000,
        markup: 0.85,
        source: 'adhoc',
        status: 'committed',
        label: 'Summer radio flight',
      })),
      ...[7, 8].map((m) => ({
        accountKey: key,
        period: p(m),
        channel: 'tv',
        amount: 18_000,
        source: 'adhoc',
        status: 'committed',
        label: 'Broadcast — summer event',
      })),
      {
        accountKey: key,
        period: p(9),
        channel: 'billboard',
        amount: 7_500,
        source: 'adhoc',
        status: 'committed',
        label: 'I-15 boards, Q3',
      },
      {
        accountKey: key,
        period: p(5),
        channel: 'production',
        amount: 22_000,
        source: 'adhoc',
        status: 'settled',
        label: 'Brand spot production',
      },
    ],
    userId,
  );

  // A co-op line: billed to this account, spending out of the main account's
  // ad account. The case oz-reports modeled with spend_account_id and the one
  // Loomi had no way to express before.
  await budget.createLine(
    {
      accountKey: key,
      spendAccountKey: ACCOUNTS.main,
      period: p(9),
      channel: 'meta',
      amount: 6_000,
      source: 'adhoc',
      status: 'committed',
      label: 'Co-op — group buy, spends from Demo Account 001',
    },
    userId,
  );

  const s = await budget.getAccountSummary(key, YEAR);
  console.log(
    `${key}: ${s.totalCommitted.toLocaleString()} committed across ${s.byChannel.length} channels (incl. 1 co-op line)`,
  );
}

async function main(): Promise<void> {
  const clearOnly = process.argv.includes('--clear');

  const found = await prisma.account.findMany({
    where: { key: { in: Object.values(ACCOUNTS) } },
    select: { key: true },
  });
  const missing = Object.values(ACCOUNTS).filter((k) => !found.some((f) => f.key === k));
  if (missing.length) {
    console.error(`Missing account(s): ${missing.join(', ')}. Seed dummy accounts first.`);
    process.exit(1);
  }

  await clear();
  if (clearOnly) {
    console.log('--clear: done, nothing seeded.');
    return;
  }

  const userId = await actingUserId();
  await seedMain(userId);
  await seedOver(userId);
  await seedTraditional(userId);

  console.log('\nOpen /app/projects/budget and pick one of:');
  console.log('  Demo Account 001 — full picture: retainer, add-ons, pool, pacer-managed August');
  console.log('  Demo Account 002 — over-allocated warning');
  console.log('  Demo Account 003 — traditional media + a co-op line');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
