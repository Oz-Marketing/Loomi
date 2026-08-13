/**
 * Create AdSizePreset's `builtinKey` column + unique index.
 *
 * WHY THIS EXISTS. `builtinKey` is what makes seeding the starter sizes safe to
 * run on every read: the seeder inserts with `skipDuplicates`, and the unique
 * index is the thing that makes "duplicate" mean anything. Without it, two
 * concurrent first-loads in a fresh environment would each insert a full set of
 * starters and the library would open with 34 sizes.
 *
 * It's a script rather than just `@@unique` in the schema because `db push`
 * REFUSES to add a unique constraint unsupervised — it stops the whole deploy
 * asking for `--accept-data-loss`, and adding that flag permanently would apply
 * it to every future schema change, silently dropping columns on deploy. Same
 * reason and same shape as `ensure-adlaunch-unique.ts`, and it runs in
 * `deploy:prepare` BEFORE `db push` for the same reason: once the index exists,
 * push has nothing to ask about.
 *
 * The column is created here too, since the index needs it and `db push` is the
 * step this script exists to get past.
 *
 * Idempotent (catalog checks), so it is safe to leave in the pipeline forever.
 *
 * It cannot conflict with existing data: `builtinKey` is only ever written by
 * the seeder, and every hand-added size leaves it null (nulls don't collide in a
 * Postgres unique index). If real duplicates somehow exist it reports them and
 * exits non-zero rather than deleting anyone's sizes.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

const INDEX = 'AdSizePreset_builtinKey_key';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[ensure-adsize-builtin-unique] DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    // Nothing to do before the table exists — `db push` creates it, and the next
    // run of this script adds the index.
    const [{ exists }] = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT to_regclass('public."AdSizePreset"') IS NOT NULL AS exists`,
    );
    if (!exists) {
      console.log('[ensure-adsize-builtin-unique] AdSizePreset does not exist yet — nothing to do');
      return;
    }

    const already = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
      INDEX,
    );
    if (already.length > 0) {
      console.log(`[ensure-adsize-builtin-unique] ${INDEX} already present — no-op`);
      return;
    }

    await prisma.$executeRawUnsafe(
      `ALTER TABLE public."AdSizePreset" ADD COLUMN IF NOT EXISTS "builtinKey" TEXT`,
    );

    const dupes = await prisma.$queryRawUnsafe<{ builtinKey: string; n: bigint }[]>(
      `SELECT "builtinKey", COUNT(*) AS n
         FROM public."AdSizePreset"
        WHERE "builtinKey" IS NOT NULL
        GROUP BY 1
       HAVING COUNT(*) > 1`,
    );
    if (dupes.length > 0) {
      console.error(`[ensure-adsize-builtin-unique] REFUSING: ${dupes.length} builtin key(s) appear more than once:`);
      for (const d of dupes) console.error(`  ${d.builtinKey} — ${d.n} rows`);
      console.error('Delete the duplicate size rows, then re-run. Nothing was deleted.');
      process.exit(1);
    }

    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "${INDEX}" ON public."AdSizePreset" ("builtinKey")`,
    );
    console.log(`[ensure-adsize-builtin-unique] created ${INDEX}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[ensure-adsize-builtin-unique] failed:', err);
  process.exit(1);
});
