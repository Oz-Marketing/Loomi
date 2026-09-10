/**
 * One OPEN generate run per account, enforced by Postgres.
 *
 * WHY. Nothing stopped two offer runs for one account from overlapping — a
 * hand run at 06:30 UTC, two staff on one account, a double-submit across
 * tabs. Ads survived (the creative upsert is a native compound-unique upsert)
 * but once the run owns the Campaign container, overlap means both runs miss
 * the lookup, both create, and the second violates the container's unique key
 * AFTER its own row exists. A partial unique index on the open run row
 * (`finishedAt IS NULL`) makes the second `beginRun` insert fail with 23505,
 * which the orchestrator maps to a 409 — atomic, and the mechanism this repo
 * already uses for AdLaunch.
 *
 * Runs that died without finishing (the process was killed mid-run) would hold
 * the lock forever, so any open row older than 15 minutes is closed as
 * `abandoned` first — here, so the index can be created, and on every
 * `beginRun` after that as the recovery path.
 *
 * AFTER `db push`, unlike the other ensure scripts: a partial index cannot be
 * declared in the Prisma schema, and `db push` drops any index the schema does
 * not know about — so one created before the push is gone by the time the app
 * starts. Idempotent via catalog checks, so it simply re-creates it each deploy
 * if push removed it.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

const TAG = '[ensure-adrun-inflight-unique]';
const INDEX = 'AdAutomationRun_inflight_key';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(`${TAG} DATABASE_URL is not set`);
    process.exit(1);
  }
  const needsSsl = /[?&]sslmode=require/.test(connectionString);
  const cleanUrl = connectionString.replace(/[?&]sslmode=require/, (m) => (m.startsWith('?') ? '?' : '')).replace(/\?$/, '');
  const pool = new pg.Pool({ connectionString: cleanUrl, ...(needsSsl && { ssl: { rejectUnauthorized: false } }) });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const [{ exists }] = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT to_regclass('public."AdAutomationRun"') IS NOT NULL AS exists`,
    );
    if (!exists) {
      console.log(`${TAG} AdAutomationRun does not exist yet — nothing to do`);
      return;
    }
    const already = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
      INDEX,
    );
    if (already.length > 0) {
      console.log(`${TAG} ${INDEX} already present — no-op`);
      return;
    }
    // Close anything that has been "running" for over 15 minutes — a dead run,
    // not a slow one — and any exact duplicates, so the index can be built.
    const closed = await prisma.$executeRawUnsafe(
      `UPDATE public."AdAutomationRun" SET "finishedAt" = NOW(), error = COALESCE(error, 'abandoned')
        WHERE "finishedAt" IS NULL AND "startedAt" < NOW() - INTERVAL '15 minutes'`,
    );
    const dupes = await prisma.$executeRawUnsafe(
      `UPDATE public."AdAutomationRun" r SET "finishedAt" = NOW(), error = COALESCE(error, 'abandoned')
        WHERE r."finishedAt" IS NULL AND r.id <> (
          SELECT id FROM public."AdAutomationRun" x
           WHERE x."accountKey" IS NOT DISTINCT FROM r."accountKey" AND x.kind = r.kind AND x."finishedAt" IS NULL
           ORDER BY x."startedAt" DESC LIMIT 1)`,
    );
    if (closed || dupes) console.log(`${TAG} closed ${closed} stale and ${dupes} duplicate open run(s) as abandoned`);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "${INDEX}" ON public."AdAutomationRun" ("accountKey", kind) WHERE "finishedAt" IS NULL`,
    );
    console.log(`${TAG} created ${INDEX}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`${TAG} failed:`, err);
  process.exit(1);
});
