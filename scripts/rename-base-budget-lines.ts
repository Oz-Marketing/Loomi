/**
 * Rename standing-budget lines on the paced channels to "<Channel> Base".
 *
 * WHY. Budget lines used to be labelled from their budget's name, so an entire
 * year of Meta and Google spend came out as "2026 Budget" twelve times over.
 * The name is now optional — a budget with no name IS the standing spend, and
 * its lines are named after their channel — but the lines already in the
 * database still carry the old label.
 *
 * NARROW ON PURPOSE. Only touches lines that are:
 *   - on a paced channel (Meta / Google / YouTube), because "Base" only means
 *     something where the Ad Pacer reads the bucket;
 *   - in the base bucket, so an event's added money keeps its own name;
 *   - generated from a budget (`source: 'retainer'`), never hand-entered;
 *   - still carrying a GENERIC label — their budget's name, their channel's
 *     name, or one of the old defaults.
 *
 * That last condition is what makes this safe to run. A line somebody named
 * "Always-on prospecting" is a decision, and a rename script has no business
 * overwriting it. Anything it skips stays exactly as it was.
 *
 * Idempotent — a second run finds nothing left to do.
 *
 * Loads dotenv because it builds its own client rather than going through
 * `@/lib/prisma`.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { registryFromRows } from '../src/lib/budget/channel-registry';

/** Labels that carry no decision — safe to replace. */
const GENERIC = [
  'managed marketing service',
  'managed marketing services',
  'retainer',
  'budget',
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[rename-base-budget-lines] DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const [{ exists }] = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT to_regclass('public."BudgetLine"') IS NOT NULL AS exists`,
    );
    if (!exists) {
      console.log('[rename-base-budget-lines] BudgetLine does not exist yet — nothing to do');
      return;
    }

    const candidates = await prisma.budgetLine.findMany({
      where: {
        source: 'retainer',
        bucket: 'base',
        archivedAt: null,
        status: { notIn: ['canceled'] },
      },
      select: {
        id: true,
        channel: true,
        label: true,
        agreement: { select: { name: true } },
      },
    });

    let renamed = 0;
    let kept = 0;

    // Read the channel table once — see the note in backfill-budget-line-type.
    const ch = registryFromRows(await prisma.budgetChannel.findMany());

    for (const line of candidates) {
      if (!line.channel || !ch.isPaced(line.channel)) continue;

      const target = `${ch.label(line.channel)} Base`;
      const current = (line.label ?? '').trim();
      if (current === target) continue;

      // Generic enough to replace? Its budget's name, its channel's name, one
      // of the old defaults, or nothing at all.
      const budgetName = (line.agreement?.name ?? '').trim();
      const isGeneric =
        current === '' ||
        current === ch.label(line.channel) ||
        (budgetName !== '' && current === budgetName) ||
        GENERIC.includes(current.toLowerCase());

      if (!isGeneric) {
        kept += 1;
        continue;
      }

      await prisma.budgetLine.update({ where: { id: line.id }, data: { label: target } });
      renamed += 1;
    }

    console.log(`[rename-base-budget-lines] renamed ${renamed} line(s) to "<Channel> Base"`);
    if (kept > 0) {
      console.log(
        `[rename-base-budget-lines] left ${kept} line(s) alone — they carry a name somebody chose`,
      );
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[rename-base-budget-lines] failed:', err);
  process.exit(1);
});
