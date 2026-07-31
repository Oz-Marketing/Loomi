/**
 * Create the AdCreative offer-idempotency unique index, deliberately, BEFORE the
 * guarded `prisma db push` in the deploy.
 *
 * WHY THIS EXISTS. `@@unique([accountKey, templateId, offerFingerprint])` is what
 * makes unattended generation idempotent — re-running a generate must refresh the
 * existing draft for an offer rather than mint a second one. But `db push` runs
 * without `--accept-data-loss`, and adding a unique constraint is a change it
 * refuses to make unsupervised, because it cannot know whether existing rows
 * already collide. The first staging deploy of this work failed on exactly that.
 *
 * Adding `--accept-data-loss` to the deploy would have "fixed" it and been a bad
 * trade: that flag is not scoped to this one change, so from then on EVERY future
 * schema edit would silently drop columns and tables on deploy. This script keeps
 * the guard intact and makes this one change explicit — the same reason
 * `drop-retired-ad-types` and `drop-organization-model` exist.
 *
 * REFUSES RATHER THAN DELETES. If real duplicates exist, this reports them and
 * exits non-zero. Removing creatives to satisfy a constraint is a judgement call
 * about someone's approved ads, not something a deploy step should make quietly.
 * In practice duplicates are near-impossible: `offerFingerprint` is null on every
 * pre-existing row, and Postgres treats nulls as distinct in a unique index.
 *
 * Idempotent (`IF NOT EXISTS`) — a no-op once the index is in place, so it's safe
 * to leave in the pipeline permanently.
 *
 * Loads dotenv because it builds its own client rather than going through
 * `@/lib/prisma`; without it the pg adapter falls back to libpq defaults and fails
 * with `DatabaseDoesNotExist`, which reads like a missing database rather than a
 * missing variable.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

/** Prisma's own name for this constraint. It must match, or `db push` will see the
 *  index as unrelated and try to add its own. */
const INDEX = 'AdCreative_accountKey_templateId_offerFingerprint_key';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[ensure-adcreative-offer-unique] DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    // Nothing to do if the table hasn't been created yet — `db push` will create it
    // with the constraint already in place.
    const [{ exists }] = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT to_regclass('public."AdCreative"') IS NOT NULL AS exists`,
    );
    if (!exists) {
      console.log('[ensure-adcreative-offer-unique] AdCreative does not exist yet — nothing to do');
      return;
    }

    const already = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
      INDEX,
    );
    if (already.length > 0) {
      console.log(`[ensure-adcreative-offer-unique] ${INDEX} already present — no-op`);
      return;
    }

    // The column is new, so it may not exist on an older database. Without this the
    // duplicate query below would throw a confusing "column does not exist".
    const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'AdCreative'
          AND column_name IN ('accountKey','templateId','offerFingerprint')`,
    );
    if (cols.length < 3) {
      console.log(
        `[ensure-adcreative-offer-unique] AdCreative is missing ${3 - cols.length} of the three columns — ` +
          'leaving the index to `db push`, which will add them together',
      );
      return;
    }

    const dupes = await prisma.$queryRawUnsafe<
      { accountKey: string; templateId: string; offerFingerprint: string; n: bigint }[]
    >(
      `SELECT "accountKey", "templateId", "offerFingerprint", COUNT(*) AS n
         FROM "AdCreative"
        WHERE "offerFingerprint" IS NOT NULL
        GROUP BY 1, 2, 3
       HAVING COUNT(*) > 1
        ORDER BY n DESC
        LIMIT 20`,
    );
    if (dupes.length > 0) {
      console.error(
        `[ensure-adcreative-offer-unique] REFUSING: ${dupes.length} duplicate (accountKey, templateId, offerFingerprint) group(s) exist.\n` +
          'The unique index cannot be created until these are resolved. Deleting creatives to satisfy a\n' +
          'constraint is a decision about approved ads, so this script will not do it for you. Inspect:\n',
      );
      for (const d of dupes) {
        console.error(`  ${d.n}×  account=${d.accountKey}  template=${d.templateId}  offer=${d.offerFingerprint}`);
      }
      process.exit(1);
    }

    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${INDEX}"
         ON "AdCreative" ("accountKey", "templateId", "offerFingerprint")`,
    );
    console.log(`[ensure-adcreative-offer-unique] created ${INDEX}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[ensure-adcreative-offer-unique] failed:', err);
  process.exit(1);
});
