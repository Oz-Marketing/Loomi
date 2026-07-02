/**
 * Seed OEM offer-compliance rules ported from Oz Dealer Tools' cPanel export
 * (ad_oem_required_fields, 2026-07-01): the Young Subaru org required VIN +
 * Stock Number on every ad. Loomi's AdOemOfferRule is make-scoped, so this
 * lands as a Subaru rule requiring both fields on all structured offer types —
 * the compliance engine unions it with the code baseline and blocks export
 * while either is empty.
 *
 * ODT's other exports (ad_global_rules / ad_org_rules) were AI-image prompt
 * guidance — tone, fonts, palette, composition. In Loomi those are structural
 * (templates + account branding); the copy-tone bits (e.g. "Think Young.
 * Drive Young." slogan) are a follow-up for the AI copy prompt, not this table.
 *
 * Idempotent upsert. Run:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/seed-oem-rules-odt.ts
 */
import { prisma } from '../src/lib/prisma';

const RULES: { make: string; requiredFields: Record<string, string[]>; notes: string }[] = [
  {
    make: 'Subaru',
    requiredFields: {
      lease: ['vin', 'stockNumber'],
      apr: ['vin', 'stockNumber'],
      discount: ['vin', 'stockNumber'],
      sales_price: ['vin', 'stockNumber'],
    },
    notes: 'Ported from Oz Dealer Tools (Young Subaru org): VIN + Stock Number required on every offer ad.',
  },
];

async function main() {
  for (const r of RULES) {
    const row = await prisma.adOemOfferRule.upsert({
      where: { make: r.make },
      create: { make: r.make, requiredFields: JSON.stringify(r.requiredFields), notes: r.notes },
      update: { requiredFields: JSON.stringify(r.requiredFields), notes: r.notes, isActive: true },
    });
    console.log(`upserted OEM rule: ${row.make}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
