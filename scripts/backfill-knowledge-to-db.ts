/**
 * One-time backfill: import the AI knowledge base from the old
 * loomi-knowledge.md file into the AppSetting table (key "loomi-knowledge").
 *
 * The file used to live on the release filesystem and was reverted to the
 * committed version on every deploy. This imports the *current* file contents
 * (read from a path you pass in — usually the previous release dir) the first
 * time, then never overwrites again so UI edits aren't clobbered.
 *
 * Usage:
 *   npx tsx scripts/backfill-knowledge-to-db.ts <path-to-loomi-knowledge.md> [--confirm]
 *
 * Idempotent: only writes when the AppSetting row is absent. Safe to leave in
 * the deploy pipeline — becomes a no-op once seeded.
 */
import fs from 'fs';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

const KEY = 'loomi-knowledge';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  const filePath = args.find((a) => !a.startsWith('--'));

  if (!filePath) {
    console.error('[backfill-knowledge] Usage: backfill-knowledge-to-db.ts <path> [--confirm]');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.log(`[backfill-knowledge] No file at ${filePath} — nothing to import.`);
    return;
  }

  const existing = await prisma.appSetting.findUnique({ where: { key: KEY }, select: { key: true } });
  if (existing) {
    console.log('[backfill-knowledge] AppSetting row already exists — skipping (UI edits preserved).');
    return;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  console.log(`[backfill-knowledge] Read ${content.length} chars from ${filePath}.`);

  if (!confirm) {
    console.log('[backfill-knowledge] DRY RUN — pass --confirm to write. No changes made.');
    return;
  }

  await prisma.appSetting.create({ data: { key: KEY, value: content } });
  console.log('[backfill-knowledge] Imported knowledge base into AppSetting.');
}

main()
  .catch((e) => {
    console.error('[backfill-knowledge] Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
