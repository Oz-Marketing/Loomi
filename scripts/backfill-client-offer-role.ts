/**
 * Give every client user the `studio.client` role — OEM offer review.
 *
 * WHY A BACKFILL IS NEEDED AT ALL. `subjectFromSession` resolves a user's roles
 * as `session.user.sectorRoles ?? legacySectorRolesFor(role)`: stored rows win,
 * and the legacy mapping is only the fallback for users who have none. Every
 * existing client already carries a stored `reporting.client` row from the
 * Phase 1 backfill, so changing the legacy mapping grants them exactly nothing.
 * Without this script the entitlement is written down and not in force — the
 * shape this repo has been caught by before.
 *
 * WHAT IT GRANTS. `studio.client` carries `studio.access`, `studio.adgen.view`
 * and `studio.adgen.edit`, and stops there: a dealer can see the OEM offers
 * built for them and adjust one, and can reach nothing else in Studio. It
 * deliberately withholds `studio.adgen.generate` (runs come from the nightly
 * job) and `studio.adgen.launch` (that commits real ad spend).
 *
 * IDEMPOTENT, and safe to re-run. `UserSectorRole` is unique on
 * `(userId, sector)`, so a user who already has any Studio row is left exactly
 * as they are rather than being overwritten — if someone has been given a
 * different Studio role by hand, that was a decision and this must not undo it.
 *
 * Set-based: one read and one createMany, not a per-row loop. The deploy's SSH
 * step times out at 15 minutes.
 */
import 'dotenv/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[backfill-client-offer-role] DATABASE_URL unset — skipping');
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
    const clients = await prisma.user.findMany({
      where: { role: 'client' },
      select: { id: true, sectorRoles: { where: { sector: 'studio' }, select: { id: true } } },
    });

    // Anyone with no Studio row at all. Someone already holding one keeps it.
    const needing = clients.filter((u) => u.sectorRoles.length === 0);
    if (needing.length === 0) {
      console.log(
        `[backfill-client-offer-role] all ${clients.length} client user(s) already have a studio role — nothing to do`,
      );
      return;
    }

    const created = await prisma.userSectorRole.createMany({
      data: needing.map((u) => ({ userId: u.id, sector: 'studio', role: 'client' })),
      skipDuplicates: true,
    });
    console.log(
      `[backfill-client-offer-role] granted studio.client to ${created.count} of ${clients.length} client user(s)`,
    );
  } catch (err) {
    // Never fail a deploy over this. A missed run is self-healing — the next
    // deploy re-runs it, and until then the client simply sees what they saw
    // before, which is the safe direction for a permission change.
    console.warn('[backfill-client-offer-role] skipped:', err);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
