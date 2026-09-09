/**
 * Move existing ad-automation rows onto the offer fan-out defaults.
 *
 * Two schema defaults changed, and a default only reaches rows created after it.
 * These are the rows already out there.
 *
 * 1. `runWindowMode` next_month → current_month.
 *
 *    `fitToWindow` treats an offer as `expired` when its end date falls before
 *    the window STARTS. Measured against production on 2026-09-02 (2,613 snapshot
 *    rows, 19 accounts, 26 poll days): 1,194 of 1,266 live offers were eligible
 *    for a current-month window and only 73 for next month. The shipped default
 *    was rejecting ~94% of live offers from roughly the 1st to the 25th of every
 *    month, invisibly — zero eligible offers and zero offers produce the same
 *    empty run.
 *
 *    This overwrites a value someone may have chosen, because `next_month`
 *    cannot be distinguished from an untouched default. That is the right trade:
 *    at ~6% eligibility nobody is successfully relying on next-month planning,
 *    and an account left on it keeps generating nothing. `rolling` and
 *    `current_month` are untouched — only the broken value moves.
 *
 * 2. `expandOfferTypes` false → true.
 *
 *    It shipped off for one reason: expansion produced ~30 ads against an
 *    ad-counted `maxAdsPerRun` of 10, and the cap would truncate to an arbitrary
 *    subset. `maxVehiclesPerRun` removed that objection — the cap falls on a
 *    vehicle boundary now, so expansion can never leave a vehicle half-built.
 *
 *    Flips every row still holding false, for the same reason as (1): `false` was
 *    the default, so a stored false is indistinguishable from never having been
 *    considered. There is no deliberate choice here to preserve.
 *
 * Set-based and idempotent: two UPDATEs, safe to re-run, second run matches
 * nothing. Deliberately NOT a per-row loop — the deploy's SSH step times out at
 * 15 minutes and this repo has been bitten by that before.
 */

import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[backfill-adgen-fanout-defaults] DATABASE_URL unset — skipping');
    return;
  }
  const needsSsl = /[?&]sslmode=require/.test(connectionString);
  const cleanUrl = connectionString
    .replace(/[?&]sslmode=require/, (m) => (m.startsWith('?') ? '?' : ''))
    .replace(/\?$/, '');
  const pool = new pg.Pool({
    connectionString: cleanUrl,
    ...(needsSsl && { ssl: { rejectUnauthorized: false } }),
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const window = await prisma.adAutomationConfig.updateMany({
      where: { runWindowMode: 'next_month' },
      data: { runWindowMode: 'current_month' },
    });
    console.log(
      window.count === 0
        ? '[backfill-adgen-fanout-defaults] run window: nothing on next_month — already done'
        : `[backfill-adgen-fanout-defaults] run window: moved ${window.count} account(s) to current_month`,
    );

    // Flips every row still holding false, for the same reason as (1): a stored
    // `false` is indistinguishable from an untouched default, because false WAS
    // the default. Nobody had to act to get it, so there is no deliberate choice
    // here to protect.
    //
    // An earlier version of this script tried to protect one, by flipping only
    // rows whose `updatedAt` still matched `createdAt`. That guard does not mean
    // what it looks like: `updatedAt` moves when ANY field is saved, so an
    // account that merely set its ZIP would have been excluded. Measured against
    // the local rows it matched nothing at all, which would have made the flip a
    // silent no-op while reporting success.
    const expand = await prisma.adAutomationConfig.updateMany({
      where: { expandOfferTypes: false },
      data: { expandOfferTypes: true },
    });
    console.log(
      expand.count === 0
        ? '[backfill-adgen-fanout-defaults] offer expansion: nothing to flip — already done'
        : `[backfill-adgen-fanout-defaults] offer expansion: enabled on ${expand.count} account(s)`,
    );
  } catch (err) {
    // Never fail the deploy over this. The table may not exist yet on a fresh
    // environment, and a missed backfill is self-healing — the next deploy
    // re-runs it.
    console.warn('[backfill-adgen-fanout-defaults] skipped:', err);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
