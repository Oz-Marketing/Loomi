/**
 * Drop the retired Organization model (replaced by `Account.parentAccountKey`).
 *
 * Runs BEFORE `prisma db push` in the deploy: the guarded push (no
 * --accept-data-loss) refuses to drop a non-empty table or a populated column
 * and aborts the whole deploy. Same pattern as drop-retired-ad-types.ts.
 *
 * This one is NOT a plain drop, because two of the columns still carry meaning:
 *
 *   1. `User.orgKeys` granted access to an org's accounts. Dropping it without
 *      converting each grant to the equivalent group-ACCOUNT key silently
 *      revokes access for those users. So we migrate grants first.
 *   2. `Account.organizationId` is the ONLY record of the old grouping. If
 *      `parentAccountKey` hasn't been backfilled, dropping it destroys the
 *      hierarchy — and with it every roll-up AND the suppression cascade,
 *      which is a compliance path. So we refuse to run unless the replacement
 *      is already in place.
 *
 * Idempotent: once the columns are gone the information_schema checks short
 * out and it's a no-op, so it's safe to leave in the deploy pipeline.
 *
 * Raw SQL throughout — the generated client no longer knows these fields.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

const TAG = '[drop-organization-model]';

/** Is `column` still present on `table`? Drives the no-op-when-done behaviour. */
async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
    table,
    column,
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

function parseKeys(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Convert every `User.orgKeys` grant into the equivalent group-account grant.
 *
 * An org grant meant "every account in this org". Those accounts now hang off
 * a single parent, and a grant on a parent already expands to its descendants
 * (expandAccountKeysWithDescendants), so the parent key is the exact analogue.
 */
async function migrateOrgGrants(): Promise<void> {
  if (!(await columnExists('User', 'orgKeys'))) {
    console.log(`${TAG} User.orgKeys already gone — no grants to migrate`);
    return;
  }

  // org id → the parent account its members point at.
  const mapping = await prisma.$queryRawUnsafe<{ organizationId: string; parentAccountKey: string }[]>(
    `SELECT DISTINCT "organizationId", "parentAccountKey"
       FROM "Account"
      WHERE "organizationId" IS NOT NULL AND "parentAccountKey" IS NOT NULL`,
  );
  const parentForOrg = new Map(mapping.map((r) => [r.organizationId, r.parentAccountKey]));

  const users = await prisma.$queryRawUnsafe<
    { id: string; role: string; accountKeys: string; orgKeys: string | null }[]
  >(
    `SELECT id, role, "accountKeys", "orgKeys" FROM "User"
      WHERE "orgKeys" IS NOT NULL AND "orgKeys" <> '' AND "orgKeys" <> '[]'`,
  );

  let updated = 0;
  let skippedUnrestricted = 0;
  const unresolved: string[] = [];
  for (const u of users) {
    const existing = parseKeys(u.accountKeys);

    // An empty accountKeys list is not "no access" — for developer, super_admin
    // and admin it means UNRESTRICTED (hasUnrestrictedAccountAccess in
    // lib/roles.ts). Writing a key onto one of those users would quietly demote
    // them from seeing every account to seeing one group. Leave them alone.
    const unrestricted =
      u.role === 'developer' || u.role === 'super_admin' || (u.role === 'admin' && existing.length === 0);
    if (unrestricted) {
      skippedUnrestricted++;
      continue;
    }

    const next = new Set(existing);
    for (const orgId of parseKeys(u.orgKeys)) {
      const parent = parentForOrg.get(orgId);
      if (parent) next.add(parent);
      else unresolved.push(`${u.id}→${orgId}`);
    }
    if (next.size === existing.length) continue;
    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET "accountKeys" = $1 WHERE id = $2`,
      JSON.stringify([...next]),
      u.id,
    );
    updated++;
  }

  console.log(
    `${TAG} migrated org grants for ${updated}/${users.length} user(s)` +
      (skippedUnrestricted ? `; left ${skippedUnrestricted} unrestricted user(s) untouched` : ''),
  );
  if (unresolved.length) {
    // Not fatal: an org with no accounts under it granted access to nothing,
    // so there is no access to preserve. Logged because it's worth knowing.
    console.log(`${TAG} note: ${unresolved.length} grant(s) pointed at an org with no accounts: ${unresolved.join(', ')}`);
  }
}

/**
 * Refuse to drop `Account.organizationId` while it is the only surviving record
 * of the grouping. Losing it silently breaks roll-ups and narrows the
 * suppression cascade to a single account — neither of which looks like a
 * failure from the UI, which is exactly why this is a hard stop.
 *
 * "Orphaned" is deliberately NOT just `organizationId IS NOT NULL AND
 * parentAccountKey IS NULL`. A group's ROOT matches that too — it was a member
 * of the org and has nothing above it — and it is perfectly migrated. Flagging
 * it would block the deploy on every correctly-migrated group. An account is
 * only orphaned if it has nothing above it AND nothing below it.
 */
async function assertHierarchyBackfilled(): Promise<void> {
  if (!(await columnExists('Account', 'organizationId'))) return;

  const rows = await prisma.$queryRawUnsafe<{ key: string }[]>(
    `SELECT a.key
       FROM "Account" a
      WHERE a."organizationId" IS NOT NULL
        AND a."parentAccountKey" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "Account" c WHERE c."parentAccountKey" = a.key)`,
  );
  if (rows.length > 0) {
    throw new Error(
      `${rows.length} account(s) were grouped by organizationId but have no place in the ` +
        `hierarchy — no parent above and no sub-accounts below. Dropping now would lose ` +
        `their grouping for good. Set each one's parentAccountKey (Settings → Account → ` +
        `Organization), then re-run the deploy. Affected: ${rows.map((r) => r.key).join(', ')}`,
    );
  }
  console.log(`${TAG} hierarchy check passed — no orphaned groupings`);
}

async function main() {
  await assertHierarchyBackfilled();
  await migrateOrgGrants();

  // Column drops come FIRST so the foreign keys into Organization are gone
  // before the table is. Template/Form/LandingPage declare onDelete: Cascade on
  // that relation — dropping the columns first means there is no path for a
  // cascade to fire and take real records with it.
  const statements = [
    'ALTER TABLE "Account" DROP COLUMN IF EXISTS "organizationId"',
    'ALTER TABLE "Template" DROP COLUMN IF EXISTS "organizationId"',
    'ALTER TABLE "Form" DROP COLUMN IF EXISTS "organizationId"',
    'ALTER TABLE "LandingPage" DROP COLUMN IF EXISTS "organizationId"',
    'ALTER TABLE "AdTemplateDoc" DROP COLUMN IF EXISTS "organizationId"',
    'ALTER TABLE "User" DROP COLUMN IF EXISTS "orgKeys"',
    'DROP TABLE IF EXISTS "Organization"',
  ];
  for (const sql of statements) {
    await prisma.$executeRawUnsafe(sql);
    console.log(`${TAG} ok: ${sql}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`${TAG} failed`, e);
    process.exit(1);
  });
