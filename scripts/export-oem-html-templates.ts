/**
 * Export OEM HTML templates currently in the DB back out to the file system.
 * Inverse of seed-oem-html-templates.ts. Re-creates files at:
 *   src/templates/oem-html/{oem}/{workflow}/{step}.html
 *
 *   npx tsx scripts/export-oem-html-templates.ts
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
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

const OUTPUT_ROOT = path.resolve(process.cwd(), 'src', 'templates', 'oem-html');

/**
 * Slug format: oem-{oem-slug}-{workflow-slug}-{step-filename}
 * Reverse-engineer the path components from the slug.
 */
function parseSlug(slug: string): { oem: string; workflow: string; step: string } | null {
  if (!slug.startsWith('oem-')) return null;
  const rest = slug.slice('oem-'.length);
  // Workflow names contain hyphens (e.g. sales-welcome-series), so we need a
  // smarter split. The seed script uses path components — for the demo we
  // know the OEMs and workflows, so we use a hand-tuned heuristic:
  //   - first segment is the OEM
  //   - the next 2-3 segments are the workflow ("sales-welcome-series")
  //   - everything else is the step filename
  // For robustness we keep a known-workflow list.
  const knownWorkflows = [
    'sales-welcome-series',
    'sales-anniversary',
    'sales-trade-in',
    'service-reminder',
    'service-thank-you',
    'service-win-back',
    'service-warranty-expiration',
    'lease-new-introduction',
    'lease-end',
    'loyalty-birthday',
  ];
  for (const wf of knownWorkflows) {
    const prefix = rest.indexOf(`-${wf}-`);
    if (prefix === -1) continue;
    const oem = rest.slice(0, prefix);
    const step = rest.slice(prefix + wf.length + 2);
    if (oem && step) return { oem, workflow: wf, step };
  }
  return null;
}

async function main() {
  const all = await prisma.template.findMany({
    where: { slug: { startsWith: 'oem-' } },
    select: { slug: true, content: true, title: true },
  });

  if (all.length === 0) {
    console.log('No OEM templates in DB.');
    return;
  }

  let written = 0;
  let skipped = 0;
  for (const t of all) {
    const parsed = parseSlug(t.slug);
    if (!parsed) {
      console.warn(`  skip (unrecognized slug): ${t.slug}`);
      skipped++;
      continue;
    }
    const dir = path.join(OUTPUT_ROOT, parsed.oem, parsed.workflow);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${parsed.step}.html`);
    fs.writeFileSync(filePath, t.content, 'utf-8');
    console.log(`  ✓ ${path.relative(process.cwd(), filePath)}`);
    written++;
  }

  console.log(`\nWrote ${written} file(s); skipped ${skipped}.`);
  console.log(`Re-seed with:  npx tsx scripts/seed-oem-html-templates.ts`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
