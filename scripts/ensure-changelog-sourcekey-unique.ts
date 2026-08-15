/**
 * Create ChangelogEntry's `sourceKey` column + unique index.
 *
 * WHY THIS EXISTS. `sourceKey` ("pr:412#0") is what makes the merge-to-main
 * importer idempotent: re-running the workflow, or re-merging after a revert,
 * must not file the same release note twice. The unique index is the thing that
 * makes "already imported" a fact rather than a race between two concurrent
 * webhook deliveries.
 *
 * It's a script rather than just `@unique` in the schema because `db push`
 * REFUSES to add a unique constraint unsupervised — it stops the whole deploy
 * asking for `--accept-data-loss`, and adding that flag permanently would apply
 * it to every future schema change, silently dropping columns on deploy. Same
 * reason and same shape as `ensure-adsize-builtin-unique.ts`, and it runs in
 * `deploy:prepare` BEFORE `db push` for the same reason: once the index exists,
 * push has nothing to ask about.
 *
 * The column is created here too, since the index needs it and `db push` is the
 * step this script exists to get past.
 *
 * Idempotent (catalog checks), so it is safe to leave in the pipeline forever.
 *
 * It cannot conflict with existing data: every pre-automation entry leaves
 * `sourceKey` null, and nulls don't collide in a Postgres unique index. If real
 * duplicates somehow exist it reports them and exits non-zero rather than
 * deleting anyone's entries.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

const INDEX = 'ChangelogEntry_sourceKey_key';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[ensure-changelog-sourcekey-unique] DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    // Nothing to do before the table exists — `db push` creates it, and the next
    // run of this script adds the index.
    const [{ exists }] = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT to_regclass('public."ChangelogEntry"') IS NOT NULL AS exists`,
    );
    if (!exists) {
      console.log(
        '[ensure-changelog-sourcekey-unique] ChangelogEntry does not exist yet — nothing to do',
      );
      return;
    }

    const already = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
      INDEX,
    );
    if (already.length > 0) {
      console.log(`[ensure-changelog-sourcekey-unique] ${INDEX} already present — no-op`);
      return;
    }

    await prisma.$executeRawUnsafe(
      `ALTER TABLE public."ChangelogEntry" ADD COLUMN IF NOT EXISTS "sourceKey" TEXT`,
    );

    const dupes = await prisma.$queryRawUnsafe<{ sourceKey: string; n: bigint }[]>(
      `SELECT "sourceKey", COUNT(*) AS n
         FROM public."ChangelogEntry"
        WHERE "sourceKey" IS NOT NULL
        GROUP BY 1
       HAVING COUNT(*) > 1`,
    );
    if (dupes.length > 0) {
      console.error(
        `[ensure-changelog-sourcekey-unique] REFUSING: ${dupes.length} source key(s) appear more than once:`,
      );
      for (const d of dupes) console.error(`  ${d.sourceKey} — ${d.n} rows`);
      console.error('Delete the duplicate entries, then re-run. Nothing was deleted.');
      process.exit(1);
    }

    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "${INDEX}" ON public."ChangelogEntry" ("sourceKey")`,
    );
    console.log(`[ensure-changelog-sourcekey-unique] created ${INDEX}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[ensure-changelog-sourcekey-unique] failed:', err);
  process.exit(1);
});
