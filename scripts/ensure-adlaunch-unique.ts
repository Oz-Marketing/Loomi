/**
 * Create AdLaunch's publish-idempotency unique index — PARTIAL, so a failed launch
 * can be retried.
 *
 * WHY THIS EXISTS. `AdLaunch` fronts a side effect that spends money: a network
 * timeout on the Graph call followed by a retry must not create a second ad. The
 * row is written before the first platform call and the uniqueness is what makes
 * that safe.
 *
 * But a plain unique index over (accountKey, platform, offerKey) would ALSO cover
 * `failed` rows — so the first failure would permanently block its own retry, and
 * the offer could never be launched again without someone deleting a row by hand.
 * The constraint therefore has to exclude terminal states:
 *
 *     UNIQUE (accountKey, platform, offerKey) WHERE status IN
 *       ('queued', 'publishing', 'published')
 *
 * Prisma's schema language cannot express a partial index, which is why this is a
 * script and not an `@@unique`. Same reason and same shape as
 * `ensure-adcreative-offer-unique.ts`, and it runs in `deploy:prepare` BEFORE
 * `db push` for the same reason: db push refuses to add a unique constraint
 * unsupervised, and adding `--accept-data-loss` to make it comply would apply that
 * flag to every future schema change, silently dropping columns on deploy.
 *
 * Idempotent (`IF NOT EXISTS` semantics via a catalog check), so it is safe to
 * leave in the pipeline permanently.
 *
 * NOTE it cannot conflict with existing data: `status` is only ever one of the five
 * values, and a duplicate live launch for one offer is exactly what we intend to
 * forbid. If real duplicates somehow exist, this reports them and exits non-zero
 * rather than deleting anyone's launch records.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

const INDEX = 'AdLaunch_live_offer_key';
const LIVE_STATUSES = ['queued', 'publishing', 'published'];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[ensure-adlaunch-unique] DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    // Nothing to do before the table exists — `db push` creates it, and the next
    // run of this script adds the index.
    const [{ exists }] = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT to_regclass('public."AdLaunch"') IS NOT NULL AS exists`,
    );
    if (!exists) {
      console.log('[ensure-adlaunch-unique] AdLaunch does not exist yet — nothing to do');
      return;
    }

    const already = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
      INDEX,
    );
    if (already.length > 0) {
      console.log(`[ensure-adlaunch-unique] ${INDEX} already present — no-op`);
      return;
    }

    // The columns arrive with `db push`; if they aren't there yet this is a no-op
    // and the next deploy picks it up.
    const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'AdLaunch'
          AND column_name IN ('accountKey', 'platform', 'offerKey', 'status')`,
    );
    if (cols.length < 4) {
      console.log('[ensure-adlaunch-unique] AdLaunch columns not all present yet — nothing to do');
      return;
    }

    const dupes = await prisma.$queryRawUnsafe<{ accountKey: string; platform: string; offerKey: string; n: bigint }[]>(
      `SELECT "accountKey", "platform", "offerKey", COUNT(*) AS n
         FROM public."AdLaunch"
        WHERE "offerKey" IS NOT NULL AND "status" = ANY($1::text[])
        GROUP BY 1, 2, 3
       HAVING COUNT(*) > 1`,
      LIVE_STATUSES,
    );
    if (dupes.length > 0) {
      console.error(
        `[ensure-adlaunch-unique] REFUSING: ${dupes.length} offer(s) already have more than one live launch:`,
      );
      for (const d of dupes) {
        console.error(`  ${d.accountKey} / ${d.platform} / ${d.offerKey} — ${d.n} rows`);
      }
      console.error('Resolve these by cancelling the duplicates, then re-run. Nothing was deleted.');
      process.exit(1);
    }

    // `offerKey IS NOT NULL` as well: a launch with no offer (a hand-assembled one)
    // must not collide with every other such launch.
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "${INDEX}"
         ON public."AdLaunch" ("accountKey", "platform", "offerKey")
       WHERE "offerKey" IS NOT NULL AND "status" IN ('queued', 'publishing', 'published')`,
    );
    console.log(`[ensure-adlaunch-unique] created ${INDEX}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[ensure-adlaunch-unique] failed:', err);
  process.exit(1);
});
