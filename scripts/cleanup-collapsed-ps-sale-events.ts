/**
 * Delete the collapsed powersports sale events left behind by the
 * ps_sales_data.dealid bug.
 *
 * The Oz Reports bridge built each ps sale's idempotencyKey as
 * "ps:sale:{accountingCode}:{dealid}", but dealid had saturated at 32-bit
 * INT_MAX (2147483647) on every row. Since ContactEvent.idempotencyKey is
 * unique, every sale after the first UPDATED the same row instead of creating
 * its own — so each powersports rooftop ended up with exactly one sale event
 * (holding whichever sale was processed last) rather than its full history.
 * Reported as "updated", never as an error.
 *
 * The bridge now builds a composite key (dealno_1 + custid + contractdate +
 * vin), matching what the automotive path always did. Once the corrected push
 * has run, every real sale exists under a proper key — including the one
 * currently sitting in the collapsed row, which is now a duplicate. This
 * script removes those orphans.
 *
 * RUN ORDER MATTERS: push the corrected events FIRST (the weekly sweep does
 * this automatically, or force it with `sweep dealer=<key>`), then run this.
 * Running it first just means a gap until the next push.
 *
 * Dry run (default — prints what it would delete, changes nothing):
 *   npx tsx scripts/cleanup-collapsed-ps-sale-events.ts
 *
 * Apply:
 *   npx tsx scripts/cleanup-collapsed-ps-sale-events.ts --apply
 */

import 'dotenv/config';
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

// The saturated sentinel. eventKey() lowercases and colon-joins, so a
// collapsed key always ends with exactly this.
const SENTINEL_SUFFIX = ':2147483647';

const apply = process.argv.includes('--apply');

// Narrow on all three attributes rather than the key alone: a real deal
// number of 2147483647 is implausible, but this is a delete against prod and
// the extra predicates cost nothing.
const where = {
  idempotencyKey: { endsWith: SENTINEL_SUFFIX },
  type: 'sale',
  sourceCrm: 'powersports',
} as const;

async function main() {
  const doomed = await prisma.contactEvent.findMany({
    where,
    select: {
      id: true,
      accountKey: true,
      idempotencyKey: true,
      contactId: true,
      eventDate: true,
      amount: true,
      vehicleMake: true,
      vehicleModel: true,
      reference: true,
    },
    orderBy: { accountKey: 'asc' },
  });

  if (doomed.length === 0) {
    console.log('Nothing to clean — no collapsed ps sale events found.');
    console.log('(If you expected some, confirm the corrected events push has run.)');
    return;
  }

  console.log(`Found ${doomed.length} collapsed ps sale event(s):\n`);
  for (const e of doomed) {
    const vehicle = [e.vehicleMake, e.vehicleModel].filter(Boolean).join(' ') || '—';
    console.log(
      `  ${e.accountKey.padEnd(30)} ${e.idempotencyKey.padEnd(34)} ` +
        `date=${e.eventDate?.toISOString().slice(0, 10) ?? '—'} ` +
        `amount=${e.amount ?? '—'} ref=${e.reference ?? '—'} ${vehicle}` +
        `${e.contactId ? '' : ' (unlinked)'}`,
    );
  }

  // How many correctly-keyed ps sale events exist now? If this is zero, the
  // corrected push hasn't run yet and deleting would leave a real gap.
  const replacements = await prisma.contactEvent.count({
    where: {
      type: 'sale',
      sourceCrm: 'powersports',
      idempotencyKey: { not: { endsWith: SENTINEL_SUFFIX } },
    },
  });
  console.log(`\nCorrectly-keyed ps sale events currently in the database: ${replacements}`);

  if (replacements === 0) {
    console.error(
      '\nREFUSING TO DELETE: no correctly-keyed ps sale events exist yet, which means\n' +
        'the corrected push has not run. Deleting now would remove the only sale\n' +
        'history these accounts have. Run the events push first (weekly sweep, or\n' +
        '`oz-reports-contact-sync.sh sweep dealer=<key>`), then re-run this.',
    );
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log('\nDry run — nothing deleted. Re-run with --apply to delete these rows.');
    return;
  }

  const { count } = await prisma.contactEvent.deleteMany({ where });
  console.log(`\nDeleted ${count} collapsed ps sale event(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
