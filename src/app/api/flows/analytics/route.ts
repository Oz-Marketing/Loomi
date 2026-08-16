import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { getFlowAnalytics, listFlows } from '@/lib/services/loomi-flows';

// Aggregate analytics across every flow in scope. Fans out per-flow
// `getFlowAnalytics()` calls so the page can render a sortable table
// of per-flow performance alongside top-level KPI tiles.
//
// Scoping mirrors the GET on /api/flows: a `?accountKey=...` param
// limits to one account; client / admin sessions get auto-filtered
// to their assigned account keys; developer / super_admin see
// everything.
//
// Optional `?start=&end=` (YYYY-MM-DD) windows the figures. What the window
// applies to differs per measure — sends by when they ran, enrollment outcomes
// by cohort, and `active` not at all. The reasoning is in getFlowAnalytics.
// Omitting both keeps the previous lifetime behaviour, which is what the
// Studio analytics page still asks for.

export async function GET(req: NextRequest) {
  const { session, error } = await requirePermission(['studio.flows.view', 'reporting.report.view']);
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const accountKeyParam = sp.get('accountKey');

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const startParam = sp.get('start');
  const endParam = sp.get('end');
  if ((startParam && !ISO_DATE.test(startParam)) || (endParam && !ISO_DATE.test(endParam))) {
    return NextResponse.json({ error: 'start / end must be YYYY-MM-DD' }, { status: 400 });
  }
  const range =
    startParam || endParam
      ? {
          start: startParam ? new Date(`${startParam}T00:00:00Z`) : null,
          end: endParam ? new Date(`${endParam}T23:59:59.999Z`) : null,
        }
      : undefined;
  const scoped =
    session!.user.role === 'client' || session!.user.role === 'admin'
      ? (session!.user.accountKeys ?? [])
      : undefined;
  const accountKeys = accountKeyParam ? [accountKeyParam] : scoped;

  if (scoped && accountKeyParam && !scoped.includes(accountKeyParam)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // We always include archived flows here so the analytics page can
  // show historical performance for paused / archived series.
  const flows = await listFlows({
    accountKeys: accountKeys ?? null,
    includeArchived: true,
  });

  // Fan-out — each per-flow analytics call is independent so we run
  // them in parallel. The shape returned per flow:
  //   { active, completed, exited, failed, totalSends, totalOpens, totalClicks }
  const perFlow = await Promise.all(
    flows.map(async (flow) => {
      const a = await getFlowAnalytics(flow.id, range);
      return {
        id: flow.id,
        name: flow.name,
        status: flow.status,
        accountKey: flow.accountKey,
        publishedAt: flow.publishedAt,
        archivedAt: flow.archivedAt,
        createdAt: flow.createdAt,
        updatedAt: flow.updatedAt,
        nodeCount: flow.nodeCount,
        active: a.active,
        entered: a.entered,
        completed: a.completed,
        exited: a.exited,
        failed: a.failed,
        totalSends: a.totalSends,
        totalOpens: a.totalOpens,
        totalClicks: a.totalClicks,
      };
    }),
  );

  return NextResponse.json({ flows: perFlow, windowed: Boolean(range) });
}
