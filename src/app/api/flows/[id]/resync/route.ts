import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import {
  getFlow,
  syncAllOutOfDateInstances,
  syncFlowFromTemplate,
} from '@/lib/services/loomi-flows';

// POST /api/flows/[id]/resync — admin/developer/super_admin only.
//
// Two modes:
//   - When [id] is a template flow: re-syncs every out-of-date
//     instance. Returns { flows, failures } in DeployResult shape.
//   - When [id] is a deployed instance: re-syncs that one instance
//     from its parent template. Returns { flow }.
//
// Either way the call no-ops on a flow that has no parent (and isn't a
// template with instances), returning a clear 400.
export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await context.params;

  const scope =
    session!.user.role === 'admin'
      ? (session!.user.accountKeys ?? [])
      : null;
  const existing = await getFlow(id, scope);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Templates have accountKey === '' (empty string per the service
  // serializer). Drive mode off that.
  const isTemplate = !existing.accountKey;

  if (isTemplate) {
    try {
      const result = await syncAllOutOfDateInstances(id);
      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Sync failed' },
        { status: 400 },
      );
    }
  }

  // Instance path. Confirm there's a parent template; otherwise the
  // service throws and we surface it cleanly.
  if (!existing.parentTemplate) {
    return NextResponse.json(
      { error: 'This flow has no parent template — nothing to sync from.' },
      { status: 400 },
    );
  }
  try {
    const flow = await syncFlowFromTemplate(id);
    return NextResponse.json({ flow });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 400 },
    );
  }
}
