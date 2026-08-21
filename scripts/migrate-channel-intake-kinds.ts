/**
 * Deploy precursor: replace `BudgetChannel.intake` (boolean) with
 * `intakeKinds` (text[]), carrying the old hardcoded kind map into the column.
 *
 * MUST RUN BEFORE `prisma db push`. Dropping a populated column is a data-loss
 * change, and the deploy runs `db push` WITHOUT `--accept-data-loss`, so the
 * whole push fails on it — the same reason
 * migrate-budget-plans-to-agreements.ts exists. Doing the DDL here with plain
 * SQL means db push arrives to find the schema already matching.
 *
 * Why the swap at all: `intake` was a second, coarser answer to "can a rep pick
 * this channel", and it disagreed with the real gate. The intake form has
 * always read `KIND_BUDGET_CHANNELS`, so 18 of the 36 channels flagged `intake`
 * were offered on no task kind at all and the checkbox promised an input that
 * never rendered. One field, one truth — and now editable.
 *
 * Idempotent in every direction: it checks for the table, checks whether each
 * column exists, and only backfills a row whose `intakeKinds` is still empty.
 * Re-running after an admin has edited kinds in Settings changes nothing.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { SEED_INTAKE_KINDS } from '../src/lib/budget/channel-registry';

const TAG = '[migrate-channel-intake-kinds]';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(`${TAG} DATABASE_URL is not set`);
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as never);

  try {
    const [{ exists }] = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT to_regclass('public."BudgetChannel"') IS NOT NULL AS exists`,
    );
    if (!exists) {
      console.log(`${TAG} BudgetChannel does not exist yet — nothing to do`);
      return;
    }

    const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'BudgetChannel'`,
    );
    const names = new Set(cols.map((c) => c.column_name));

    // 1. Add the new column. NOT NULL DEFAULT '{}' so existing rows are valid
    //    the moment it appears, which is what lets step 3 be a plain UPDATE.
    if (!names.has('intakeKinds')) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "BudgetChannel" ADD COLUMN "intakeKinds" text[] NOT NULL DEFAULT '{}'`,
      );
      console.log(`${TAG} added intakeKinds`);
    }

    // 2. Invert the old kind→channels map onto the rows that don't have kinds
    //    yet. Keyed off the SEED map, not off `intake`: the boolean was the
    //    wrong answer, and this map is what the intake form actually obeyed.
    const perChannel = new Map<string, string[]>();
    for (const [kind, channels] of Object.entries(SEED_INTAKE_KINDS)) {
      for (const key of channels) {
        perChannel.set(key, [...(perChannel.get(key) ?? []), kind]);
      }
    }

    let filled = 0;
    for (const [key, kinds] of perChannel) {
      const n = await prisma.$executeRawUnsafe(
        `UPDATE "BudgetChannel"
            SET "intakeKinds" = $1::text[]
          WHERE "key" = $2 AND cardinality("intakeKinds") = 0`,
        kinds,
        key,
      );
      filled += n;
    }
    if (filled > 0) console.log(`${TAG} backfilled intake kinds onto ${filled} channel(s)`);

    // 3. Drop the old column last, so a failure above leaves the old gate in
    //    place rather than a half-migrated table with neither.
    if (names.has('intake')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "BudgetChannel" DROP COLUMN "intake"`);
      console.log(`${TAG} dropped the intake boolean`);
    }

    console.log(`${TAG} done`);
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
