/**
 * Seed the "Service Reminder" starter template.
 *
 * Split out of the old scripts/seed-changelog-entries.ts. That script did two
 * unrelated jobs, and because it ran on every deploy it kept re-creating a
 * fixed set of Feb-2026 changelog entries that had already been deleted. The
 * changelog half is gone; this is the half worth keeping.
 *
 * Run: npx tsx scripts/seed-test-template.ts
 * Also runs as part of the build / deploy:prepare step.
 */
try { require('dotenv/config'); } catch { /* dotenv not available in production — env vars already set */ }
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

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

async function main() {
  const dataDir = path.join(__dirname, 'data');
  const contentFile = path.join(dataDir, 'test-template-content.html');
  const content = fs.existsSync(contentFile) ? fs.readFileSync(contentFile, 'utf-8') : '';

  if (!content) {
    console.log('Template seed: no content file, nothing to do.');
    return;
  }

  await prisma.template.upsert({
    where: { slug: 'test-template' },
    update: { content },
    create: {
      slug: 'test-template',
      title: 'Service Reminder',
      type: 'design',
      content,
      preheader: '',
    },
  });

  console.log('Template seed: "Service Reminder" upserted.');
}

main()
  .catch((e) => {
    // Don't fail the build if seeding fails.
    console.error('Seed failed:', e);
    process.exit(0);
  })
  .finally(() => pool.end());
