/**
 * Demo data for the Google pacing card (docs/google-pacing-card.md), mirroring
 * `seed-budget-demo.ts`. Fills ONE demo account's August 2026 Google plan with a
 * scenario that exercises every branch of the card: percent-mode allocations, a
 * locked carve-out, a mid-month launch, a shared budget, a total-budget campaign,
 * an ad-schedule campaign, a disapproved one, a budget-limited one, two labels
 * with an event budget, and a daily-spend series so the data edge and the
 * delivery-health chart are real.
 *
 *   npx tsx scripts/seed-google-pacing-demo.ts            # seed / re-seed
 *   npx tsx scripts/seed-google-pacing-demo.ts --clear    # remove it again
 *
 * Touches demoAccount001's Google rows for that month and nothing else. Local
 * only — it is not part of any deploy step.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

const ACCOUNT = 'demoAccount001';
const PERIOD = '2026-08';
const TODAY = '2026-08-10';
// Series runs Aug 1–9, so the data edge lands on the 9th (today is partial).
const SERIES_END_DAY = 9;

type Row = {
  name: string;
  pct: number;
  spent: number;
  daily: number;
  /** 'steady' | 'tocap' | 'cant' | 'behind' — shapes the daily series. */
  delivery: 'steady' | 'tocap' | 'cant' | 'behind';
  startDay?: number;
  tags?: string[];
  locked?: boolean;
  total?: boolean;
  sharedCount?: number;
  disapproved?: boolean;
  constrained?: boolean;
  schedule?: boolean;
};

const ROWS: Row[] = [
  { name: 'Yamaha', pct: 13, spent: 135, daily: 14.8, delivery: 'steady', tags: ['Branding'] },
  { name: 'Polaris', pct: 17, spent: 255, daily: 19.4, delivery: 'tocap', tags: ['Summer Sales Event'], constrained: true },
  { name: 'Suzuki', pct: 4, spent: 18, daily: 4.55, delivery: 'cant' },
  { name: 'CFMOTO', pct: 6, spent: 60, daily: 6.8, delivery: 'steady' },
  { name: 'Service', pct: 11, spent: 149, daily: 12.5, delivery: 'tocap', tags: ['Summer Sales Event'] },
  { name: 'ATV / General', pct: 9, spent: 94, daily: 10.2, delivery: 'steady', sharedCount: 3 },
  { name: 'PMAX — Polaris', pct: 13, spent: 45, daily: 14.8, delivery: 'behind', startDay: 6, tags: ['Summer Sales Event'] },
  { name: 'PMAX — Yamaha', pct: 9, spent: 94, daily: 10.2, delivery: 'steady', tags: ['Branding'], schedule: true },
  { name: 'Display', pct: 2, spent: 21, daily: 2.3, delivery: 'steady', disapproved: true },
  { name: "Shopping VLA's", pct: 5, spent: 18, daily: 5.7, delivery: 'cant' },
  { name: 'MV Agusta PMAX', pct: 11, spent: 115, daily: 12.5, delivery: 'steady', locked: true },
  { name: 'Sidewalk Sale (total budget)', pct: 0, spent: 40, daily: 0, delivery: 'steady', startDay: 5, total: true },
];

const pad = (n: number) => String(n).padStart(2, '0');
/** Deterministic pseudo-random so a re-run produces the same picture. */
function rand(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
}

(async () => {
  const clear = process.argv.includes('--clear');
  const plan = await prisma.metaAdsPacerPlan.upsert({
    where: { accountKey: ACCOUNT },
    create: { accountKey: ACCOUNT },
    update: {},
  });

  await prisma.metaAdsPacerAd.deleteMany({
    where: { planId: plan.id, period: PERIOD, platform: 'google' },
  });
  await prisma.metaAdsPacerDailySpend.deleteMany({
    where: { planId: plan.id, platform: 'google' },
  });
  if (clear) {
    await prisma.metaAdsPacerPeriodBudget.updateMany({
      where: { planId: plan.id, period: PERIOD },
      data: {
        googleBaseBudgetGoal: null,
        googleAddedBudgetGoal: null,
        googleAllocationMode: null,
        googleEventBudgets: null,
      },
    });
    console.log('cleared');
    await prisma.$disconnect();
    return;
  }

  // $4,000 base + $396 added event money = the mockup's $4,396 client budget.
  await prisma.metaAdsPacerPeriodBudget.upsert({
    where: { planId_period: { planId: plan.id, period: PERIOD } },
    create: {
      planId: plan.id,
      period: PERIOD,
      googleBaseBudgetGoal: '4000',
      googleAddedBudgetGoal: '396',
      googleAllocationMode: 'pct',
      googleEventBudgets: JSON.stringify({ 'Summer Sales Event': 1400 }),
    },
    update: {
      googleBaseBudgetGoal: '4000',
      googleAddedBudgetGoal: '396',
      googleAllocationMode: 'pct',
      googleEventBudgets: JSON.stringify({ 'Summer Sales Event': 1400 }),
    },
  });

  const series: { objectId: string; date: string; spend: number; dailyBudget: number }[] = [];

  for (let i = 0; i < ROWS.length; i++) {
    const r = ROWS[i];
    const campaignId = `900000${pad(i + 1)}`;
    await prisma.metaAdsPacerAd.create({
      data: {
        planId: plan.id,
        period: PERIOD,
        position: i,
        platform: 'google',
        name: r.name,
        adStatus: 'Live',
        budgetType: r.total ? 'Lifetime' : 'Daily',
        budgetSource: r.tags?.includes('Summer Sales Event') ? 'added' : 'base',
        allocation: r.total ? '400.00' : undefined,
        allocationPercent: r.total ? null : String(r.pct),
        pacerActual: r.spent.toFixed(2),
        pacerDailyBudget: r.daily > 0 ? r.daily.toFixed(2) : null,
        pacerLocked: r.locked ?? false,
        pacerTags: r.tags?.length ? JSON.stringify(r.tags) : null,
        googleCampaignId: campaignId,
        googleChannelType: r.name.startsWith('PMAX') ? 'PMax' : 'Search',
        googleEffectiveStatus: 'ENABLED',
        googleBudgetResourceName: `customers/1234567890/campaignBudgets/${campaignId}`,
        googleBudgetPeriod: r.total ? 'CUSTOM_PERIOD' : 'DAILY',
        googleBudgetReferenceCount: r.sharedCount ?? 1,
        googleStartDate: r.startDay ? `${PERIOD}-${pad(r.startDay)}` : '2025-04-14',
        googleEndDate: r.total ? `${PERIOD}-20` : null,
        googleAdsDisapproved: r.disapproved ?? false,
        googleBudgetConstrained: r.constrained ?? false,
        googleHasAdSchedule: r.schedule ?? false,
        pacerSyncedAt: new Date(`${TODAY}T14:00:00Z`),
      },
    });

    // Daily series so the data edge is real and the health popup has a chart.
    const cap = r.daily || 13;
    const rnd = rand(i * 131 + 17);
    const firstDay = r.startDay ?? 1;
    for (let d = firstDay; d <= SERIES_END_DAY; d++) {
      let factor: number;
      if (r.delivery === 'tocap') factor = 1.0 + 0.6 * rnd();
      else if (r.delivery === 'cant') factor = 0.28 + 0.18 * rnd();
      else if (r.delivery === 'behind') factor = 0.3 + 0.15 * rnd();
      else factor = 0.86 + 0.22 * rnd();
      series.push({
        objectId: campaignId,
        date: `${PERIOD}-${pad(d)}`,
        spend: Math.round(cap * factor * 100) / 100,
        dailyBudget: cap,
      });
    }
  }

  await prisma.metaAdsPacerDailySpend.createMany({
    data: series.map((s) => ({
      planId: plan.id,
      platform: 'google',
      objectId: s.objectId,
      date: s.date,
      spend: s.spend.toFixed(2),
      dailyBudget: s.dailyBudget.toFixed(2),
    })),
  });

  console.log(`seeded ${ROWS.length} google campaigns + ${series.length} daily-spend rows`);
  await prisma.$disconnect();
})();
