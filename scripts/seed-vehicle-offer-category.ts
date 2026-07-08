/**
 * Seed the "Vehicle Offer" category's STARTER field set (the offer question set).
 * Category starters are designer-managed data — this just ships the first one so
 * picking "Vehicle Offer" in the ad builder seeds the offer fields. Idempotent
 * upsert; safe to re-run. Also runs in deploy:prepare.
 *
 * Run: npx tsx scripts/seed-vehicle-offer-category.ts
 */
try { require('dotenv/config'); } catch { /* env already set in prod */ }
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { vehicleOffer } from '../src/lib/ad-generator/templates/vehicle-offer';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/loomi_studio?schema=public';

const pool = new pg.Pool({
  connectionString: connectionString.replace(/[?&]sslmode=require/, (m) => (m.startsWith('?') ? '?' : '')).replace(/\?$/, ''),
  ...(connectionString.includes('sslmode=require') && { ssl: { rejectUnauthorized: false } }),
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const NAME = 'Vehicle Offer';

async function main() {
  // The offer question set (single offer) + its starter defaults — exactly what
  // `addFieldKit(doc, 'single')` merges. Kept in sync via the shared template def.
  const fields = JSON.stringify(vehicleOffer.fields);
  const defaults = JSON.stringify(vehicleOffer.defaults ?? {});
  // Don't clobber a starter a designer has since customized — only fill it in if
  // missing (create), refresh the fields on an untouched seed otherwise.
  const existing = await prisma.adCategoryStarter.findUnique({ where: { name: NAME } });
  if (existing) {
    console.log(`[seed] category starter "${NAME}" already exists — leaving as-is.`);
  } else {
    await prisma.adCategoryStarter.create({ data: { name: NAME, fields, defaults, createdByName: 'System' } });
    console.log(`[seed] created category starter "${NAME}" (${vehicleOffer.fields.length} fields).`);
  }
}

main()
  .catch((e) => {
    console.error('[seed-vehicle-offer-category] failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
