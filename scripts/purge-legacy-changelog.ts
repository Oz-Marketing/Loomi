/**
 * One-time purge of the pre-automation changelog entries.
 *
 * Two old seed scripts wrote a batch of Feb-2026 entries — scripts/seed-changelog.ts
 * (run by hand, random cuids) and scripts/seed-changelog-entries.ts (fixed ids,
 * and wired into `build` + `deploy:prepare`, so it re-upserted its rows on EVERY
 * deploy). That is why deleting them in the UI never stuck. Both scripts are gone
 * as of this change; this clears what they left behind.
 *
 * Guarded by an AppSetting key so it runs exactly once per environment. Without
 * that guard, any entry someone later backdates before the cutoff would be
 * silently deleted by the next deploy.
 *
 * Run: npx tsx scripts/purge-legacy-changelog.ts
 * Also runs as part of the deploy:prepare step.
 */
try { require('dotenv/config'); } catch { /* dotenv not available in production — env vars already set */ }
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:5432/loomi_studio?schema=public';

const pool = new pg.Pool({
  connectionString: connectionString.replace(/[?&]sslmode=require/, (m) =>
    m.startsWith('?') ? '?' : '',
  ).replace(/\?$/, ''),
  ...(connectionString.includes('sslmode=require') && { ssl: { rejectUnauthorized: false } }),
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/** Ran-once marker. Bump the suffix if a second purge is ever needed. */
const GUARD_KEY = 'changelog:legacy-purge:v1';

/**
 * Everything published before this is seed residue. Both old batches are dated
 * 2026-02-21/22; nothing real was written to the changelog between then and the
 * automation landing, so a clean cut is safer than matching ids one by one
 * (the seed-changelog.ts rows have random cuids and can't be matched by id).
 */
const CUTOFF = new Date('2026-03-01T00:00:00Z');

async function main() {
  const already = await prisma.appSetting.findUnique({ where: { key: GUARD_KEY } });
  if (already) {
    console.log(`Changelog purge: already ran (${already.value}), skipping.`);
    return;
  }

  const doomed = await prisma.changelogEntry.findMany({
    where: { publishedAt: { lt: CUTOFF } },
    select: { id: true, title: true, publishedAt: true },
    orderBy: { publishedAt: 'asc' },
  });

  for (const e of doomed) {
    console.log(`  - ${e.publishedAt.toISOString().slice(0, 10)}  ${e.title}`);
  }

  const { count } = await prisma.changelogEntry.deleteMany({
    where: { publishedAt: { lt: CUTOFF } },
  });

  await prisma.appSetting.create({
    data: { key: GUARD_KEY, value: `${new Date().toISOString()} deleted=${count}` },
  });

  console.log(`Changelog purge: deleted ${count} legacy entr${count === 1 ? 'y' : 'ies'}.`);
}

main()
  .catch((e) => {
    // Don't fail the deploy over a cosmetic cleanup.
    console.error('Changelog purge failed:', e);
    process.exit(0);
  })
  .finally(() => pool.end());
