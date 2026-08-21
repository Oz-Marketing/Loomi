/**
 * One-time migration + seed: move rate cards out of code and AppSetting rows
 * into the `BillingCategory` table.
 *
 * Before this, the category LIST was the `BILLING_CATEGORIES` constant in
 * src/lib/budget/channels.ts and each rate was an `app-markup-billing-<key>`
 * AppSetting row. Rates were editable; the list needed a deploy. The table
 * makes both editable — see src/lib/services/rate-cards.ts.
 *
 * THE LIVE RATE WINS. For each seed category the rate is taken from its
 * AppSetting row when one exists (that's the number the agency actually
 * configured and that budget lines have been costing at) and only falls back to
 * the code default when it doesn't. Seeding the defaults over the top would
 * silently reprice every category someone had tuned.
 *
 * Idempotent in both directions: a category that already has a row is left
 * completely alone (label edits, rate edits and archives made through Settings
 * survive re-runs), and the old AppSetting rows are left in place rather than
 * deleted, so a rollback to the previous release still finds its rates.
 *
 * KEYS must match BILLING_CATEGORIES in src/lib/budget/channels.ts.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

/** Mirrors BILLING_CATEGORIES. Duplicated because scripts don't import src/. */
const SEEDS: { key: string; label: string; defaultMarkup: number }[] = [
  { key: 'digital', label: 'Digital', defaultMarkup: 0.77 },
  { key: 'mass_media', label: 'Mass Media', defaultMarkup: 0.85 },
  { key: 'pr', label: 'PR', defaultMarkup: 0.8 },
  { key: 'swag', label: 'Swag', defaultMarkup: 0.7 },
  { key: 'print_event', label: 'Print, Xtreme & Event', defaultMarkup: 0.8 },
  { key: 'production', label: 'Production', defaultMarkup: 0.8 },
  { key: 'development', label: 'Development', defaultMarkup: 0.8 },
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

const TAG = '[seed-rate-cards]';

async function main() {
  let created = 0;
  let migrated = 0;
  let skipped = 0;

  for (const [i, seed] of SEEDS.entries()) {
    const existing = await prisma.billingCategory.findUnique({
      where: { key: seed.key },
      select: { key: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    // The rate this category has been billing at, if an admin ever set it.
    const setting = await prisma.appSetting.findUnique({
      where: { key: `app-markup-billing-${seed.key}` },
      select: { value: true },
    });
    const stored = setting == null ? NaN : Number(setting.value);
    const live = Number.isFinite(stored) && stored > 0 && stored <= 1;

    await prisma.billingCategory.create({
      data: {
        key: seed.key,
        label: seed.label,
        markup: live ? stored : seed.defaultMarkup,
        sortOrder: i,
      },
    });

    created++;
    if (live) {
      migrated++;
      console.log(`${TAG} ${seed.key}: carried over configured rate ${stored}`);
    }
  }

  console.log(
    `${TAG} ${created} created (${migrated} with a configured rate), ${skipped} already present`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`${TAG} failed`, e);
    process.exit(1);
  });
