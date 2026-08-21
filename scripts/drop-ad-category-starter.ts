/**
 * Drop the retired `AdCategoryStarter` table.
 *
 * WHAT IT WAS. A per-template-Category starter field set: picking a category in
 * the builder was supposed to seed those fields. It shipped with a full CRUD API
 * (`/api/ad-generator/category-starters`) and a seed script that ran on every
 * deploy, and it was **never wired to anything** — the only references in the
 * repo were the route itself and its own seed script. No UI called it and no
 * runtime code read it.
 *
 * WHY IT GOES NOW. Offer kinds (`src/lib/ad-generator/offer-kinds.ts`) do the
 * same job properly: a kind bundles the field schema with the offer types,
 * disclaimer slugs and capability flags that have to agree with it — none of
 * which a JSON field blob can carry. Leaving both in place would mean two
 * competing answers to "where does a template's field schema come from", and the
 * next person would wire the wrong one. `AdTemplateFieldPref` already covers the
 * real per-rooftop need (hiding fields a dealer never uses).
 *
 * Runs BEFORE `prisma db push` in the deploy: the guarded push (no
 * --accept-data-loss) refuses to drop a non-empty table and would abort the whole
 * deploy. Same pattern as drop-media-folders.ts and drop-organization-model.ts.
 *
 * It REPORTS the row count before destroying it. The expected answer is 1 — the
 * seeded "Vehicle Offer" row, whose fields are a stale copy of the vehicle
 * kind's schema. Anything higher means someone did reach the API after all, and
 * a line in the deploy log is what makes that visible rather than silent.
 *
 * Idempotent: once the table is gone the information_schema check shorts out, so
 * it is safe to leave in the deploy pipeline.
 *
 * Loads dotenv for the same reason as the other drop scripts: it builds its own
 * client, so without this `npm run db:sync` fails locally with
 * `DatabaseDoesNotExist` from the libpq fallback.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as never);

const TAG = '[drop-ad-category-starter]';

async function main() {
  const exists = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = $1`,
    'AdCategoryStarter',
  );
  if (Number(exists[0]?.n ?? 0) === 0) {
    console.log(`${TAG} already removed — nothing to do.`);
    return;
  }

  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM "AdCategoryStarter"`,
  );
  const n = Number(rows[0]?.n ?? 0);
  if (n > 1) {
    console.warn(
      `${TAG} WARNING: ${n} row(s) present, expected at most 1 (the seeded `
        + `"Vehicle Offer" starter). Nothing read this table, so no template loses `
        + `a field — but someone did write to it.`,
    );
  } else {
    console.log(`${TAG} dropping AdCategoryStarter (${n} row(s)).`);
  }

  await prisma.$executeRawUnsafe(`DROP TABLE "AdCategoryStarter"`);
  console.log(`${TAG} dropped AdCategoryStarter.`);
}

main()
  .catch((err) => {
    console.error(`${TAG} failed:`, err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
