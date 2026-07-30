/**
 * Drop the retired Ad Types taxonomy (replaced by the shared Category + Tags
 * model). Runs BEFORE `prisma db push` in the deploy so the destructive drop is
 * applied deliberately here — the guarded `db push` (no --accept-data-loss)
 * would otherwise refuse to drop the non-empty `AdType` table and abort the
 * whole deploy.
 *
 * Fully idempotent (`IF EXISTS`): a no-op once the objects are gone, so it's safe
 * to leave in the deploy pipeline. Raw SQL — no Prisma model needed (the client
 * is generated from the current schema, which no longer defines AdType).
 *
 * Loads dotenv because it builds its OWN client rather than going through
 * `@/lib/prisma`, and so gets none of Next's env loading. In deploy DATABASE_URL is
 * already exported and dotenv won't override it; run locally without this, the pg
 * adapter silently falls back to libpq defaults and fails with
 * `DatabaseDoesNotExist` — which reads like a missing database rather than a
 * missing variable, so it takes a while to see.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  // Dropping the columns also drops their indexes; DROP TABLE removes AdType.
  const statements = [
    'ALTER TABLE "AdTemplateDoc" DROP COLUMN IF EXISTS "adTypeId"',
    'ALTER TABLE "AdCreative" DROP COLUMN IF EXISTS "adTypeId"',
    'DROP TABLE IF EXISTS "AdType"',
  ];
  for (const sql of statements) {
    await prisma.$executeRawUnsafe(sql);
    console.log(`[drop-retired-ad-types] ok: ${sql}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[drop-retired-ad-types] failed', e);
    process.exit(1);
  });
