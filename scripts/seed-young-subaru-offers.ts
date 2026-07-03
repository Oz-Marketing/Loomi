/**
 * Seed the Young Subaru offer Ad Generator templates (Single + Dual), built
 * natively on the unified Background element — see
 * `src/lib/ad-generator/templates/young-subaru-offers.ts` for the docs.
 *
 * Seeded as account-scoped DRAFTS — designers drop in the topo texture (Textures
 * tab) + refine layouts in the builder, then publish.
 *
 * Run (droplet or local):
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/seed-young-subaru-offers.ts [accountKey]
 * accountKey defaults to "youngSubaru".
 */
import { prisma } from '../src/lib/prisma';
import { youngSubaruOfferDocs } from '../src/lib/ad-generator/templates/young-subaru-offers';

async function main() {
  const accountKey = process.argv[2]?.trim() || 'youngSubaru';
  for (const doc of youngSubaruOfferDocs) {
    const row = await prisma.adTemplateDoc.upsert({
      where: { id: doc.id },
      create: { id: doc.id, name: doc.name, description: doc.description, doc: JSON.stringify(doc), status: 'draft', accountKey, createdBy: 'seed-young-subaru-offers' },
      update: { name: doc.name, description: doc.description, doc: JSON.stringify(doc), accountKey },
    });
    console.log(`upserted ${row.id} (${row.status}, account=${accountKey})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
