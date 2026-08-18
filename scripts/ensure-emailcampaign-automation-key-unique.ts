/**
 * Create EmailCampaign's `automationKey` column + unique index.
 *
 * WHY THIS EXISTS. `automationKey` ("adgen:<accountKey>:<period>") is what makes
 * the companion offer email idempotent: a re-run of the same period must find
 * and refresh the existing draft rather than filing a second one. The unique
 * index is the thing that makes "already drafted this period" a fact rather
 * than a race between two overlapping automation runs.
 *
 * It's a script rather than just `@unique` in the schema because `db push`
 * REFUSES to add a unique constraint to an existing table unsupervised — it
 * stops the whole deploy asking for `--accept-data-loss`, and adding that flag
 * permanently would apply it to every future schema change, silently dropping
 * columns on deploy. Same reason and same shape as
 * `ensure-changelog-sourcekey-unique.ts`, and it runs in `deploy:prepare`
 * BEFORE `db push` for the same reason: once the index exists, push has nothing
 * to ask about.
 *
 * CI never hits this — it pushes to a fresh database, where the constraint is
 * born with the table. Only staging and production, which have existing rows,
 * need the script.
 *
 * The column is created here too, since the index needs it and `db push` is the
 * step this script exists to get past.
 *
 * Idempotent (catalog checks), so it is safe to leave in the pipeline forever.
 *
 * It cannot conflict with existing data: every hand-built and campaign-built
 * blast leaves `automationKey` null, and nulls don't collide in a Postgres
 * unique index. If real duplicates somehow exist it reports them and exits
 * non-zero rather than deleting anyone's drafts.
 *
 * Note the table is `EmailCampaign` — `EmailBlast` is the Prisma model name and
 * `@@map`s onto the older column name.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

const INDEX = 'EmailCampaign_automationKey_key';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[ensure-emailcampaign-automation-key-unique] DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    // Nothing to do before the table exists — `db push` creates it, and the next
    // run of this script adds the index.
    const [{ exists }] = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT to_regclass('public."EmailCampaign"') IS NOT NULL AS exists`,
    );
    if (!exists) {
      console.log(
        '[ensure-emailcampaign-automation-key-unique] EmailCampaign does not exist yet — nothing to do',
      );
      return;
    }

    const already = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
      INDEX,
    );
    if (already.length > 0) {
      console.log(`[ensure-emailcampaign-automation-key-unique] ${INDEX} already present — no-op`);
      return;
    }

    await prisma.$executeRawUnsafe(
      `ALTER TABLE public."EmailCampaign" ADD COLUMN IF NOT EXISTS "automationKey" TEXT`,
    );

    const dupes = await prisma.$queryRawUnsafe<{ automationKey: string; n: bigint }[]>(
      `SELECT "automationKey", COUNT(*) AS n
         FROM public."EmailCampaign"
        WHERE "automationKey" IS NOT NULL
        GROUP BY 1
       HAVING COUNT(*) > 1`,
    );
    if (dupes.length > 0) {
      console.error(
        `[ensure-emailcampaign-automation-key-unique] REFUSING: ${dupes.length} automation key(s) appear more than once:`,
      );
      for (const d of dupes) console.error(`  ${d.automationKey} — ${d.n} rows`);
      console.error('Delete the duplicate drafts, then re-run. Nothing was deleted.');
      process.exit(1);
    }

    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "${INDEX}" ON public."EmailCampaign" ("automationKey")`,
    );
    console.log(`[ensure-emailcampaign-automation-key-unique] created ${INDEX}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[ensure-emailcampaign-automation-key-unique] failed:', err);
  process.exit(1);
});
