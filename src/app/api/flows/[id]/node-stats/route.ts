import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { getFlow, getFlowNodeStats } from '@/lib/services/loomi-flows';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requirePermission(['studio.flows.view', 'reporting.report.view']);
  if (error) return error;

  const { id } = await context.params;
  const scope =
    session!.user.role === 'client' || session!.user.role === 'admin'
      ? (session!.user.accountKeys ?? [])
      : null;
  const existing = await getFlow(id, scope);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const byNode = await getFlowNodeStats(id);
  return NextResponse.json({ byNode });
}
