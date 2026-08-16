/**
 * Auth + scope guard for the reporting API surface.
 *
 * Wraps `getAuthSession()` + `getAccountScope()` from the shared
 * `api-auth` module and standardises the response shape every
 * reporting route uses. Route handlers should treat `error` as the
 * short-circuit response and otherwise destructure `ctx`.
 *
 *   const { ctx, error } = await requireReportingAccess();
 *   if (error) return error;
 *   // use ctx.accountKeys to scope DB queries; null = unrestricted
 *
 * Roles:
 *   - developer / super_admin → `accountKeys: null` (see all accounts)
 *   - admin / client          → `accountKeys: string[]` (scoped)
 *   - admin / client with no assignments → 403
 */
import { NextResponse } from 'next/server';
import { getAuthSession, getAccountScope } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import type { UserRole } from '@/lib/roles';
import { type Permission } from '@/lib/permissions/registry';
import { hasPermission, subjectFromSession } from '@/lib/permissions/require';
import {
  reportDefinition,
  resolveClientReports,
  type ReportKey,
} from '@/lib/permissions/reports';

export interface ReportingContext {
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
  };
  /** `null` when unrestricted (developer/super_admin); else the keys the caller may query. */
  accountKeys: string[] | null;
  /**
   * Whether internal cost may be included in the response.
   *
   * `applyMargins()` attaches `actual_<field>` alongside every billed figure —
   * the raw platform cost, before Oz's markup. Those keys were going over the
   * wire to every viewer including dealers, who could recover the agency margin
   * with `1 - actual_spend / spend`. Routes must pass their payload through
   * `stripInternalCost()` when this is false.
   */
  canViewSpend: boolean;
}

type GuardResult =
  | { ctx: ReportingContext; error: null }
  | { ctx: null; error: NextResponse };

export type ReportingGuardOptions = {
  /**
   * Which report this route serves. Omit only for routes that aren't a report
   * (`/me`, the OAuth callbacks) — omitting it skips both the permission check
   * and the per-account allowlist.
   */
  report?: ReportKey;
  /** The account being queried, for the allowlist check. */
  accountKey?: string | null;
  /**
   * The request, so the guard can read `?accountKey=` itself.
   *
   * Every reporting route already takes the account from the query string, but
   * most parse it *after* calling this guard. Passing the request avoids
   * reordering 21 handlers just to move one line — and means a route can't
   * accidentally check the allowlist against a different account than the one
   * it goes on to query.
   */
  req?: { nextUrl: { searchParams: URLSearchParams } };
};

export async function requireReportingAccess(
  options: ReportingGuardOptions = {},
): Promise<GuardResult> {
  const session = await getAuthSession();
  if (!session?.user) {
    return {
      ctx: null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const accountKeys = getAccountScope(session);

  // Scoped role with no account assignments — block rather than
  // silently returning empty data, so the caller sees the real reason.
  if (accountKeys !== null && accountKeys.length === 0) {
    return {
      ctx: null,
      error: NextResponse.json(
        { error: 'No accounts assigned to this user' },
        { status: 403 },
      ),
    };
  }

  const subject = subjectFromSession(session);
  // Through the flag-aware path, not `can()` directly: until
  // PERMISSIONS_ENFORCE_CAPABILITIES is on this must fall back to the legacy
  // bucket like every other capability, or cost figures would vanish for staff
  // without a grant row before anyone turned enforcement on.
  const canViewSpend = hasPermission(session, subject, 'finance.spend.view');

  if (options.report) {
    const definition = reportDefinition(options.report);
    if (!definition) {
      // An unknown key means a route is asking for a report the registry
      // doesn't define — a bug, and one that would otherwise wave everyone
      // through.
      return {
        ctx: null,
        error: NextResponse.json(
          { error: `Unknown report: ${options.report}` },
          { status: 500 },
        ),
      };
    }

    const accountKey =
      options.accountKey ?? options.req?.nextUrl.searchParams.get('accountKey') ?? null;

    const denied = await denyReport(session, subject, definition, accountKey);
    if (denied) return { ctx: null, error: denied };
  }

  return {
    ctx: {
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
      },
      accountKeys,
      canViewSpend,
    },
    error: null,
  };
}

/**
 * The report-level checks: the role's permission first, then — for clients only
 * — the account's allowlist.
 *
 * Order matters. The permission is the security boundary; the allowlist is a
 * curation tool on top of it, and is only consulted for someone the permission
 * already admitted.
 */
async function denyReport(
  session: Parameters<typeof hasPermission>[0],
  subject: ReturnType<typeof subjectFromSession>,
  definition: { key: ReportKey; permission: Permission },
  accountKey?: string | null,
): Promise<NextResponse | null> {
  if (!hasPermission(session, subject, definition.permission, {
    accountKey: accountKey ?? undefined,
  })) {
    return NextResponse.json(
      { error: 'Forbidden', requiredPermission: definition.permission },
      { status: 403 },
    );
  }

  // Staff see every report they hold the permission for. The allowlist governs
  // what a dealer is shown, not what an account manager may look at.
  if (subject.tier !== 'client') return null;
  if (!accountKey) return null;

  const rows = await prisma.accountReportAccess.findMany({
    where: { accountKey },
    select: { reportKey: true, enabled: true },
  });

  if (!resolveClientReports(rows).has(definition.key)) {
    return NextResponse.json(
      { error: 'This report is not enabled for this account' },
      { status: 403 },
    );
  }
  return null;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Strip the internal cost figures from an ad-report payload.
 *
 * Removes two things, recursively — recursively because they sit on nested rows
 * (`campaigns[]`, `daily[]`, `devices[]`), not just the top-level metrics:
 *
 *   • `actual_<field>` — the raw platform cost `applyMargins()` preserves
 *     alongside each billed figure.
 *   • `margin` — the markup percent itself, which is the same secret stated
 *     directly. Every ad-report component declares it and none of them render
 *     it, so removing it changes nothing on screen.
 *
 * Either one lets a dealer recover what Oz pays: `actual_spend / spend` gives
 * the margin, and `margin` gives it outright.
 *
 * Call whenever `ctx.canViewSpend` is false.
 */
export function stripInternalCost<T>(payload: T): T {
  if (Array.isArray(payload)) {
    return payload.map((item) => stripInternalCost(item)) as unknown as T;
  }
  // Only recurse into PLAIN objects. A Date (or any class instance) has no
  // enumerable own properties, so rebuilding it from Object.entries would
  // return `{}` — the field would serialise as an empty object and the client
  // would render "Invalid Date", but only for callers without the capability.
  if (payload instanceof Date) return payload;
  if (payload && typeof payload === 'object' && isPlainObject(payload)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      // `margins` (plural) is StackAdapt's OWN margin field on
      // DeliveryStatsRecord. Nothing requests it today, but it sits in the same
      // 89-field list someone scrolls when adding a metric, and a singular-only
      // check would wave it straight through to a dealer. Cheaper to block now
      // than to notice later.
      if (key.startsWith('actual_') || key === 'margin' || key === 'margins') continue;
      out[key] = stripInternalCost(value);
    }
    return out as T;
  }
  return payload;
}
