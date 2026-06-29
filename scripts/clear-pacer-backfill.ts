/**
 * One-time cleanup: undo Meta history backfill across ALL accounts. Clears the
 * `historicalActual` that the backfill route pulled for pre-tool (untracked)
 * months so it stops tainting Reconciliation variance. Mirrors the per-account
 * `clearBackfillHistory` lib fn (kept self-contained so it runs against a prod
 * DATABASE_URL without the app runtime).
 *
 * SAFE: only ever touches PeriodBudget rows that (a) have a non-null
 * historicalActual AND (b) have no tracked ad rows in that period. Tracked
 * (April-forward) months have no historicalActual, so real spend is never
 * affected. A row whose only content was the backfill is deleted; a row that
 * also carries a typed budget goal / carryover keeps those and just loses the
 * backfilled actual.
 *
 * Usage:
 *   npx tsx scripts/clear-pacer-backfill.ts            # dry run — prints what it WOULD clear
 *   npx tsx scripts/clear-pacer-backfill.ts --apply    # actually clear
 *   npx tsx scripts/clear-pacer-backfill.ts --apply --year=2026   # scope to one year
 *
 * NOT wired into the deploy pipeline — it's a deliberate, destructive one-off.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any);

const apply = process.argv.includes('--apply');
const yearArg = process.argv.find((a) => a.startsWith('--year='));
const year = yearArg ? Number(yearArg.split('=')[1]) : undefined;

async function main() {
  const plans = await prisma.metaAdsPacerPlan.findMany({
    select: { id: true, accountKey: true },
  });

  let totalCleared = 0;
  for (const plan of plans) {
    const trackedRows = await prisma.metaAdsPacerAd.findMany({
      where: { planId: plan.id },
      select: { period: true },
      distinct: ['period'],
    });
    const tracked = new Set(trackedRows.map((r) => r.period));

    const rows = await prisma.metaAdsPacerPeriodBudget.findMany({
      where: {
        planId: plan.id,
        historicalActual: { not: null },
        ...(year ? { period: { startsWith: `${year}-` } } : {}),
      },
    });

    const targets = rows.filter((r) => !tracked.has(r.period));
    if (targets.length === 0) continue;

    for (const row of targets) {
      const pureBackfill =
        row.baseBudgetGoal == null &&
        row.addedBudgetGoal == null &&
        row.googleBaseBudgetGoal == null &&
        row.googleAddedBudgetGoal == null &&
        row.baseCarryover == null &&
        row.addedCarryover == null &&
        row.googleBaseCarryover == null &&
        row.googleAddedCarryover == null;

      const verb = pureBackfill ? 'delete row' : 'null historicalActual';
      // eslint-disable-next-line no-console
      console.log(
        `  ${plan.accountKey} ${row.period}: $${row.historicalActual} → ${verb}`,
      );

      if (apply) {
        if (pureBackfill) {
          await prisma.metaAdsPacerPeriodBudget.delete({ where: { id: row.id } });
        } else {
          await prisma.metaAdsPacerPeriodBudget.update({
            where: { id: row.id },
            data: { historicalActual: null },
          });
        }
      }
      totalCleared++;
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `\n${apply ? 'Cleared' : '[dry run] would clear'} ${totalCleared} backfilled month(s) across ${plans.length} plan(s).` +
      (apply ? '' : '\nRe-run with --apply to commit.'),
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
