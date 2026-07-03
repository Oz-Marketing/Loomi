/**
 * Retire the doc-level `doc.background` fill: convert every saved template and
 * creative so its background is a full-bleed Background ELEMENT (the single way
 * to set a background) instead of the old canvas-fill field. See
 * `migrateDocBackground` for the per-doc transform (pure + unit-tested).
 *
 * Idempotent — re-running is safe (docs already migrated are skipped).
 *
 * Run (droplet or local):
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/migrate-doc-background-to-element.ts [--dry]
 *
 * --dry  reports what WOULD change without writing.
 */
import { prisma } from '../src/lib/prisma';
import type { TemplateDoc } from '../src/lib/ad-generator/doc-types';
import { migrateDocBackground } from '../src/lib/ad-generator/migrate-background';

const DRY = process.argv.includes('--dry');

async function main() {
  let tConv = 0,
    tSkip = 0,
    tErr = 0,
    cConv = 0,
    cSkip = 0,
    cErr = 0;

  const templates = await prisma.adTemplateDoc.findMany({ select: { id: true, doc: true } });
  for (const t of templates) {
    try {
      const parsed = JSON.parse(t.doc) as TemplateDoc;
      const { doc, changed } = migrateDocBackground(parsed);
      if (!changed) {
        tSkip++;
        continue;
      }
      if (!DRY) await prisma.adTemplateDoc.update({ where: { id: t.id }, data: { doc: JSON.stringify(doc) } });
      tConv++;
    } catch (e) {
      tErr++;
      console.error(`  ! template ${t.id}:`, e instanceof Error ? e.message : e);
    }
  }

  const creatives = await prisma.adCreative.findMany({ where: { doc: { not: null } }, select: { id: true, doc: true } });
  for (const c of creatives) {
    try {
      if (!c.doc) {
        cSkip++;
        continue;
      }
      const parsed = JSON.parse(c.doc) as TemplateDoc;
      const { doc, changed } = migrateDocBackground(parsed);
      if (!changed) {
        cSkip++;
        continue;
      }
      if (!DRY) await prisma.adCreative.update({ where: { id: c.id }, data: { doc: JSON.stringify(doc) } });
      cConv++;
    } catch (e) {
      cErr++;
      console.error(`  ! creative ${c.id}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(
    `${DRY ? '[DRY RUN] ' : ''}templates: ${tConv} converted, ${tSkip} skipped, ${tErr} errors; ` +
      `creatives: ${cConv} converted, ${cSkip} skipped, ${cErr} errors`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
