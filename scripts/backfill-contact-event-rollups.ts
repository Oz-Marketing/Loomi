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
// One set-based UPDATE per account, so the cost scales with the number of
// ACCOUNTS rather than the number of contacts. Idempotent: recomputes
// from the event table, so re-running converges on the same answer.
//
//   npx tsx scripts/backfill-contact-event-rollups.ts [--dry-run]

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { recomputeAllContactEventRollups } from '../src/lib/contacts/event-rollups';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  // No skip guard, deliberately.
  //
  // The recompute is idempotent and now writes only rows whose values
  // actually changed (see applyUpdate in lib/contacts/event-rollups.ts), so a
  // steady-state deploy does the aggregate scan and no writes at all. That
  // makes "run it every deploy" cheaper than the bookkeeping to avoid it.
  //
  // The earlier claim here of "~11s across production's full 259k contacts"
  // was wrong, and expensively so: without the no-op guard it was ~88s for a
  // single 17.7k-contact rooftop and blew the deploy's 15-minute SSH budget on
  // 2026-08-16, 23 accounts into 34.
  //
  // It also self-heals. The first attempt at this backfill was row-by-row
  // and blew the deploy's SSH timeout 14 of 33 accounts in. A global
  // "already populated?" guard would have looked satisfied at that point
  // and silently skipped the remaining 19 rooftops forever.
  const accounts = await prisma.contactEvent.findMany({
    where: { contactId: { not: null } },
    select: { accountKey: true },
    distinct: ['accountKey'],
  });

  if (accounts.length === 0) {
    console.log('No contact events on record — nothing to roll up.');
    return;
  }

  console.log(
    `${DRY_RUN ? '[dry run] ' : ''}Rolling up event history across ${accounts.length} account(s)…`,
  );

  const startedAll = Date.now();
  let written = 0;
  for (const { accountKey } of accounts) {
    if (DRY_RUN) {
      console.log(`  ${accountKey}: would recompute`);
      continue;
    }
    const startedAt = Date.now();
    const n = await recomputeAllContactEventRollups(accountKey);
    written += n;
    // `n` is rows CHANGED, not rows examined — 0 is the healthy steady state
    // now, not a sign the backfill has stopped doing its job.
    console.log(
      `  ${accountKey}: ${n.toLocaleString()} changed in ${Date.now() - startedAt}ms`,
    );
  }

  console.log(
    `${DRY_RUN ? '[dry run] ' : ''}Done — ${written.toLocaleString()} contact(s) changed in ${Date.now() - startedAll}ms.`,
  );
}

main()
  .catch((err) => {
    console.error('[backfill-contact-event-rollups] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
