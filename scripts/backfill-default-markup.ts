/**
 * One-time seed: set the agency-wide default markup (AppSetting
 * "app-default-markup") to 0.77 so live accounts keep computing at the prior
 * built-in factor the moment §0.1 ships. The code's intrinsic default is 0
 * (never a hardcoded business value), so without this seed unoverridden
 * accounts would compute a $0 target until an admin sets the value.
 *
 * Idempotent: only writes when the AppSetting row is absent, so edits made via
 * Settings → Markup are never clobbered. Safe to leave in the deploy pipeline —
 * becomes a no-op once seeded.
 *
 * KEY must match DEFAULT_MARKUP_SETTING_KEY in src/lib/services/markup.ts.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

const KEY = 'app-default-markup';
const VALUE = '0.77';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  const existing = await prisma.appSetting.findUnique({
    where: { key: KEY },
    select: { key: true },
  });
  if (existing) {
    console.log(`[backfill-default-markup] ${KEY} already set — skipped`);
    return;
  }
  await prisma.appSetting.create({ data: { key: KEY, value: VALUE } });
  console.log(`[backfill-default-markup] seeded ${KEY}=${VALUE}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[backfill-default-markup] failed', e);
    process.exit(1);
  });
