/**
 * One-time backfill: import clients from the old data/rooftops.json file into
 * the canonical Account table.
 *
 * rooftops.json was a parallel store (lost on every deploy) that the Clients
 * page wrote to. This imports any client key that does NOT already have an
 * Account row — it never overwrites existing accounts, so richer Account data
 * (sending identity, ESP connections, contacts, etc.) is never clobbered.
 *
 * Usage:
 *   npx tsx scripts/backfill-rooftops-to-accounts.ts <path-to-rooftops.json> [--confirm]
 *
 * Idempotent: only creates missing accounts. Safe to leave in the deploy
 * pipeline — becomes a no-op once every key exists.
 */
import fs from 'fs';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

interface RooftopEntry {
  dealer?: string;
  category?: string;
  logos?: Record<string, string>;
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

function dealerToSlug(dealer: string): string {
  return dealer.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  const filePath = args.find((a) => !a.startsWith('--'));

  if (!filePath) {
    console.error('[backfill-rooftops] Usage: backfill-rooftops-to-accounts.ts <path> [--confirm]');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.log(`[backfill-rooftops] No file at ${filePath} — nothing to import.`);
    return;
  }

  let rooftops: Record<string, RooftopEntry>;
  try {
    rooftops = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    console.error(`[backfill-rooftops] Could not parse ${filePath}:`, e);
    process.exit(1);
  }

  const keys = Object.keys(rooftops).filter((k) => !k.startsWith('_'));
  if (keys.length === 0) {
    console.log('[backfill-rooftops] File has no client entries — nothing to import.');
    return;
  }

  // Existing accounts + slugs (for skip + collision avoidance)
  const accounts = await prisma.account.findMany({ select: { key: true, slug: true } });
  const existingKeys = new Set(accounts.map((a) => a.key));
  const usedSlugs = new Set(accounts.map((a) => a.slug).filter(Boolean) as string[]);

  const toCreate = keys.filter((k) => !existingKeys.has(k));
  console.log(
    `[backfill-rooftops] ${keys.length} client(s) in file; ${toCreate.length} missing from Account.`,
  );

  if (toCreate.length === 0) return;

  if (!confirm) {
    console.log(`[backfill-rooftops] DRY RUN — would create: ${toCreate.join(', ')}`);
    console.log('[backfill-rooftops] Pass --confirm to write. No changes made.');
    return;
  }

  for (const key of toCreate) {
    const entry = rooftops[key] || {};
    const dealer = (entry.dealer || key).trim();

    let base = dealerToSlug(dealer) || 'account';
    let slug = base;
    let counter = 2;
    while (usedSlugs.has(slug)) {
      slug = `${base}-${counter}`;
      counter++;
    }
    usedSlugs.add(slug);

    await prisma.account.create({
      data: {
        key,
        dealer,
        slug,
        category: entry.category || 'General',
        logos: JSON.stringify(entry.logos || { light: '', dark: '' }),
      },
    });
    console.log(`[backfill-rooftops] Created account ${key} (${dealer}) → slug ${slug}`);
  }

  console.log(`[backfill-rooftops] Done. Created ${toCreate.length} account(s).`);
}

main()
  .catch((e) => {
    console.error('[backfill-rooftops] Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
