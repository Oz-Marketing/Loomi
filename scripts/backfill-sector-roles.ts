/**
 * Phase 1 of the permissions restructure: seed `User.scopeMode` and
 * `UserSectorRole` from the legacy `User.role` string.
 *
 * Deliberately boring. The mapping reproduces today's effective access
 * (`legacySectorRolesFor` in src/lib/permissions/legacy.ts) so that flipping
 * enforcement in Phase 3 is a no-op, and narrowing anyone to `studio.designer`
 * happens by hand in the UI where it can be eyeballed.
 *
 * NOTHING READS THESE ROWS YET. `requirePermission()` still delegates to the
 * legacy role buckets until the PERMISSIONS_ENFORCE_* flags flip, so this
 * script cannot change what any user can do.
 *
 * GUARDED by an AppSetting key, and that matters: Phase 2 lets an admin REMOVE
 * a sector role by hand, and an unguarded seed would put it back on the next
 * deploy. (Loomi has been bitten by exactly that before — the changelog entries
 * that kept reappearing.) The trade-off is that users created after this runs
 * get no rows; assigning roles at user-creation time is Phase 2 work, and the
 * summary below counts the gap so it stays visible.
 *
 * Set-based: two statements plus one chunked createMany, no per-row loop — the
 * deploy's SSH step is capped at 15 minutes.
 *
 * Run: npx tsx scripts/backfill-sector-roles.ts
 * Also runs as part of the build / deploy:prepare step.
 */
try { require('dotenv/config'); } catch { /* dotenv not available in production — env vars already set */ }
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { legacySectorRolesFor, legacyTierFor } from '../src/lib/permissions/legacy';
import { parseSectorRoleRef, canTierHoldRole } from '../src/lib/permissions/registry';
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

const GUARD_KEY = 'permissions:sector-role-backfill:v2';
const CHUNK = 500;

const LEGACY_ROLES: UserRole[] = ['developer', 'super_admin', 'admin', 'client'];

/**
 * v1 seeded `admin` too narrowly — `reporting.analyst` and `projects.member`,
 * which would have silently removed nine permissions an admin holds today
 * (reporting.configure, initiative create/edit, budget, pacing, teams,
 * task.assign_any) the moment enforcement flipped.
 *
 * v2 repairs those rows, but ONLY where they still hold v1's exact value: a
 * role someone has since changed by hand is a deliberate decision and must
 * survive. Anything not listed here is left alone.
 */
const V1_REPAIRS: { legacyRole: UserRole; sector: string; from: string; to: string }[] = [
  { legacyRole: 'admin', sector: 'reporting', from: 'analyst', to: 'admin' },
  { legacyRole: 'admin', sector: 'projects', from: 'member', to: 'admin' },
];

async function main() {
  const already = await prisma.appSetting.findUnique({ where: { key: GUARD_KEY } });
  if (already) {
    console.log(`Sector-role backfill: already ran (${already.value}), skipping.`);
    return;
  }

  // ── 1. scopeMode ────────────────────────────────────────────────────────
  //
  // Who is unrestricted TODAY, reproduced exactly:
  //   • developer / super_admin — `getAccountScope()` returns null for them,
  //     regardless of what `accountKeys` holds.
  //   • admin with an EMPTY accountKeys — `authOptions.jwt` (src/lib/auth.ts:419)
  //     swaps the empty array for every account key at token-mint time.
  //     An admin with explicit keys stays limited to them.
  //
  // Everyone else keeps the column default of `listed`.
  const unrestricted: number = await prisma.$executeRawUnsafe(
    `UPDATE "User"
        SET "scopeMode" = 'all'
      WHERE "scopeMode" <> 'all'
        AND ( "role" IN ('developer', 'super_admin')
           OR ( "role" = 'admin'
                AND regexp_replace(COALESCE("accountKeys", '[]'), '\\s', '', 'g') = '[]' ) )`,
  );

  const scoped: number = await prisma.$executeRawUnsafe(
    `UPDATE "User" SET "scopeMode" = 'listed' WHERE "scopeMode" NOT IN ('all', 'listed')`,
  );

  // ── 2. Sector roles ─────────────────────────────────────────────────────
  const users = await prisma.user.findMany({ select: { id: true, role: true } });

  type Row = { userId: string; sector: string; role: string };
  const rows: Row[] = [];
  const unknownRoles = new Map<string, number>();

  for (const user of users) {
    if (!LEGACY_ROLES.includes(user.role as UserRole)) {
      unknownRoles.set(user.role, (unknownRoles.get(user.role) ?? 0) + 1);
      continue;
    }
    const role = user.role as UserRole;
    const tier = legacyTierFor(role);

    for (const ref of legacySectorRolesFor(role)) {
      const parsed = parseSectorRoleRef(ref);
      // Belt-and-braces: a test already pins that the mapping is legal for its
      // tier, but a row the resolver would silently drop is worse than no row.
      if (!parsed || !canTierHoldRole(tier, parsed.sector, parsed.role)) {
        console.warn(`  ! skipping illegal assignment ${ref} for tier ${tier}`);
        continue;
      }
      rows.push({ userId: user.id, sector: parsed.sector, role: parsed.role });
    }
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const result = await prisma.userSectorRole.createMany({
      data: batch,
      // Anyone already carrying a hand-assigned role keeps it.
      skipDuplicates: true,
    });
    inserted += result.count;
  }

  // ── 3. Repair v1's over-narrow admin seed ───────────────────────────────
  //
  // Set-based, and scoped to rows that still carry v1's exact value so a
  // hand-assignment is never clobbered.
  let repaired = 0;
  for (const fix of V1_REPAIRS) {
    const n: number = await prisma.$executeRawUnsafe(
      `UPDATE "UserSectorRole" sr
          SET "role" = $1, "updatedAt" = now()
         FROM "User" u
        WHERE sr."userId" = u."id"
          AND u."role"    = $2
          AND sr."sector" = $3
          AND sr."role"   = $4`,
      fix.to,
      fix.legacyRole,
      fix.sector,
      fix.from,
    );
    if (n > 0) {
      console.log(
        `  repaired ${n} ${fix.legacyRole} row(s): ${fix.sector}.${fix.from} → ${fix.sector}.${fix.to}`,
      );
    }
    repaired += n;
  }

  await prisma.appSetting.create({
    data: {
      key: GUARD_KEY,
      value: `${new Date().toISOString()} users=${users.length} roles=${inserted} unrestricted=${unrestricted} repaired=${repaired}`,
    },
  });

  console.log(
    `Sector-role backfill: ${users.length} user(s) → ${inserted} sector-role row(s); ` +
      `${unrestricted} set to scopeMode=all.`,
  );
  if (scoped > 0) {
    console.log(`  normalised ${scoped} row(s) with an unrecognised scopeMode to 'listed'.`);
  }
  if (unknownRoles.size > 0) {
    for (const [role, count] of unknownRoles) {
      console.warn(
        `  ! ${count} user(s) have unrecognised role "${role}" and got NO sector roles — assign by hand.`,
      );
    }
  }

  // Make the known gap visible rather than leaving it to be discovered in
  // Phase 3: any user without rows would resolve to zero permissions once the
  // enforcement flags flip.
  const withoutRoles = await prisma.user.count({ where: { sectorRoles: { none: {} } } });
  if (withoutRoles > 0) {
    console.warn(
      `  ! ${withoutRoles} user(s) hold no sector role at all. They will have NO access ` +
        `once PERMISSIONS_ENFORCE_* is enabled — assign roles in Settings → Users first.`,
    );
  }
}

main()
  .catch((e) => {
    console.error('Sector-role backfill failed:', e);
    process.exit(0);
  })
  .finally(() => pool.end());
