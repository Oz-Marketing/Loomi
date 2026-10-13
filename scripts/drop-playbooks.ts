/**
 * Drop the retired Playbooks feature.
 *
 * Playbooks (the coverage audit, the agency-wide creative library and the
 * nightly coverage sweep) was removed 2026-10-13 to be revisited as a team
 * later. Nothing in daily use depended on it: a playbook only PRESET the
 * creative columns on `AdAutomationConfig`, which stayed the source of truth
 * for what a run uses, so unlinking every account changes no run.
 *
 * Runs BEFORE `prisma db push` in the deploy: the guarded push (no
 * --accept-data-loss) refuses to drop a non-empty table or a populated column
 * and aborts the whole deploy — `PlaybookRun` gains a row every night. Same
 * pattern as drop-media-folders.ts.
 *
 * Also clears what the schema can't see:
 *   - the pg-boss schedule for `loomi.playbooks.sweep`, which would otherwise
 *     keep enqueuing a nightly job no worker handles;
 *   - `playbook_drift` bell notifications and preferences, a type the
 *     notification registry no longer knows.
 *
 * It REPORTS what it's about to destroy before doing it, so the deploy log
 * records how much authored data went with it.
 *
 * Idempotent: once everything is gone the existence checks short out and it's
 * a no-op, so it's safe to leave in the deploy pipeline.
 *
 * Raw SQL throughout — the generated client no longer knows these models.
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

const TAG = '[drop-playbooks]';
const SWEEP_QUEUE = 'loomi.playbooks.sweep';
const TABLES = ['PlaybookCheckWaiver', 'PlaybookRun', 'Playbook'] as const;

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
    table,
    column,
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function tableExists(table: string, schema?: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    schema
      ? `SELECT COUNT(*)::bigint AS n FROM information_schema.tables
          WHERE table_schema = $2 AND table_name = $1`
      : `SELECT COUNT(*)::bigint AS n FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = $1`,
    ...(schema ? [table, schema] : [table]),
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function count(sql: string, ...params: unknown[]): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(sql, ...params);
  return Number(rows[0]?.n ?? 0);
}

async function main() {
  const hasColumn = await columnExists('AdAutomationConfig', 'playbookId');
  const present = [];
  for (const t of TABLES) if (await tableExists(t)) present.push(t);

  // ── schema ──
  if (hasColumn) {
    const linked = await count(
      `SELECT COUNT(*)::bigint AS n FROM "AdAutomationConfig" WHERE "playbookId" IS NOT NULL`,
    );
    console.log(
      `${TAG} ${linked} automation config(s) were linked to a playbook. Their creative `
        + `settings are untouched — only the link is being dropped.`,
    );
    // Column first: it holds the FK into "Playbook", so dropping the table while
    // the constraint stands would fail.
    await prisma.$executeRawUnsafe(`ALTER TABLE "AdAutomationConfig" DROP COLUMN "playbookId"`);
    console.log(`${TAG} dropped AdAutomationConfig.playbookId.`);
  }
  for (const t of present) {
    const n = await count(`SELECT COUNT(*)::bigint AS n FROM "${t}"`);
    await prisma.$executeRawUnsafe(`DROP TABLE "${t}"`);
    console.log(`${TAG} dropped ${t} (${n} row(s)).`);
  }

  // ── the nightly sweep's schedule ──
  //
  // Only the schedule: it is what keeps creating jobs. The queue row and any
  // already-queued jobs are inert without a worker and expire on their own.
  if (await tableExists('schedule', 'pgboss')) {
    const removed = await prisma.$executeRawUnsafe(
      `DELETE FROM pgboss.schedule WHERE name = $1`,
      SWEEP_QUEUE,
    );
    if (removed > 0) console.log(`${TAG} removed the ${SWEEP_QUEUE} schedule.`);
  }

  // ── notifications of a type that no longer exists ──
  const notes = await prisma.$executeRawUnsafe(
    `DELETE FROM "Notification" WHERE type = 'playbook_drift'`,
  );
  const prefs = await prisma.$executeRawUnsafe(
    `DELETE FROM "NotificationPreference" WHERE type = 'playbook_drift'`,
  );
  if (notes > 0 || prefs > 0) {
    console.log(`${TAG} removed ${notes} playbook_drift notification(s) and ${prefs} preference(s).`);
  }

  // ── the help article ──
  //
  // `seed-docs.ts` deliberately never deletes a row whose file was removed, so
  // the Playbooks article would stay in the help library for good. Deleted even
  // if it was edited in the app: the feature it describes is gone.
  const article = await prisma.$executeRawUnsafe(
    `DELETE FROM "DocArticle" WHERE "sourceKey" = 'studio/playbooks.md'`,
  );
  if (article > 0) console.log(`${TAG} removed the Playbooks help article.`);

  // Articles whose Playbooks mentions were edited out in the same change. The
  // seeder only refreshes rows nobody has edited in the app, so an edited row
  // keeps describing Playbooks until someone fixes it by hand. Report, never
  // overwrite — the in-app edit is the one somebody chose.
  const latched = await prisma.$queryRawUnsafe<{ slug: string }[]>(
    `SELECT slug FROM "DocArticle"
      WHERE "sourceKey" IN ('platform/notifications.md', 'agency/industries-and-blueprints.md')
        AND "editedInApp" = true AND body ILIKE '%playbook%'`,
  );
  for (const r of latched) {
    console.warn(
      `${TAG} WARNING: help article "${r.slug}" was edited in the app and still mentions `
        + `Playbooks — the seeder won't update it. Edit it in Loomi.`,
    );
  }

  // The in-app AI's knowledge base is seeded from loomi-knowledge.md ONCE and
  // edited in the app after that, so the file's edit never reaches it. Report
  // rather than rewrite: the stored copy has diverged from the file on purpose.
  const knowledge = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM "AppSetting"
      WHERE key = 'loomi-knowledge' AND value ILIKE '%playbook%'`,
  );
  if (Number(knowledge[0]?.n ?? 0) > 0) {
    console.warn(
      `${TAG} WARNING: the AI knowledge base (AppSetting "loomi-knowledge") still mentions `
        + `Playbooks. Edit it in the app so the assistant stops describing a removed feature.`,
    );
  }

  if (!hasColumn && present.length === 0 && notes === 0 && prefs === 0 && article === 0) {
    console.log(`${TAG} already removed — nothing to do.`);
  }
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
