/**
 * Demo data for the Google pacing card (docs/google-pacing-card.md and its
 * budget-report addendum), mirroring `seed-budget-demo.ts`. Fills ONE demo
 * account's Google plan for a month with a scenario that exercises every branch
 * of the card: percent-mode allocations, a locked carve-out, a mid-month launch,
 * a shared budget, a total-budget campaign, an ad-schedule campaign, a
 * disapproved one, a budget-limited one, two labels with an event budget, a
 * daily-spend series so the data edge and the delivery charts are real,
 * mid-month daily-budget changes so the billing ceiling steps, reference metrics
 * so the insights line has figures, and a linked Google customer id so the tool
 * reads as connected.
 *
 *   npx tsx scripts/seed-google-pacing-demo.ts            # seed / re-seed
 *   npx tsx scripts/seed-google-pacing-demo.ts 2026-09    # a specific month
 *   npx tsx scripts/seed-google-pacing-demo.ts --clear    # remove it again
 *
 * THE MONTH FOLLOWS THE CLOCK. It used to hardcode August 2026 with a series
 * frozen at the 9th, so every day that passed pushed the "data edge" further
 * into the past until the card was mostly empty future. It now seeds the current
 * month and runs the series to YESTERDAY, plus a partial row for today — which
 * is the shape the card is designed around, and the only one where the data
 * edge, the today-so-far strip and the live-total cross-check all mean anything.
 *
 * CONNECTED, NOT AUTHENTICATED. Setting `Account.googleAdsCustomerId` is what
 * the Pacing tab reads to decide whether Google is linked, so it flips the card
 * out of manual mode and enables the daily-budget editor. There are no real
 * credentials behind it: anything that actually calls Google — Sync, Import,
 * Push — will fail at the API boundary with a stated error. That is the intended
 * trade for a local demo, and `--clear` unlinks it again.
 *
 * Touches demoAccount001's Google rows for that month and nothing else. Local
 * only — it is not part of any deploy step.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { accountTimeZone } from '../src/lib/meta-ads-pacer';
import { zonedTodayIso } from '../src/lib/timezone';
import { GOOGLE_DAILY_MULTIPLIER, MONTH_DAYS_MULTIPLIER } from '../src/lib/ad-pacer/constants';
import { resolvePayable, targetOf } from '../src/lib/ad-pacer/google-allocator';
import { getGlobalDefaultMarkup } from '../src/lib/services/markup';

const ACCOUNT = 'demoAccount001';
/** A plausible-looking Google Ads customer id. Nothing authenticates against
 *  it — it exists so the card renders its connected state (see the header). */
const CUSTOMER_ID = '1234567890';

const periodArg = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a));

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
  /**
   * A mid-month daily-budget change: the rate becomes `to` from `day` onward.
   * The addendum's budget report is built to make these legible — the billing
   * ceiling steps, the gray single-day limits step behind the bars, a divider
   * lands on the day, and the panel says "set on <date>" — and none of that can
   * be seen against a series where the budget never moves.
   */
  raise?: { day: number; to: number };
};

/**
 * The percent lines sum to 88, NOT 100. The remaining 12% is the total-budget
 * campaign, which holds a fixed dollar allocation rather than a percentage —
 * and the seed computes that dollar figure as the exact remainder, so the demo
 * opens FULLY ALLOCATED. When the percent lines summed to 100 the fixed line
 * sat on top of them and the account opened $400 over, which made the first
 * thing anyone saw on the card a problem the data had invented.
 */
const ROWS: Row[] = [
  { name: 'Yamaha', pct: 11, spent: 135, daily: 14.8, delivery: 'steady', tags: ['Branding'] },
  { name: 'Polaris', pct: 15, spent: 255, daily: 19.4, delivery: 'tocap', tags: ['Summer Sales Event'], constrained: true, raise: { day: 11, to: 26 } },
  { name: 'Suzuki', pct: 4, spent: 18, daily: 4.55, delivery: 'cant' },
  { name: 'CFMOTO', pct: 5, spent: 60, daily: 6.8, delivery: 'steady' },
  { name: 'Service', pct: 10, spent: 149, daily: 12.5, delivery: 'tocap', tags: ['Summer Sales Event'], raise: { day: 9, to: 9 } },
  { name: 'ATV / General', pct: 8, spent: 94, daily: 10.2, delivery: 'steady', sharedCount: 3 },
  { name: 'PMAX — Polaris', pct: 11, spent: 45, daily: 14.8, delivery: 'behind', startDay: 6, tags: ['Summer Sales Event'] },
  { name: 'PMAX — Yamaha', pct: 8, spent: 94, daily: 10.2, delivery: 'steady', tags: ['Branding'], schedule: true },
  { name: 'Display', pct: 2, spent: 21, daily: 2.3, delivery: 'steady', disapproved: true },
  { name: "Shopping VLA's", pct: 4, spent: 18, daily: 5.7, delivery: 'cant' },
  { name: 'MV Agusta PMAX', pct: 10, spent: 115, daily: 12.5, delivery: 'steady', locked: true },
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

  /**
   * "Today" IN THE ACCOUNT'S ZONE, not the machine's — the same call the card
   * makes. `new Date().toISOString()` is UTC, so any evening west of Greenwich
   * seeds tomorrow: the partial row lands on a day the card counts as the
   * future, and the spend summed to the seed's edge includes a day the card
   * still treats as unsettled. Two hours of drift is enough to make every figure
   * on the row disagree with the chart under it.
   */
  const TODAY = zonedTodayIso(Date.now(), await accountTimeZone(ACCOUNT));
  const PERIOD = periodArg ?? TODAY.slice(0, 7);
  const [Y, M] = PERIOD.split('-').map(Number);
  const DAYS_IN_MONTH = new Date(Date.UTC(Y, M, 0)).getUTCDate();
  /**
   * The data edge: the last WHOLE day. Yesterday in a live month, the month end
   * in a closed one — the same rule `resolveClock` applies, so the seeded series
   * and the card's day counts stop at the same instant.
   */
  const CURRENT_MONTH = TODAY.slice(0, 7) === PERIOD;
  const TODAY_DAY = CURRENT_MONTH ? Number(TODAY.slice(8, 10)) : 0;
  const SERIES_END_DAY = CURRENT_MONTH ? Math.max(1, TODAY_DAY - 1) : DAYS_IN_MONTH;

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
    // Unlink too, so a cleared demo account does not keep claiming a Google
    // connection it has no data behind.
    await prisma.account.update({
      where: { key: ACCOUNT },
      data: { googleAdsCustomerId: null },
    });
    console.log('cleared');
    await prisma.$disconnect();
    return;
  }

  // What the Pacing tab reads to decide Google is linked. No credentials sit
  // behind it — see the file header.
  await prisma.account.update({
    where: { key: ACCOUNT },
    data: { googleAdsCustomerId: CUSTOMER_ID },
  });

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

  /**
   * The month's payable, resolved through the SAME function the card uses so
   * the seed cannot disagree with what the card will compute from what it
   * writes. Needed here because the total-budget line's fixed dollar allocation
   * is the remainder that makes the plan add up exactly.
   */
  // The account override if it has one, else the agency default — the same
  // resolution the server does before it hands `markup` to the card. Reading
  // Account.markup alone yields null on an account that has no override, and
  // `effMarkupOf(null)` is 0 by design, so the payable came out $0 and the
  // total-budget line was seeded at $0.
  const account = await prisma.account.findUnique({
    where: { key: ACCOUNT },
    select: { markup: true },
  });
  const markup =
    account?.markup != null ? Number(account.markup) : await getGlobalDefaultMarkup();
  const { payable } = resolvePayable({
    baseBudgetGoal: '4000',
    addedBudgetGoal: '396',
    markup,
  });
  // Each percent line's target, rounded exactly as the allocator rounds it —
  // summing the unrounded shares and rounding once would leave the plan a cent
  // or two off, which reads as "over-allocated" on the badge.
  const pctTotal = ROWS.filter((r) => !r.total).reduce(
    (sum, r) => sum + targetOf(r.pct, 'pct', payable),
    0,
  );
  const totalBudgetAllocation = Math.round((payable - pctTotal) * 100) / 100;

  const series: { objectId: string; date: string; spend: number; dailyBudget: number }[] = [];

  for (let i = 0; i < ROWS.length; i++) {
    const r = ROWS[i];
    const campaignId = `900000${pad(i + 1)}`;
    const firstDay = r.startDay ?? 1;
    /** The daily budget in effect on a given day — the pre-raise rate before the
     *  change day, the new one from it. Frozen per day in the series, which is
     *  what lets the report derive the change without a separate log. */
    const rateOn = (day: number) =>
      r.raise && day >= r.raise.day ? r.raise.to : r.daily || 13;

    // The daily series: every finalized day of the flight, plus a PARTIAL row
    // for today. Today is stored like any other day; every surface that must not
    // count it (the average, the verdict, the bars, spent-MTD) filters on the
    // data edge instead, which is the only place that rule belongs.
    const rnd = rand(i * 131 + 17);
    const lastDay = Math.min(
      CURRENT_MONTH ? TODAY_DAY : DAYS_IN_MONTH,
      r.total ? 20 : DAYS_IN_MONTH,
    );
    let finalizedSpend = 0;
    /**
     * GOOGLE'S MONTHLY SPENDING LIMIT, tracked exactly as the card computes it:
     * rate × 30.4 while the budget is untouched, re-based at a change to what
     * has been spent plus the new rate over the calendar days that remain.
     *
     * The series has to respect it or the demo shows a month Google could never
     * have billed. It previously did: a campaign spending up to 1.6× its rate
     * every day for sixteen days sat at $220.70 against a $9/day budget whose
     * limit is $273.60 — the card read that correctly and looked broken doing
     * it, because the DATA was impossible, not the arithmetic.
     */
    let limit = rateOn(firstDay) * MONTH_DAYS_MULTIPLIER;
    let monthSpend = 0;
    for (let d = firstDay; d <= lastDay; d++) {
      const rate = rateOn(d);
      // A change re-bases the limit on the day it lands (see google-allocator's
      // monthlyLimitAfterChange — the same rule, so the seed and the card agree).
      if (r.raise && d === r.raise.day) {
        monthSpend = Math.round(monthSpend * 100) / 100;
        limit = monthSpend + rate * (DAYS_IN_MONTH - d + 1);
      }
      let factor: number;
      // At-cap campaigns average their rate rather than exceeding it: Google
      // allows 2× on a single day but only ~30.4 days' worth across the month,
      // so a sustained 1.3× average is not a thing that can happen.
      if (r.delivery === 'tocap') factor = 0.75 + 0.5 * rnd();
      else if (r.delivery === 'cant') factor = 0.28 + 0.18 * rnd();
      else if (r.delivery === 'behind') factor = 0.3 + 0.15 * rnd();
      else factor = 0.86 + 0.22 * rnd();
      // Today is only part-spent — it is a few hours old, not a bad day.
      const partial = CURRENT_MONTH && d === TODAY_DAY ? 0.42 : 1;
      // Two hard caps, both Google's: 2× the rate on any one day, and never
      // past the month's limit.
      const spend =
        Math.round(
          Math.max(
            0,
            Math.min(
              rate * factor * partial,
              rate * GOOGLE_DAILY_MULTIPLIER * partial,
              limit - monthSpend,
            ),
          ) * 100,
        ) / 100;
      monthSpend += spend;
      if (d <= SERIES_END_DAY) finalizedSpend += spend;
      series.push({
        objectId: campaignId,
        date: `${PERIOD}-${pad(d)}`,
        spend,
        dailyBudget: rate,
      });
    }

    // Reference metrics for the insights line (addendum §4.3). Derived from the
    // spend this campaign actually generated above, so cost/conv and avg CPC —
    // which the panel computes from spend ÷ the counter — land on sane numbers
    // instead of contradicting the dollars beside them.
    const cpc = 1.4 + 2.6 * rnd();
    const clicks = Math.max(1, Math.round(finalizedSpend / cpc));
    const ctr = 0.035 + 0.055 * rnd();
    const impressions = Math.round(clicks / ctr);
    const convRate = 0.04 + 0.09 * rnd();
    const conversions = Math.round(clicks * convRate);
    // Impression share is Search/Shopping only — PMax rows carry nulls so the
    // panel renders its "Not available" state rather than a fabricated figure.
    const isSearch = !r.name.startsWith('PMAX');
    // Lost-to-budget is high where the budget is genuinely the constraint and
    // near zero where it is not; lost-to-rank is the opposite. The pair is what
    // the move decision reads, so they must not both be high on one row.
    const budgetLostIs = r.delivery === 'tocap' ? 0.34 + 0.12 * rnd() : 0.01 + 0.03 * rnd();
    const rankLostIs = r.delivery === 'cant' ? 0.48 + 0.15 * rnd() : 0.12 + 0.1 * rnd();

    const finalRate = rateOn(lastDay);
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
        allocation: r.total ? totalBudgetAllocation.toFixed(2) : undefined,
        allocationPercent: r.total ? null : String(r.pct),
        // Spend to the DATA EDGE, summed from the series above rather than
        // hand-written. The two used to be independent numbers, so the panel's
        // chart and the row's Spent MTD quietly disagreed by whatever the
        // generator happened to produce.
        pacerActual: finalizedSpend.toFixed(2),
        pacerDailyBudget: r.daily > 0 ? finalRate.toFixed(2) : null,
        pacerLocked: r.locked ?? false,
        pacerTags: r.tags?.length ? JSON.stringify(r.tags) : null,
        googleCampaignId: campaignId,
        googleChannelType: isSearch ? 'Search' : 'PMax',
        googleEffectiveStatus: 'ENABLED',
        // §2.1 — the row's status line reads these: the word first, then why.
        googlePrimaryStatus: 'ELIGIBLE',
        googlePrimaryStatusReasons: JSON.stringify(
          r.constrained
            ? ['BUDGET_CONSTRAINED']
            : r.disapproved
              ? ['HAS_ADS_DISAPPROVED']
              : r.delivery === 'cant'
                ? ['SEARCH_VOLUME_LIMITED']
                : [],
        ),
        googleBudgetResourceName: `customers/${CUSTOMER_ID}/campaignBudgets/${campaignId}`,
        googleBudgetPeriod: r.total ? 'CUSTOM_PERIOD' : 'DAILY',
        googleBudgetReferenceCount: r.sharedCount ?? 1,
        googleStartDate: r.startDay ? `${PERIOD}-${pad(r.startDay)}` : '2025-04-14',
        googleEndDate: r.total ? `${PERIOD}-20` : null,
        googleAdsDisapproved: r.disapproved ?? false,
        googleBudgetConstrained: r.constrained ?? false,
        googleHasAdSchedule: r.schedule ?? false,
        googleImpressions: impressions,
        googleClicks: clicks,
        googleConversions: conversions.toFixed(2),
        googleConvRate: convRate.toFixed(4),
        googleSearchBudgetLostIs: isSearch ? budgetLostIs.toFixed(4) : null,
        googleSearchRankLostIs: isSearch ? rankLostIs.toFixed(4) : null,
        googleMetricsAsOf: `${PERIOD}-${pad(SERIES_END_DAY)}`,
        pacerSyncedAt: new Date(`${TODAY}T14:00:00Z`),
      },
    });
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

  console.log(
    `seeded ${ROWS.length} google campaigns + ${series.length} daily-spend rows for ${PERIOD} ` +
      `(finalized through ${PERIOD}-${pad(SERIES_END_DAY)}${CURRENT_MONTH ? `, partial today ${TODAY}` : ''}), ` +
      `linked to Google customer ${CUSTOMER_ID}`,
  );
  await prisma.$disconnect();
})();
