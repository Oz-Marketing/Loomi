/**
 * Backfill NotificationPreference.emailEnabled from the old single `enabled` flag.
 *
 * Before the split, one boolean gated both the bell panel and the email. `db push`
 * adds `emailEnabled` with a default of true, which would silently switch email
 * back ON for every user who had previously turned a notification type off. This
 * copies `enabled` across so existing choices survive the split; from here the two
 * move independently.
 *
 * Set-based UPDATE, not a per-row loop — the deploy's SSH step is capped at 15
 * minutes and row-at-a-time backfills have blown that budget on prod before.
 *
 * Guarded by an AppSetting key so a later deploy can't re-flatten a user's
 * deliberate "panel yes, email no" back onto `enabled`.
 *
 * Run: npx tsx scripts/backfill-notification-email-pref.ts
 * Also runs as part of the build / deploy:prepare step.
 */
try { require('dotenv/config'); } catch { /* dotenv not available in production — env vars already set */ }
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:5432/loomi_studio?schema=public';

const pool = new pg.Pool({
  connectionString: connectionString.replace(/[?&]sslmode=require/, (m) =>
    m.startsWith('?') ? '?' : '',
  ).replace(/\?$/, ''),
  ...(connectionString.includes('sslmode=require') && { ssl: { rejectUnauthorized: false } }),
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const GUARD_KEY = 'notifications:email-pref-split:v1';

async function main() {
  const already = await prisma.appSetting.findUnique({ where: { key: GUARD_KEY } });
  if (already) {
    console.log(`Email-pref backfill: already ran (${already.value}), skipping.`);
    return;
  }

  const count: number = await prisma.$executeRawUnsafe(
    `UPDATE "NotificationPreference" SET "emailEnabled" = "enabled" WHERE "emailEnabled" <> "enabled"`,
  );

  await prisma.appSetting.create({
    data: { key: GUARD_KEY, value: `${new Date().toISOString()} updated=${count}` },
  });

  console.log(`Email-pref backfill: aligned ${count} preference row(s) with their in-app setting.`);
}

main()
  .catch((e) => {
    console.error('Email-pref backfill failed:', e);
    process.exit(0);
  })
  .finally(() => pool.end());
