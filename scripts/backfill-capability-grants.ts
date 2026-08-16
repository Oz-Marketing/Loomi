/**
 * Phase 4: seed `UserCapabilityGrant` so `PERMISSIONS_ENFORCE_CAPABILITIES`
 * can be turned on without breaking anything.
 *
 * Sensitive capabilities are never conferred by a sector role, so the moment
 * that flag flips, a user with no grant loses the ability to send a blast,
 * export contacts, see spend, rotate credentials or impersonate. With an empty
 * grants table that means EVERYONE loses all of it at once.
 *
 * So this seeds the capability to exactly the people who can already do it
 * today, reproducing current access precisely — the same deliberately-boring
 * approach as the Phase 1 sector-role backfill:
 *
 *   blast.send                       → staff  (developer, super_admin, admin)
 *   contacts.pii.export              → staff
 *   finance.spend.view               → staff
 *   integrations.credentials.manage  → staff
 *   finance.markup.manage            → developer, super_admin   (elevated today)
 *   user.impersonate                 → developer                (developer today)
 *
 * That looks permissive, and it is — on purpose. Narrowing happens in the UI,
 * per person, and the audit log makes it evidence-based: let it run, see who
 * actually exercises each capability, then revoke from everyone who never does.
 * Guessing up front would lock someone out mid-campaign.
 *
 * GUARDED by an AppSetting key, so revoking a grant by hand isn't undone by the
 * next deploy.
 *
 * Run: npx tsx scripts/backfill-capability-grants.ts
 * Also runs as part of the build / deploy:prepare step.
 */
try { require('dotenv/config'); } catch { /* dotenv not available in production — env vars already set */ }
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { SENSITIVE_CAPABILITIES } from '../src/lib/permissions/registry';
import { legacyCapabilitiesFor } from '../src/lib/permissions/legacy';
import type { UserRole } from '../src/lib/roles';

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

const GUARD_KEY = 'permissions:capability-grant-backfill:v1';
const CHUNK = 500;

// The role → capability mapping lives in `legacyCapabilitiesFor`, shared with
// `POST /api/users` so a user created after this one-shot backfill lands in the
// same state as everyone else.

async function main() {
  const already = await prisma.appSetting.findUnique({ where: { key: GUARD_KEY } });
  if (already) {
    console.log(`Capability-grant backfill: already ran (${already.value}), skipping.`);
    return;
  }

  const users = await prisma.user.findMany({ select: { id: true, role: true } });

  type Row = { userId: string; capability: string; effect: string; scopeKey: string };
  const rows: Row[] = [];
  for (const user of users) {
    for (const capability of legacyCapabilitiesFor(user.role as UserRole)) {
      // `''` is the "everywhere" scope — see the UserCapabilityGrant comment.
      rows.push({ userId: user.id, capability, effect: 'allow', scopeKey: '' });
    }
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const result = await prisma.userCapabilityGrant.createMany({
      data: rows.slice(i, i + CHUNK),
      // Anything already granted (or explicitly denied) by hand is left alone.
      skipDuplicates: true,
    });
    inserted += result.count;
  }

  await prisma.appSetting.create({
    data: {
      key: GUARD_KEY,
      value: `${new Date().toISOString()} users=${users.length} grants=${inserted}`,
    },
  });

  console.log(
    `Capability-grant backfill: ${users.length} user(s) → ${inserted} grant(s).`,
  );
  for (const capability of SENSITIVE_CAPABILITIES) {
    const count = await prisma.userCapabilityGrant.count({
      where: { capability, effect: 'allow' },
    });
    console.log(`  ${capability.padEnd(32)} ${count} holder(s)`);
    if (count === 0) {
      console.warn(
        `  ! nobody holds ${capability} — it will be unusable once ` +
          `PERMISSIONS_ENFORCE_CAPABILITIES is on.`,
      );
    }
  }
}

main()
  .catch((e) => {
    console.error('Capability-grant backfill failed:', e);
    process.exit(0);
  })
  .finally(() => pool.end());
