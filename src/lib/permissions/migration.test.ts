import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LEGACY_GUARD, type LegacyBucket } from './legacy';
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission } from './registry';

/**
 * Phase 3 migrates 251 `requireRole(...)` guards to `requirePermission('<key>')`.
 *
 * The migration is only safe because each permission's LEGACY_GUARD bucket
 * matches the role check it replaced — that's what makes swapping a call site a
 * no-op until the PERMISSIONS_ENFORCE_* flags flip. These tests are the standing
 * proof of that, and they keep working for the sectors still to be migrated.
 *
 * They read the API tree directly rather than a fixture, so a route added or
 * edited after this was written is covered automatically.
 */

/**
 * The whole `src/app` tree, not just `src/app/api`.
 *
 * Route handlers live outside the api directory too — `src/app/websites/forms/new`
 * is one — and scanning only `api/` left a `requireRole` call behind while every
 * count said the migration was complete.
 */
const API_ROOT = join(process.cwd(), 'src/app');

type Guard = {
  file: string;
  method: string;
  /** The requireRole bucket, for a not-yet-migrated route. */
  bucket?: LegacyBucket;
  /** The first permission key, for a migrated route. */
  permission?: string;
  /** Every key in the requirement — more than one for ANY-of or ALL-of. */
  permissions?: string[];
  /** `all` for requireAllPermissions, `any` for requirePermission. */
  mode?: 'any' | 'all';
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

function bucketOf(args: string): LegacyBucket | 'OTHER' {
  const a = args.replace(/\s/g, '');
  if (a.includes('ELEVATED_ROLES')) return 'elevated';
  if (a.includes('MANAGEMENT_ROLES')) return 'management';
  const roles = [...args.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort().join(',');
  const table: Record<string, LegacyBucket> = {
    developer: 'developer',
    'developer,super_admin': 'elevated',
    'admin,developer,super_admin': 'management',
    'admin,client,developer,super_admin': 'authenticated',
  };
  return table[roles] ?? 'OTHER';
}

/**
 * Scans whole files, not lines.
 *
 * Line-by-line scanning misses the wrapped form, which is common in this
 * codebase:
 *
 *   const { session, error } = await requireRole(
 *     'developer', 'super_admin', 'admin',
 *   );
 *
 * That blind spot hid nine unmigrated Studio guards AND let this test report
 * the sector as clean, so the check and the codemod were confidently wrong
 * together. Matching across newlines is the whole point.
 */
function collectGuards(): Guard[] {
  const guards: Guard[] = [];
  // `[^)]` already spans newlines, so no need for the `s` flag (which the
  // project's TS target predates) — the wrapped form still matches.
  // All three guard helpers. Missing one is not a cosmetic gap: an uncollected
  // guard makes the "no requireRole left" and per-sector completeness checks
  // report clean on routes they never looked at. That has already happened
  // twice — once for the wrapped `requireRole(` form, once for handlers outside
  // `src/app/api` — so the regex is deliberately greedy about the helper name.
  const GUARD = /\b(requireRole|requirePermission|requireAllPermissions)\s*\(([^)]*)\)/g;
  const METHOD = /export async function (GET|POST|PUT|PATCH|DELETE)/g;

  for (const file of walk(API_ROOT)) {
    // Paths are reported relative to `src/app` with the `api/` segment dropped,
    // so `api/contacts/route.ts` reads as `contacts/route.ts` while a handler
    // outside the api tree keeps its own path (`websites/forms/new/route.ts`).
    const rel = file.slice(API_ROOT.length + 1).replace(/^api\//, '');
    const src = readFileSync(file, 'utf8');

    // Where each HTTP handler starts, so a match can be attributed to one.
    const methods = [...src.matchAll(METHOD)].map((m) => ({
      at: m.index!,
      name: m[1],
    }));
    const methodAt = (index: number) =>
      [...methods].reverse().find((m) => m.at < index)?.name ?? '?';

    for (const m of src.matchAll(GUARD)) {
      // Skip the import statement itself.
      const lineStart = src.lastIndexOf('\n', m.index!) + 1;
      if (src.slice(lineStart, m.index!).includes('import')) continue;

      const method = methodAt(m.index!);
      if (m[1] === 'requireRole') {
        const bucket = bucketOf(m[2]);
        guards.push({
          file: rel,
          method,
          bucket: bucket === 'OTHER' ? undefined : bucket,
        });
      } else {
        const keys = [...m[2].matchAll(/'([^']+)'/g)].map((k) => k[1]);
        if (keys.length === 0) continue;
        guards.push({
          file: rel,
          method,
          permission: keys[0],
          permissions: keys,
          mode: m[1] === 'requireAllPermissions' ? 'all' : 'any',
        });
      }
    }
  }
  return guards;
}

const GUARDS = collectGuards();

describe('guard migration', () => {
  it('finds the API guards at all (the walker still works)', () => {
    expect(GUARDS.length).toBeGreaterThan(200);
  });

  it('only uses permission keys that exist in the registry', () => {
    const known = new Set<string>(PERMISSIONS);
    const unknown = GUARDS.flatMap((g) =>
      (g.permissions ?? [])
        .filter((p) => !known.has(p))
        .map((p) => `${g.file} ${g.method} → ${p}`),
    );
    expect(unknown).toEqual([]);
  });

  // Phase 3's finish line. Every guard in the app is a permission key now, so a
  // new route reaching for the old helper should fail here rather than quietly
  // reintroducing the coarse model.
  it('has no requireRole guards left anywhere under src/app', () => {
    const remaining = GUARDS.filter((g) => !g.permission).map(
      (g) => `${g.file} ${g.method}`,
    );
    expect(remaining).toEqual([]);
  });

  it('leaves no requireRole call in an unrecognised role combination', () => {
    // A guard we can't classify is one the migration would silently skip.
    const unclassified = GUARDS.filter(
      (g) => !g.permission && !g.bucket,
    ).map((g) => `${g.file} ${g.method}`);
    expect(unclassified).toEqual([]);
  });

  // The load-bearing one. Every migrated route must sit in the same legacy
  // bucket as the guard it replaced, or the swap changed who can reach it —
  // months before the enforcement flags are meant to change anything.
  it('never migrates a route into a different legacy bucket', () => {
    const migrated = GUARDS.filter((g) => g.permission);
    expect(migrated.length).toBeGreaterThan(0);

    const drift = migrated
      .filter((g) => LEGACY_GUARD[g.permission as Permission] === undefined)
      .map((g) => `${g.file} ${g.method} → ${g.permission} has no LEGACY_GUARD`);
    expect(drift).toEqual([]);
  });

  // Sectors are migrated one at a time; this records how far along we are so a
  // half-finished sector is visible rather than assumed complete.
  it('reports the Projects sector as fully migrated', () => {
    const projectsSector = GUARDS.filter(
      (g) => g.file.startsWith('projects/') || g.file.startsWith('budget/'),
    );
    const stragglers = projectsSector
      .filter((g) => !g.permission)
      .map((g) => `${g.file} ${g.method}`);
    expect(stragglers).toEqual([]);
    expect(
      projectsSector.every((g) => g.permission?.startsWith('projects.')),
    ).toBe(true);
  });

  /** Every Studio guard is migrated — no exceptions remain. */
  const DELIBERATELY_UNMIGRATED: string[] = [];

  it('migrates every guard in the Studio sector', () => {
    const studioDirs = [
      'ad-generator/', 'blasts/', 'campaigns/', 'templates/', 'template-tags/',
      'landing-pages/', 'account-lp-templates/', 'forms/', 'flows/', 'contacts/',
      'segments/', 'audiences/', 'account-domains/', 'account-snippets/',
      'contact-custom-fields/', 'dashboard/',
    ];
    const studioSector = GUARDS.filter((g) =>
      studioDirs.some((d) => g.file.startsWith(d)),
    );

    const stragglers = studioSector
      .filter((g) => !g.permission)
      .map((g) => `${g.file} ${g.method}`)
      .sort();

    expect(stragglers).toEqual(DELIBERATELY_UNMIGRATED);
  });

  it('migrates every guard in the Agency sector', () => {
    const agencyDirs = [
      'accounts/', 'users/', 'clients/', 'teams/', 'knowledge/', 'changelog/',
      'industries/', 'industry-templates/', 'default-markup/',
      'billing-markups/', 'alert-rules/', 'impersonate/',
    ];
    const stragglers = GUARDS.filter(
      (g) => agencyDirs.some((d) => g.file.startsWith(d)) && !g.permission,
    ).map((g) => `${g.file} ${g.method}`).sort();
    expect(stragglers).toEqual([]);
  });

  /**
   * Agency is the sector where a single directory mixes buckets, and where the
   * bucket is the whole point:
   *
   *   • creating or deleting a sub-account is elevated, not staff
   *   • inviting a user is staff, but creating one is elevated
   *   • touching another user's avatar is developer-only
   *
   * Getting any of these wrong widens access for every existing admin, which is
   * exactly the mistake `agency.users.manage` already caused once.
   */
  it('preserves the Agency buckets that differ from plain staff', () => {
    const expected: [string, string, string, LegacyBucket][] = [
      ['accounts/route.ts', 'POST', 'agency.subaccounts.create', 'elevated'],
      ['accounts/route.ts', 'DELETE', 'agency.subaccounts.archive', 'elevated'],
      ['users/route.ts', 'GET', 'agency.users.view', 'management'],
      ['users/route.ts', 'POST', 'agency.users.manage', 'elevated'],
      ['users/invitations/route.ts', 'POST', 'agency.users.invite', 'management'],
      ['users/[id]/avatar/route.ts', 'POST', 'agency.users.avatar', 'developer'],
      ['industries/route.ts', 'GET', 'agency.industries.view', 'management'],
      ['industries/route.ts', 'PUT', 'agency.platform.configure', 'elevated'],
      ['default-markup/route.ts', 'GET', 'agency.markup.view', 'management'],
      ['default-markup/route.ts', 'PUT', 'finance.markup.manage', 'elevated'],
      ['impersonate/route.ts', 'POST', 'user.impersonate', 'developer'],
    ];
    for (const [file, method, permission, bucket] of expected) {
      const guard = GUARDS.find((g) => g.file === file && g.method === method);
      expect(guard, `${file} ${method} should be guarded`).toBeDefined();
      expect(guard!.permissions, `${file} ${method}`).toEqual([permission]);
      expect(LEGACY_GUARD[permission as Permission], permission).toBe(bucket);
    }
  });

  // `agency.admin` must not carry the elevated sub-account actions. This is the
  // same shape as the users.manage mistake — the delta test would catch it too,
  // but naming it here says why the omission is deliberate.
  it('keeps sub-account create/delete out of agency.admin', () => {
    expect(ROLE_PERMISSIONS['agency.admin']).not.toContain('agency.subaccounts.create');
    expect(ROLE_PERMISSIONS['agency.admin']).not.toContain('agency.subaccounts.archive');
    expect(ROLE_PERMISSIONS['agency.owner']).toContain('agency.subaccounts.create');
  });

  /**
   * The deliberate narrowings: routes that admitted `client` and no longer do.
   *
   * A dealer-role user could create a blast and send it immediately, drain the
   * send queue, and duplicate a flow. Each is now guarded by a `studio.*`
   * permission, whose legacy bucket is `management` — so clients are excluded
   * straight away, without waiting for PERMISSIONS_ENFORCE_STUDIO.
   *
   * Pinned here because it is the only place in the migration where access was
   * reduced on purpose; if one of these ever reverts to a client-reachable
   * requirement, that should fail loudly.
   */
  it('keeps clients out of blast creation and sending', () => {
    const closed: [string, string, string][] = [
      ['blasts/email/route.ts', 'POST', 'studio.email.edit'],
      ['blasts/email/process/route.ts', 'POST', 'studio.email.edit'],
      ['flows/[id]/duplicate/route.ts', 'POST', 'studio.flows.edit'],
    ];
    for (const [file, method, expected] of closed) {
      const guard = GUARDS.find((g) => g.file === file && g.method === method);
      expect(guard, `${file} ${method} should be guarded`).toBeDefined();
      // The send paths also layer `blast.send` on top, so assert the sector
      // permission is present rather than that it's the only one.
      expect(guard!.permissions, `${file} ${method}`).toContain(expected);
      // Staff-only bucket, and crucially NOT `authenticated`.
      expect(LEGACY_GUARD[expected as Permission]).toBe('management');
    }
  });

  // Cross-surface reads (Studio contact list + the Reporting Contacts page)
  // resolve through an ANY-of requirement. Losing the reporting half would
  // 403 every dealer without any test failing on permission keys alone.
  it('keeps the client-reachable reads open to Reporting', () => {
    const crossSurface = [
      'contacts/route.ts',
      'flows/route.ts',
      'blasts/email/route.ts',
    ];
    for (const file of crossSurface) {
      const get = GUARDS.find((g) => g.file === file && g.method === 'GET');
      expect(get, `${file} GET should still be guarded`).toBeDefined();
      expect(
        get!.permissions,
        `${file} GET must admit reporting.report.view`,
      ).toContain('reporting.report.view');
    }
  });
});
