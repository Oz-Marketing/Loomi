import { NextRequest, NextResponse } from 'next/server';
import { canAccessAccount, forbidden, getAccountScope } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import { recordAudit } from '@/lib/permissions/audit';
import { prisma } from '@/lib/prisma';
import {
  CLIENT_ELIGIBLE_REPORTS,
  isClientEligible,
  resolveClientReports,
  type ReportKey,
} from '@/lib/permissions/reports';
import { resolveReportSources } from '@/lib/permissions/report-sources';

/**
 * Which reports this sub-account's CLIENT users are shown.
 *
 * A narrowing tool, not a security boundary: `reporting.report.view` already
 * decides whether a role sees reports at all, and Budget / Executive are gated
 * by their own permissions and can never appear here. This only trims the
 * client-eligible set down to what a given dealer actually buys, so a store
 * running Meta ads and nothing else isn't handed an empty Call Tracking report.
 *
 * Staff are unaffected — an account manager still sees everything their role
 * allows, whatever this says.
 */

interface RouteParams {
  params: Promise<{ key: string }>;
}

/** `reporting.configure` — the same permission that guards report settings. */
const MANAGE = 'reporting.configure' as const;

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requirePermission(MANAGE);
  if (error) return error;

  const { key } = await params;
  if (!canAccessAccount(getAccountScope(session!), key)) return forbidden();

  const [rows, sources] = await Promise.all([
    prisma.accountReportAccess.findMany({
      where: { accountKey: key },
      select: { reportKey: true, enabled: true },
    }),
    // Whether each report has anything behind it for this account. Switching a
    // report on whose integration was never linked just gives the dealer an
    // empty page, so the screen says so before you save.
    resolveReportSources(key),
  ]);
  const effective = resolveClientReports(rows);

  // Return the whole eligible list with each report's resolved state, rather
  // than just the stored rows. The UI needs to render every toggle, and the
  // difference between "explicitly off" and "defaulted off" is not something it
  // should have to recompute.
  return NextResponse.json({
    reports: CLIENT_ELIGIBLE_REPORTS.map((report) => ({
      key: report.key,
      label: report.label,
      group: report.group,
      blurb: report.blurb,
      enabled: effective.has(report.key),
      isDefault: !rows.some((r) => r.reportKey === report.key),
      defaultForClients: report.defaultForClients,
      source: sources[report.key],
    })),
  });
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { session, error } = await requirePermission(MANAGE);
  if (error) return error;

  const { key } = await params;
  if (!canAccessAccount(getAccountScope(session!), key)) return forbidden();

  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body?.enabled)) {
    return NextResponse.json({ error: 'enabled[] is required' }, { status: 400 });
  }

  const wanted = new Set<ReportKey>();
  for (const raw of body.enabled as unknown[]) {
    const reportKey = String(raw) as ReportKey;
    // Reject rather than ignore. Silently dropping `budget` here would leave
    // the caller believing they had switched it on for clients.
    if (!isClientEligible(reportKey)) {
      return NextResponse.json(
        { error: `${reportKey} is not a client-eligible report` },
        { status: 400 },
      );
    }
    wanted.add(reportKey);
  }

  const before = await prisma.accountReportAccess.findMany({
    where: { accountKey: key },
    select: { reportKey: true, enabled: true },
  });
  const wasEnabled = resolveClientReports(before);

  // Write an explicit row for every eligible report, including the ones left at
  // their default. Storing only the differences would mean a later change to
  // `defaultForClients` silently re-enabled a report a dealer had switched off.
  await prisma.$transaction(
    CLIENT_ELIGIBLE_REPORTS.map((report) =>
      prisma.accountReportAccess.upsert({
        where: {
          accountKey_reportKey: { accountKey: key, reportKey: report.key },
        },
        create: {
          accountKey: key,
          reportKey: report.key,
          enabled: wanted.has(report.key),
          updatedById: session!.user.id,
        },
        update: {
          enabled: wanted.has(report.key),
          updatedById: session!.user.id,
        },
      }),
    ),
  );

  // Audit only what actually changed — a save that flips one toggle shouldn't
  // write twenty rows saying nothing happened.
  const actor = { id: session!.user.id, email: session!.user.email };
  for (const report of CLIENT_ELIGIBLE_REPORTS) {
    const now = wanted.has(report.key);
    if (now === wasEnabled.has(report.key)) continue;
    void recordAudit({
      kind: now ? 'grant' : 'revoke',
      actor,
      permission: `report:${report.key}`,
      scopeKey: key,
      detail: `${now ? 'Enabled' : 'Disabled'} the ${report.label} report for client users`,
    });
  }

  return NextResponse.json({ enabled: [...wanted] });
}
