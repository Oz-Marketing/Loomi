/**
 * Add the AdCreative → Campaign foreign key, deliberately, BEFORE the guarded
 * `prisma db push` in the deploy.
 *
 * WHY THIS EXISTS. `AdCreative.campaignId` shipped as a bare scalar commented
 * "reserved — future Campaign channel link", but `generateOfferEmail` has been
 * writing real campaign ids to it since the offer-email work landed. That left
 * the link one-way: ads pointed at a campaign, `Campaign` had no back-reference,
 * Prisma had nothing to include, and a run showed up in the campaign list as an
 * email with no ads. Deleting a campaign also stranded its id on the ads instead
 * of clearing it.
 *
 * Turning the scalar into a relation adds a constraint to a column that already
 * holds data. `db push` runs in the deploy WITHOUT `--accept-data-loss` — and
 * correctly so, since that flag is unscoped and would let any future schema edit
 * silently drop columns — so the constraint is created here first and `db push`
 * then finds nothing to do. Same pattern as `ensure-adcreative-offer-unique.ts`.
 *
 * REPAIRS BEFORE IT CONSTRAINS. Any `campaignId` pointing at a campaign that no
 * longer exists would make the FK fail to validate and take the whole deploy
 * down. Those are exactly the orphans the missing `onDelete: SetNull` allowed to
 * accumulate, so they are nulled first — which is what SetNull would have done
 * at the time. Set-based, not a per-row loop: the deploy's SSH step times out at
 * 15 minutes.
 *
 * Idempotent: re-running finds the constraint present and does nothing.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

/** Prisma's own name for this FK. It must match, or `db push` will see the
 *  constraint as unrelated and try to add its own. */
const FK = 'AdCreative_campaignId_fkey';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[ensure-adcreative-campaign-fk] DATABASE_URL is not set');
    process.exit(1);
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
    // Both tables must exist. On a fresh environment `db push` creates them with
    // the relation already in place and there is nothing for this to do.
    const [{ ok }] = await prisma.$queryRawUnsafe<{ ok: boolean }[]>(
      `SELECT to_regclass('public."AdCreative"') IS NOT NULL
          AND to_regclass('public."Campaign"') IS NOT NULL AS ok`,
    );
    if (!ok) {
      console.log('[ensure-adcreative-campaign-fk] tables not present yet — nothing to do');
      return;
    }

    const [{ exists }] = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = '${FK}'
       ) AS exists`,
    );
    if (exists) {
      console.log('[ensure-adcreative-campaign-fk] already present');
      return;
    }

    // Clear ids whose campaign is gone — see REPAIRS above.
    const orphans = await prisma.$executeRawUnsafe(
      `UPDATE "AdCreative" a
          SET "campaignId" = NULL
        WHERE a."campaignId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "Campaign" c WHERE c.id = a."campaignId")`,
    );
    if (orphans > 0) {
      console.log(`[ensure-adcreative-campaign-fk] cleared ${orphans} orphaned campaignId value(s)`);
    }

    // Index first: Postgres does not create one for a FK automatically, and
    // "which ads belong to this run" is the query the campaign view is built on.
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "AdCreative_campaignId_idx" ON "AdCreative"("campaignId")`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "AdCreative"
         ADD CONSTRAINT "${FK}"
         FOREIGN KEY ("campaignId") REFERENCES "Campaign"(id)
         ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    console.log('[ensure-adcreative-campaign-fk] foreign key created');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[ensure-adcreative-campaign-fk] failed:', err);
  process.exit(1);
});
