import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import { hasPermission, subjectFromSession } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';
import { REPORTS, resolveClientReports } from '@/lib/permissions/reports';

/**
 * GET /api/reporting/my-reports?accountKey= — which reports the CALLER may see
 * on that account.
 *
 * Exists for the nav. The sidebar is a client component with no session and no
 * database, so without this it would either render links that 403 on click —
 * the exact dead-end the allowlist is meant to prevent — or reimplement the
 * permission and allowlist rules in the browser, where they'd drift.
 *
 * Not a security boundary. Each report's own route runs the same check; this
 * just stops the nav from advertising doors that won't open.
 */
export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const subject = subjectFromSession(session);
  const accountKey = req.nextUrl.searchParams.get('accountKey');

  // Permission first — this is what actually decides, and it's what keeps
  // Budget and Executive out of a client's list however the allowlist is set.
  const permitted = REPORTS.filter((report) =>
    hasPermission(session, subject, report.permission, {
      accountKey: accountKey ?? undefined,
    }),
  );

  // Staff see everything their role allows; the allowlist describes what a
  // dealer is shown, not what an account manager may look at.
  if (subject.tier !== 'client' || !accountKey) {
    return NextResponse.json({ reports: permitted.map((r) => r.key) });
  }

  const rows = await prisma.accountReportAccess.findMany({
    where: { accountKey },
    select: { reportKey: true, enabled: true },
  });
  const allowed = resolveClientReports(rows);

  return NextResponse.json({
    reports: permitted.filter((r) => allowed.has(r.key)).map((r) => r.key),
  });
}
