/**
 * One-off seeder: populates Demo Account 006 with a realistic mid-flight
 * Meta Ads Pacer scenario for the 2026-05 period. 5 ads spanning Daily +
 * Lifetime, Base + Added, and a mix of statuses (Live, Off donor,
 * Working on it, Scheduled, Completed Run donor).
 *
 * Run: `cd loomi-studio && npx tsx scripts/seed-meta-pacer-demo.ts`
 */
import 'dotenv/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}
const cleanUrl = url
  .replace(/[?&]sslmode=require/, (m) => (m.startsWith('?') ? '?' : ''))
  .replace(/\?$/, '');
const pool = new pg.Pool({
  connectionString: cleanUrl,
  ...(/[?&]sslmode=require/.test(url) && { ssl: { rejectUnauthorized: false } }),
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const PERIOD = '2026-05';
const BASE_GOAL_GROSS = '2000';
const ADDED_GOAL_GROSS = '800';

const adsBlueprint = [
  {
    name: 'Spring Sale Awareness',
    position: 0,
    budgetType: 'Lifetime',
    budgetSource: 'base',
    flightStart: '2026-05-01',
    flightEnd: '2026-05-31',
    liveDate: '2026-05-01',
    creativeDueDate: '2026-04-28',
    dueDate: '2026-04-29',
    dateCompleted: null,
    adStatus: 'Live',
    designStatus: 'Approved',
    internalApproval: 'Approved',
    clientApproval: 'Approved',
    allocation: '600',
    pacerActual: '500',
    pacerDailyBudget: null,
    pacerTodayDate: '2026-05-14',
    pacerEndDate: '2026-05-31',
    actionNeeded: 'Update Existing Ad',
    recurring: 'No',
    coop: 'No',
    creativeLink: 'https://example.com/spring-sale-creative',
    clientName: 'Demo Dealer',
    digitalDetails:
      'Lifetime awareness push for spring promotions. Broad targeting, 30-day flight, video creative.',
  },
  {
    name: 'Service Promo — Tuesday Special',
    position: 1,
    budgetType: 'Daily',
    budgetSource: 'base',
    flightStart: '2026-05-01',
    flightEnd: '2026-05-31',
    liveDate: '2026-05-01',
    creativeDueDate: '2026-04-28',
    dueDate: '2026-04-29',
    dateCompleted: null,
    adStatus: 'Off',
    designStatus: 'Approved',
    internalApproval: 'Approved',
    clientApproval: 'Approved',
    allocation: '400',
    pacerActual: '300',
    pacerDailyBudget: '13.33',
    pacerTodayDate: '2026-05-14',
    pacerEndDate: '2026-05-31',
    actionNeeded: null,
    recurring: 'Yes',
    coop: 'No',
    creativeLink: 'https://example.com/service-tuesday-creative',
    clientName: 'Demo Dealer',
    digitalDetails:
      'Recurring Tuesday service deals. Turned off mid-flight after CPM spike — $100 freed for reallocation.',
  },
  {
    name: 'Inventory Showcase — Used SUVs',
    position: 2,
    budgetType: 'Daily',
    budgetSource: 'base',
    flightStart: '2026-05-15',
    flightEnd: '2026-05-31',
    liveDate: null,
    creativeDueDate: '2026-05-12',
    dueDate: '2026-05-13',
    dateCompleted: null,
    adStatus: 'Working on it',
    designStatus: 'Work In Progress',
    internalApproval: 'Pending Approval',
    clientApproval: 'Pending Approval',
    allocation: '540',
    pacerActual: null,
    pacerDailyBudget: '31.76',
    pacerTodayDate: '2026-05-14',
    pacerEndDate: '2026-05-31',
    actionNeeded: 'Create New',
    recurring: 'No',
    coop: 'No',
    creativeLink: null,
    clientName: 'Demo Dealer',
    digitalDetails:
      'New inventory showcase targeting in-market SUV shoppers. Dynamic catalog ads.',
  },
  {
    name: 'Memorial Day Event Blast',
    position: 3,
    budgetType: 'Lifetime',
    budgetSource: 'added',
    flightStart: '2026-05-23',
    flightEnd: '2026-05-30',
    liveDate: null,
    creativeDueDate: '2026-05-20',
    dueDate: '2026-05-21',
    dateCompleted: null,
    adStatus: 'Scheduled',
    designStatus: 'Approved',
    internalApproval: 'Approved',
    clientApproval: 'Approved',
    allocation: '316',
    pacerActual: null,
    pacerDailyBudget: null,
    pacerTodayDate: '2026-05-14',
    pacerEndDate: '2026-05-30',
    actionNeeded: 'Create New',
    recurring: 'No',
    coop: 'Yes',
    creativeLink: 'https://example.com/memorial-day-creative',
    clientName: 'Demo Dealer',
    digitalDetails:
      'Memorial Day weekend event blast. Co-op funded; static + carousel creative.',
  },
  {
    name: 'Conquest Retargeting — Q2',
    position: 4,
    budgetType: 'Daily',
    budgetSource: 'added',
    flightStart: '2026-04-15',
    flightEnd: '2026-05-14',
    liveDate: '2026-04-15',
    creativeDueDate: '2026-04-12',
    dueDate: '2026-04-13',
    dateCompleted: '2026-05-14',
    adStatus: 'Completed Run',
    designStatus: 'Approved',
    internalApproval: 'Approved',
    clientApproval: 'Approved',
    allocation: '300',
    pacerActual: '200',
    pacerDailyBudget: '10',
    pacerTodayDate: '2026-05-14',
    pacerEndDate: '2026-05-14',
    actionNeeded: null,
    recurring: 'No',
    coop: 'No',
    creativeLink: 'https://example.com/conquest-creative',
    clientName: 'Demo Dealer',
    digitalDetails:
      'Conquest retargeting from competitor visits. Completed early under-budget — $100 freed for reallocation.',
  },
];

async function main() {
  const account = await prisma.account.findFirst({
    where: { dealer: { contains: 'Demo Account 006', mode: 'insensitive' } },
  });
  if (!account) {
    console.error('No account found matching "Demo Account 006"');
    return;
  }
  console.log(`Seeding into account: ${account.dealer} (key=${account.key})`);

  const plan =
    (await prisma.metaAdsPacerPlan.findUnique({
      where: { accountKey: account.key },
    })) ??
    (await prisma.metaAdsPacerPlan.create({
      data: { accountKey: account.key },
    }));

  await prisma.metaAdsPacerPeriodBudget.upsert({
    where: { planId_period: { planId: plan.id, period: PERIOD } },
    create: {
      planId: plan.id,
      period: PERIOD,
      baseBudgetGoal: BASE_GOAL_GROSS,
      addedBudgetGoal: ADDED_GOAL_GROSS,
    },
    update: {
      baseBudgetGoal: BASE_GOAL_GROSS,
      addedBudgetGoal: ADDED_GOAL_GROSS,
    },
  });
  console.log(
    `Period ${PERIOD} goals: Base ${BASE_GOAL_GROSS} / Added ${ADDED_GOAL_GROSS} (gross)`,
  );

  const wiped = await prisma.metaAdsPacerAd.deleteMany({
    where: { planId: plan.id, period: PERIOD },
  });
  console.log(`Cleared ${wiped.count} existing ads in ${PERIOD}.`);

  for (const ad of adsBlueprint) {
    await prisma.metaAdsPacerAd.create({
      data: {
        planId: plan.id,
        period: PERIOD,
        ...ad,
      },
    });
    console.log(`  + ${ad.name} (${ad.budgetType}/${ad.budgetSource}, ${ad.adStatus})`);
  }

  console.log(`Done — ${adsBlueprint.length} ads seeded for ${account.dealer} ${PERIOD}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
