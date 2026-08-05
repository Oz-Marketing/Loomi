/**
 * Carry BudgetPlan rows into ClientAgreement, then drop BudgetPlan —
 * deliberately, BEFORE the guarded `prisma db push` in the deploy.
 *
 * WHY THIS EXISTS. Phase B replaced the year-keyed plan with a term-based
 * agreement (docs/budget-module.md §9). `db push` runs without
 * `--accept-data-loss`, so it refuses to drop a table that has rows in it and
 * fails the ENTIRE push — the new columns never land either. Adding that flag
 * to the deploy would "fix" this once and then silently drop columns on every
 * future schema change, so instead this makes the one destructive step
 * explicit, the same way `drop-organization-model` and
 * `ensure-budgetline-external-id-unique` do.
 *
 * IT MIGRATES RATHER THAN DELETES. Each plan becomes an agreement spanning
 * Jan 1 – Dec 31 of its year, which is exactly what a year-keyed plan meant. A
 * `monthlyRetainer` becomes an AgreementFee. The old table only ever held a
 * handful of rows, but they're someone's committed number, and a deploy step
 * shouldn't quietly throw one away.
 *
 * The agreement tables are created here rather than left to `db push`, because
 * the rows have nowhere to go otherwise — push can't create them and drop
 * BudgetPlan in an order this script can rely on. Everything is
 * `IF NOT EXISTS` / guarded, so `db push` afterwards sees a schema that already
 * matches and does nothing, and a re-run is a no-op.
 *
 * Loads dotenv because it builds its own client rather than going through
 * `@/lib/prisma`.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[migrate-budget-plans-to-agreements] DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    // Account must exist — on a brand-new database `db push` builds everything
    // at once and there is nothing here to do.
    const [{ ready }] = await prisma.$queryRawUnsafe<{ ready: boolean }[]>(
      `SELECT to_regclass('public."Account"') IS NOT NULL AS ready`,
    );
    if (!ready) {
      console.log('[migrate-budget-plans-to-agreements] fresh database — nothing to do');
      return;
    }

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ClientAgreement" (
        "id" TEXT NOT NULL,
        "accountKey" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "startDate" DATE NOT NULL,
        "endDate" DATE NOT NULL,
        "committedAmount" DECIMAL(12,2),
        "status" TEXT NOT NULL DEFAULT 'active',
        "defaultMarkup" DOUBLE PRECISION,
        "notes" TEXT,
        "createdByUserId" TEXT,
        "archivedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ClientAgreement_pkey" PRIMARY KEY ("id")
      )`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AgreementFee" (
        "id" TEXT NOT NULL,
        "agreementId" TEXT NOT NULL,
        "channel" TEXT NOT NULL,
        "monthlyAmount" DECIMAL(12,2) NOT NULL,
        "label" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AgreementFee_pkey" PRIMARY KEY ("id")
      )`);

    // A database that has never carried the budget module has no BudgetLine yet
    // — `db push` creates it, with `agreementId` and its FK, a few steps after
    // this script. `ADD COLUMN IF NOT EXISTS` guards the COLUMN, not the TABLE,
    // so touching BudgetLine here would abort the whole deploy on such a
    // database (42P01). Everything BudgetLine-related is therefore skipped when
    // the table is absent, the same way ensure-budgetline-external-id-unique
    // does. Nothing is lost: with no table there are no rows to carry.
    const [{ hasBudgetLine }] = await prisma.$queryRawUnsafe<
      { hasBudgetLine: boolean }[]
    >(`SELECT to_regclass('public."BudgetLine"') IS NOT NULL AS "hasBudgetLine"`);
    if (!hasBudgetLine) {
      console.log(
        '[migrate-budget-plans-to-agreements] BudgetLine does not exist yet — db push will create it with agreementId',
      );
    }

    for (const sql of [
      `CREATE INDEX IF NOT EXISTS "ClientAgreement_accountKey_status_idx" ON "ClientAgreement"("accountKey", "status")`,
      `CREATE INDEX IF NOT EXISTS "ClientAgreement_accountKey_startDate_endDate_idx" ON "ClientAgreement"("accountKey", "startDate", "endDate")`,
      `CREATE INDEX IF NOT EXISTS "ClientAgreement_archivedAt_idx" ON "ClientAgreement"("archivedAt")`,
      `CREATE INDEX IF NOT EXISTS "AgreementFee_agreementId_idx" ON "AgreementFee"("agreementId")`,
      ...(hasBudgetLine
        ? [
            `ALTER TABLE "BudgetLine" ADD COLUMN IF NOT EXISTS "agreementId" TEXT`,
            `CREATE INDEX IF NOT EXISTS "BudgetLine_agreementId_idx" ON "BudgetLine"("agreementId")`,
          ]
        : []),
    ]) {
      await prisma.$executeRawUnsafe(sql);
    }

    // Foreign keys have no IF NOT EXISTS, so each is guarded by name. The
    // BudgetLine one is skipped entirely when the table is absent — its
    // existence probe matches nothing either way, so it would try the DDL and
    // fail rather than no-op.
    for (const [table, name, ddl] of ([
      [
        'ClientAgreement',
        'ClientAgreement_accountKey_fkey',
        `ALTER TABLE "ClientAgreement" ADD CONSTRAINT "ClientAgreement_accountKey_fkey"
           FOREIGN KEY ("accountKey") REFERENCES "Account"("key") ON DELETE CASCADE ON UPDATE CASCADE`,
      ],
      [
        'AgreementFee',
        'AgreementFee_agreementId_fkey',
        `ALTER TABLE "AgreementFee" ADD CONSTRAINT "AgreementFee_agreementId_fkey"
           FOREIGN KEY ("agreementId") REFERENCES "ClientAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
      ],
      [
        'BudgetLine',
        'BudgetLine_agreementId_fkey',
        `ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_agreementId_fkey"
           FOREIGN KEY ("agreementId") REFERENCES "ClientAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
      ],
    ] as const).filter(([table]) => hasBudgetLine || table !== 'BudgetLine')) {
      const existing = await prisma.$queryRawUnsafe<{ conname: string }[]>(
        `SELECT conname FROM pg_constraint WHERE conname = $1 AND conrelid = to_regclass($2)`,
        name,
        `public."${table}"`,
      );
      if (existing.length === 0) await prisma.$executeRawUnsafe(ddl);
    }

    const [{ exists }] = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT to_regclass('public."BudgetPlan"') IS NOT NULL AS exists`,
    );
    if (!exists) {
      console.log('[migrate-budget-plans-to-agreements] BudgetPlan already gone — no-op');
      return;
    }

    // `ON CONFLICT DO NOTHING` on the derived id makes a re-run harmless if the
    // drop below somehow didn't happen last time.
    const agreements = await prisma.$executeRawUnsafe(`
      INSERT INTO "ClientAgreement" (
        "id", "accountKey", "name", "startDate", "endDate",
        "committedAmount", "status", "defaultMarkup", "notes",
        "createdByUserId", "createdAt", "updatedAt"
      )
      SELECT 'agr_' || p."id", p."accountKey", p."year" || ' Agreement',
             make_date(p."year", 1, 1), make_date(p."year", 12, 31),
             p."declaredTotal", 'active', p."defaultMarkup", p."notes",
             p."createdByUserId", p."createdAt", p."updatedAt"
        FROM "BudgetPlan" p
      ON CONFLICT ("id") DO NOTHING`);

    // The old field never recorded a channel, so the fee lands on
    // managed_marketing_services — which is what that money almost always was.
    const fees = await prisma.$executeRawUnsafe(`
      INSERT INTO "AgreementFee" ("id", "agreementId", "channel", "monthlyAmount", "label", "createdAt", "updatedAt")
      SELECT 'fee_' || p."id", 'agr_' || p."id", 'managed_marketing_services',
             p."monthlyRetainer", 'Migrated from monthly retainer', p."createdAt", p."updatedAt"
        FROM "BudgetPlan" p
       WHERE p."monthlyRetainer" IS NOT NULL AND p."monthlyRetainer" > 0
      ON CONFLICT ("id") DO NOTHING`);

    await prisma.$executeRawUnsafe(`DROP TABLE "BudgetPlan"`);
    console.log(
      `[migrate-budget-plans-to-agreements] migrated ${agreements} plan(s) and ${fees} retainer fee(s); dropped BudgetPlan`,
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[migrate-budget-plans-to-agreements] failed:', err);
  process.exit(1);
});
