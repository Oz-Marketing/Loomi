/**
 * One-time migration + seed: move the budget channel list out of code and into
 * the `BudgetChannel` table.
 *
 * Before this the list was a 44-entry `BUDGET_CHANNELS` constant, which made
 * Loomi's budget taxonomy Oz Marketing's — it mirrored Oz Reports' `channels`
 * table down to its numeric ids. See src/lib/services/budget-channels.ts.
 *
 * MUST RUN AFTER seed-rate-cards: a channel's `billingKey` is a real foreign
 * key to `BillingCategory.key`, so seeding channels first would fail on every
 * row that bills at a rate card. A missing card is skipped with a warning
 * rather than aborting the run, so one bad reference can't block a deploy.
 *
 * Idempotent: a channel that already has a row is left completely alone, so
 * renames, regrouped display categories, reassigned rate cards, icon choices
 * and archives made through Settings all survive a redeploy. Nothing is ever
 * deleted here — a channel the agency removed on purpose stays removed.
 *
 * KEYS must match SEED_CHANNELS in src/lib/budget/channel-registry.ts. Imported
 * rather than duplicated: it's 44 rows with five fields each, and a hand-copied
 * second list would be wrong within a month.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { SEED_CHANNELS } from '../src/lib/budget/channel-registry';

const TAG = '[seed-budget-channels]';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(`${TAG} DATABASE_URL is not set`);
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as never);

  try {
    const cards = new Set(
      (await prisma.billingCategory.findMany({ select: { key: true } })).map((c) => c.key),
    );

    let created = 0;
    let skipped = 0;
    const droppedRates: string[] = [];

    for (const [i, seed] of SEED_CHANNELS.entries()) {
      const existing = await prisma.budgetChannel.findUnique({
        where: { key: seed.key },
        select: { key: true },
      });
      if (existing) {
        skipped++;
        continue;
      }

      // The FK would reject a card that isn't there. Land the channel without a
      // rate rather than not at all: an unassigned channel falls back to the
      // account rate, which is a recoverable state; a missing channel isn't.
      let billingKey = seed.billingKey;
      if (billingKey && !cards.has(billingKey)) {
        droppedRates.push(`${seed.key} → ${billingKey}`);
        billingKey = null;
      }

      await prisma.budgetChannel.create({
        data: {
          key: seed.key,
          label: seed.label,
          category: seed.category,
          lineType: seed.lineType,
          billingKey,
          pacer: seed.pacer,
          intakeKinds: [...seed.intakeKinds],
          icon: seed.icon,
          externalIds: [...seed.externalIds],
          sortOrder: i,
        },
      });
      created++;
    }

    if (droppedRates.length > 0) {
      console.warn(
        `${TAG} WARNING: seeded without a rate card (category missing): ${droppedRates.join(', ')}`,
      );
    }
    console.log(`${TAG} ${created} created, ${skipped} already present`);
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`${TAG} failed`, e);
    process.exit(1);
  });
