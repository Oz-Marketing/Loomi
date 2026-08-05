/**
 * Assign `lineType` to budget lines that don't have one, from their channel.
 *
 * Every row imported from Oz Reports landed as 'unclassified', because the
 * column didn't exist when the import ran. The channel registry now says what
 * kind of money each channel carries, so this applies it.
 *
 * WHAT IT DELIBERATELY DOESN'T DO. Channels whose registry entry is itself
 * 'unclassified' — Other, Sponsorship, Group Sale, YAG, Auxiliary and friends,
 * roughly 13% of the imported ledger — stay unassigned. Nobody can tell from
 * the name whether "Group Sale" is media, a fee, or production, and guessing a
 * type for real money is worse than leaving it visibly unset: an unassigned
 * line shows up in the hub asking to be categorized, whereas a wrong one
 * quietly corrupts the margin figure for that client.
 *
 * Only touches rows still marked 'unclassified', so it never overrides a
 * decision a human already made. Idempotent — safe to leave in the pipeline
 * and safe to re-run.
 *
 * Loads dotenv because it builds its own client rather than going through
 * `@/lib/prisma`.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { BUDGET_CHANNELS } from '../src/lib/budget/channels';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[backfill-budget-line-type] DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const [{ exists }] = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT to_regclass('public."BudgetLine"') IS NOT NULL AS exists`,
    );
    if (!exists) {
      console.log('[backfill-budget-line-type] BudgetLine does not exist yet — nothing to do');
      return;
    }

    let updated = 0;
    // One UPDATE per channel rather than per row: 7,000+ lines across ~40
    // channels is 40 statements, not 7,000.
    for (const channel of BUDGET_CHANNELS) {
      if (channel.lineType === 'unclassified') continue;
      const n = await prisma.budgetLine.updateMany({
        where: { channel: channel.key, lineType: 'unclassified' },
        data: { lineType: channel.lineType },
      });
      if (n.count > 0) {
        updated += n.count;
        console.log(`  ${channel.key} → ${channel.lineType}: ${n.count}`);
      }
    }

    // What's left, and what it's worth — the target list for the human pass.
    const remaining = await prisma.budgetLine.groupBy({
      by: ['channel'],
      where: { lineType: 'unclassified', archivedAt: null },
      _count: { _all: true },
      _sum: { amount: true },
    });
    const totalLeft = remaining.reduce((s, r) => s + r._count._all, 0);
    const dollarsLeft = remaining.reduce((s, r) => s + Number(r._sum.amount ?? 0), 0);

    console.log(`[backfill-budget-line-type] assigned ${updated} line(s)`);
    if (totalLeft > 0) {
      console.log(
        `[backfill-budget-line-type] ${totalLeft} line(s) / $${dollarsLeft.toLocaleString('en-US', { maximumFractionDigits: 0 })} still need a human call:`,
      );
      for (const r of remaining.sort((a, b) => Number(b._sum.amount ?? 0) - Number(a._sum.amount ?? 0))) {
        const amt = Number(r._sum.amount ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
        console.log(`  ${r.channel ?? '(no channel)'}: ${r._count._all} line(s), $${amt}`);
      }
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[backfill-budget-line-type] failed:', err);
  process.exit(1);
});
