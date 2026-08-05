/**
 * Create the BudgetLine.externalId unique index, deliberately, BEFORE the
 * guarded `prisma db push` in the deploy.
 *
 * WHY THIS EXISTS. `externalId @unique` is what makes the Oz Reports budget
 * import idempotent — a second run must update the same 8,000 lines rather than
 * mint a second ledger. But `db push` runs without `--accept-data-loss`, and
 * adding a unique constraint is a change it refuses to make unsupervised,
 * because it cannot know whether existing rows already collide. The first
 * staging deploy of this work failed on exactly that, the same way the
 * AdCreative offer index did before it.
 *
 * Adding `--accept-data-loss` to the deploy would have "fixed" it and been a bad
 * trade: that flag is not scoped to this one change, so from then on EVERY
 * future schema edit would silently drop columns and tables on deploy. This
 * script keeps the guard intact and makes this one change explicit — the same
 * reason `ensure-adcreative-offer-unique` and `drop-retired-ad-types` exist.
 *
 * REFUSES RATHER THAN DELETES. If real duplicates exist, this reports them and
 * exits non-zero. Deleting budget lines to satisfy a constraint is a decision
 * about someone's money, not something a deploy step should make quietly. In
 * practice duplicates are impossible on the first run: `externalId` is null on
 * every pre-existing row, and Postgres treats nulls as distinct in a unique
 * index.
 *
 * Idempotent (`IF NOT EXISTS`) — a no-op once the index is in place, so it's
 * safe to leave in the pipeline permanently.
 *
 * Loads dotenv because it builds its own client rather than going through
 * `@/lib/prisma`; without it the pg adapter falls back to libpq defaults and
 * fails with `DatabaseDoesNotExist`, which reads like a missing database rather
 * than a missing variable.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

/** Prisma's own name for this constraint. It must match, or `db push` will see
 *  the index as unrelated and try to add its own. */
const INDEX = 'BudgetLine_externalId_key';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[ensure-budgetline-external-id-unique] DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    // Nothing to do if the table hasn't been created yet — `db push` will create
    // it with the column and constraint already in place.
    const [{ exists }] = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT to_regclass('public."BudgetLine"') IS NOT NULL AS exists`,
    );
    if (!exists) {
      console.log('[ensure-budgetline-external-id-unique] BudgetLine does not exist yet — nothing to do');
      return;
    }

    const already = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
      INDEX,
    );
    if (already.length > 0) {
      console.log(`[ensure-budgetline-external-id-unique] ${INDEX} already present — no-op`);
      return;
    }

    // The column is new, so on an existing database it won't be there yet — and
    // the index can't be built without it. Adding a nullable column is additive
    // and safe, so do it here; leaving it to `db push` doesn't work, because
    // push refuses the ENTIRE migration over the unique constraint and never
    // gets as far as the column.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "BudgetLine" ADD COLUMN IF NOT EXISTS "externalId" TEXT`,
    );

    const dupes = await prisma.$queryRawUnsafe<{ externalId: string; n: bigint }[]>(
      `SELECT "externalId", COUNT(*) AS n
         FROM "BudgetLine"
        WHERE "externalId" IS NOT NULL
        GROUP BY 1
       HAVING COUNT(*) > 1
        ORDER BY n DESC
        LIMIT 20`,
    );
    if (dupes.length > 0) {
      console.error(
        `[ensure-budgetline-external-id-unique] REFUSING: ${dupes.length} duplicate externalId value(s) exist.\n` +
          'The unique index cannot be created until these are resolved. Deleting budget lines to satisfy a\n' +
          'constraint is a decision about real money, so this script will not do it for you. Inspect:\n',
      );
      for (const d of dupes) {
        console.error(`  ${d.n}×  ${d.externalId}`);
      }
      process.exit(1);
    }

    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${INDEX}" ON "BudgetLine" ("externalId")`,
    );
    console.log(`[ensure-budgetline-external-id-unique] created ${INDEX}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[ensure-budgetline-external-id-unique] failed:', err);
  process.exit(1);
});
