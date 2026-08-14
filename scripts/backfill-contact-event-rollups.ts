// Backfill the ContactEvent rollups denormalised onto Contact
// (serviceVisitCount, saleCount, lifetimeSpend, and the first/last event
// dates).
//
// Ongoing maintenance is handled by the event ingest, which recomputes
// rollups for every contact a batch touches. This script covers the
// history that landed before those columns existed — without it, service
// and purchase segments read as "nobody has ever visited" until each
// contact happens to appear in a future ingest batch.
//
// Only walks contacts that actually have events, so the cost is
// proportional to real history rather than to roster size. Idempotent:
// recomputes from the event table, so re-running converges.
//
//   npx tsx scripts/backfill-contact-event-rollups.ts [--dry-run]

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { recomputeContactEventRollups } from '../src/lib/contacts/event-rollups';

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const BATCH = 500;

async function main() {
  // Same skip-once-populated guard as the engagement backfill: this runs
  // on every deploy but the work is one-time, and the ingest keeps the
  // columns current afterwards.
  if (!FORCE) {
    const populated = await prisma.contact.findFirst({
      where: { OR: [{ serviceVisitCount: { gt: 0 } }, { saleCount: { gt: 0 } }] },
      select: { id: true },
    });
    if (populated) {
      console.log('Event rollups already populated — skipping (pass --force to recompute).');
      return;
    }
  }

  // Distinct contacts that have any event at all.
  const withEvents = await prisma.contactEvent.findMany({
    where: { contactId: { not: null } },
    select: { contactId: true, accountKey: true },
    distinct: ['contactId'],
  });

  if (withEvents.length === 0) {
    console.log('No contact events on record — nothing to roll up.');
    return;
  }

  // Group by account: the recompute is scoped per account so an event
  // can never contribute to a contact in a different sub-account.
  const byAccount = new Map<string, string[]>();
  for (const row of withEvents) {
    if (!row.contactId) continue;
    const list = byAccount.get(row.accountKey) ?? [];
    list.push(row.contactId);
    byAccount.set(row.accountKey, list);
  }

  console.log(
    `${DRY_RUN ? '[dry run] ' : ''}Rolling up ${withEvents.length.toLocaleString()} contacts with history across ${byAccount.size} account(s)…`,
  );

  let written = 0;
  for (const [accountKey, ids] of byAccount) {
    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH);
      if (DRY_RUN) {
        written += slice.length;
        continue;
      }
      written += await recomputeContactEventRollups(accountKey, slice);
    }
    console.log(`  ${accountKey}: ${ids.length.toLocaleString()} contacts`);
  }

  console.log(`${DRY_RUN ? '[dry run] ' : ''}Done — ${written.toLocaleString()} contacts updated.`);
}

main()
  .catch((err) => {
    console.error('[backfill-contact-event-rollups] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
