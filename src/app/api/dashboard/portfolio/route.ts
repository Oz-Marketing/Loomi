import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import { filterAccountKeysByAccess } from '@/lib/roles';
import { prisma } from '@/lib/prisma';
import {
  getPortfolioKpis,
  getEngagementTimeline,
  getEngagedContacts,
  getLifecycleAlerts,
  getSendPipeline,
  getAccountHealth,
  getAnomalies,
  getTopCampaigns,
  getRecentActivity,
  getRepPerformance,
  getSuppressionHealth,
  getMetaPacerSummary,
} from '@/lib/services/portfolio-analytics';
import {
  generateMockPortfolio,
  isDashboardMockEnabled,
} from '@/lib/services/portfolio-analytics-mock';

/**
 * GET /api/dashboard/portfolio
 *
 * One-shot fetch for the admin / developer portfolio dashboard.
 * Query params:
 *   - accountKeys: comma-separated list (default: every account the
 *                  caller can see)
 *   - start, end:  ISO timestamps (default: last 30 days)
 *   - engagedWindowDays: window for "engaged contact" count (default 90)
 *
 * Each section is computed in parallel; one slow query won't block
 * the others. Sections share the same role-scoped account key list.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const requestedKeys = (req.nextUrl.searchParams.get('accountKeys') || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const startParam = req.nextUrl.searchParams.get('start');
  const endParam = req.nextUrl.searchParams.get('end');
  const engagedWindowParam = req.nextUrl.searchParams.get('engagedWindowDays');

  const start = parseDate(startParam) ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = parseDate(endParam) ?? new Date();
  const engagedWindowDays = clampWindow(engagedWindowParam);

  const role = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];

  // Dummy mode short-circuit: bypasses DB queries entirely and returns
  // a deterministic, fully-populated payload. Useful for design QA and
  // screenshots without seeding the dev DB. Set DASHBOARD_DUMMY_DATA=1
  // (or NEXT_PUBLIC_DASHBOARD_DUMMY_DATA=1) to enable.
  //
  // requestedKeys are passed through so the mock can scope down to a
  // single account when the caller is viewing /accounts/<key>.
  if (isDashboardMockEnabled()) {
    return NextResponse.json(
      generateMockPortfolio({
        start,
        end,
        engagedWindowDays,
        role,
        accountKeys: requestedKeys,
      }),
    );
  }

  const allAccounts = await prisma.account.findMany({
    // `'\\_'` escapes the SQL LIKE wildcard — see comment in
    // src/app/api/contacts/aggregate/route.ts for full explanation.
    where: { key: { not: { startsWith: '\\_' } } },
    select: { key: true },
  });
  const allowedKeys = filterAccountKeysByAccess(
    allAccounts.map((a) => a.key),
    role,
    userAccountKeys,
  );
  const accountKeys = requestedKeys.length > 0
    ? requestedKeys.filter((k) => allowedKeys.includes(k))
    : allowedKeys;

  if (accountKeys.length === 0) {
    return NextResponse.json({
      meta: {
        accountKeys: [],
        start: start.toISOString(),
        end: end.toISOString(),
        engagedWindowDays,
        role,
      },
      kpis: null,
      timeline: [],
      engagedContacts: { windowDays: engagedWindowDays, engagedTotal: 0, engagedByAccount: [] },
      lifecycle: null,
      pipeline: { scheduled: [], inFlight: [], recentlyFailed: [] },
      accountHealth: [],
      anomalies: [],
      topCampaigns: [],
      activity: [],
      repPerformance: [],
      suppression: null,
      metaPacer: [],
    });
  }

  const scope = { accountKeys, start, end };

  // Run every section in parallel. Settle individually so one bad
  // query doesn't take down the whole dashboard payload.
  const sections = await Promise.allSettled([
    getPortfolioKpis(scope),
    getEngagementTimeline(scope),
    getEngagedContacts({ accountKeys }, engagedWindowDays),
    getLifecycleAlerts({ accountKeys }),
    getSendPipeline({ accountKeys }),
    getAccountHealth(scope),
    getAnomalies({ accountKeys }),
    getTopCampaigns(scope, 5),
    getRecentActivity({ accountKeys }, 25),
    role === 'super_admin' || role === 'developer' ? getRepPerformance(scope) : Promise.resolve([]),
    getSuppressionHealth(scope),
    getMetaPacerSummary({ accountKeys }),
  ]);

  const errors: Record<string, string> = {};
  function valueOrNull<T>(result: PromiseSettledResult<T>, key: string, fallback: T): T {
    if (result.status === 'fulfilled') return result.value;
    errors[key] = result.reason instanceof Error ? result.reason.message : String(result.reason);
    return fallback;
  }

  const payload = {
    meta: {
      accountKeys,
      start: start.toISOString(),
      end: end.toISOString(),
      engagedWindowDays,
      role,
    },
    kpis: valueOrNull(sections[0], 'kpis', null as never),
    timeline: valueOrNull(sections[1], 'timeline', []),
    engagedContacts: valueOrNull(sections[2], 'engagedContacts', {
      windowDays: engagedWindowDays,
      engagedTotal: 0,
      engagedByAccount: [],
    }),
    lifecycle: valueOrNull(sections[3], 'lifecycle', null as never),
    pipeline: valueOrNull(sections[4], 'pipeline', { scheduled: [], inFlight: [], recentlyFailed: [] }),
    accountHealth: valueOrNull(sections[5], 'accountHealth', []),
    anomalies: valueOrNull(sections[6], 'anomalies', []),
    topCampaigns: valueOrNull(sections[7], 'topCampaigns', []),
    activity: valueOrNull(sections[8], 'activity', []),
    repPerformance: valueOrNull(sections[9], 'repPerformance', []),
    suppression: valueOrNull(sections[10], 'suppression', null as never),
    metaPacer: valueOrNull(sections[11], 'metaPacer', []),
    errors,
  };

  return NextResponse.json(payload);
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clampWindow(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 90;
  return Math.min(365, Math.max(7, Math.round(parsed)));
}
