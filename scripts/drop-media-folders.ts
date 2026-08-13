/**
 * Drop the retired media folder system.
 *
 * Folders were the media library's only organiser before scope, facets and
 * search existed. Once those landed, a folder could only express "an arbitrary
 * pile someone made", and the proper home for that is collections — so folders
 * went rather than lingering as a second, weaker way to find things.
 *
 * Runs BEFORE `prisma db push` in the deploy: the guarded push (no
 * --accept-data-loss) refuses to drop a non-empty table or a populated column
 * and aborts the whole deploy. Same pattern as drop-organization-model.ts.
 *
 * Unlike that one this IS a plain drop. Nothing here needs migrating first:
 * confirmed with the owner that no asset in staging or production is organised
 * into a folder, so `MediaAsset.folderId` carries no information worth keeping.
 *
 * It still REPORTS what it's about to destroy before doing it. If that count is
 * ever non-zero the assumption above has stopped being true, and a line in the
 * deploy log is what makes that visible rather than silent.
 *
 * NOTE: `EmailFolder` is a different feature and is untouched.
 *
 * Idempotent: once the table and column are gone the information_schema checks
 * short out and it's a no-op, so it's safe to leave in the deploy pipeline.
 *
 * Raw SQL throughout — the generated client no longer knows these fields.
 *
 * Loads dotenv for the same reason as the other drop scripts: it builds its own
 * client, so without this `npm run db:sync` fails locally with
 * `DatabaseDoesNotExist` from the libpq fallback.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as never);

const TAG = '[drop-media-folders]';

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
    table,
    column,
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function tableExists(table: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = $1`,
    table,
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function main() {
  const hasColumn = await columnExists('MediaAsset', 'folderId');
  const hasTable = await tableExists('MediaFolder');

  if (!hasColumn && !hasTable) {
    console.log(`${TAG} already removed — nothing to do.`);
    return;
  }

  // Say what is being destroyed. Zero is the expected answer; anything else
  // means the "nothing is organised into folders" assumption has lapsed, and
  // this line is the only place that would show it.
  if (hasColumn) {
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM "MediaAsset" WHERE "folderId" IS NOT NULL`,
    );
    const filed = Number(rows[0]?.n ?? 0);
    if (filed > 0) {
      console.warn(
        `${TAG} WARNING: ${filed} asset(s) were filed in a folder. The assets are `
          + `untouched — only the folder assignment is being dropped.`,
      );
    } else {
      console.log(`${TAG} no asset was filed in a folder, as expected.`);
    }
  }

  if (hasTable) {
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM "MediaFolder"`,
    );
    console.log(`${TAG} dropping MediaFolder (${Number(rows[0]?.n ?? 0)} row(s)).`);
  }

  // Column first: it holds the FK into the table, so dropping the table while
  // the constraint stands would fail.
  if (hasColumn) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "MediaAsset" DROP COLUMN "folderId"`);
    console.log(`${TAG} dropped MediaAsset.folderId.`);
  }
  if (hasTable) {
    await prisma.$executeRawUnsafe(`DROP TABLE "MediaFolder"`);
    console.log(`${TAG} dropped MediaFolder.`);
  }
}

main()
  .catch((err) => {
    console.error(`${TAG} failed:`, err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
