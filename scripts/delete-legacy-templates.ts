/**
 * Delete every Template row whose content uses the legacy Maizzle <x-base>
 * scaffold. Run after the v2 migration; v2 JSON and pure HTML templates are
 * preserved.
 *
 *   npx tsx scripts/delete-legacy-templates.ts
 */

import 'dotenv/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const candidate = process.env.DATABASE_URL;
if (!candidate) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: candidate });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function isLegacyScaffold(content: string): boolean {
  const trimmed = content.trimStart();
  return /^---\r?\n[\s\S]*?\r?\n---/.test(trimmed) && /<x-base\b/i.test(trimmed);
}

async function main() {
  const all = await prisma.template.findMany({ select: { id: true, slug: true, content: true } });
  const legacy = all.filter((t) => isLegacyScaffold(t.content));

  if (legacy.length === 0) {
    console.log('No legacy templates found.');
    return;
  }

  console.log(`Deleting ${legacy.length} legacy template(s):`);
  for (const t of legacy) console.log(`  - ${t.slug}`);

  const result = await prisma.template.deleteMany({
    where: { id: { in: legacy.map((t) => t.id) } },
  });
  console.log(`\nDeleted ${result.count} template(s).`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
