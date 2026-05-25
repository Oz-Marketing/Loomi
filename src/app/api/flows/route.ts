import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import {
  createFlow,
  listFlows,
  type FlowStatusFilter,
} from '@/lib/services/loomi-flows';

const ALLOWED_STATUS_FILTERS = new Set<FlowStatusFilter>([
  'all',
  'draft',
  'published',
  'archived',
]);
function parseStatusFilter(value: string | null): FlowStatusFilter | undefined {
  if (!value) return undefined;
  return ALLOWED_STATUS_FILTERS.has(value as FlowStatusFilter)
    ? (value as FlowStatusFilter)
    : undefined;
}

function clientAccountKeysFromSession(session: {
  user: { role: string; accountKeys?: string[] };
}): string[] | undefined {
  if (session.user.role === 'client' || session.user.role === 'admin') {
    return session.user.accountKeys ?? [];
  }
  return undefined;
}

export async function GET(req: NextRequest) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin', 'client');
  if (error) return error;

  const accountKeyParam = req.nextUrl.searchParams.get('accountKey');
  // Preferred filter shape: ?status=all|draft|published|archived.
  // Legacy ?includeArchived=1 still understood for any caller that
  // hasn't migrated.
  const statusFilter = parseStatusFilter(req.nextUrl.searchParams.get('status'));
  const includeArchived = req.nextUrl.searchParams.get('includeArchived') === '1';
  // ?templates=1 bypasses accountKey scoping and returns only flows
  // with no accountKey (templates). Used by the sub-account "Add
  // Template" picker — templates are intentionally global and visible
  // to any authenticated user, since adopting one is opt-in.
  const templatesOnly = req.nextUrl.searchParams.get('templates') === '1';
  const scoped = clientAccountKeysFromSession(session!);

  if (templatesOnly) {
    // Templates are global. Skip accountKey scoping but keep the
    // status filter (sub-account picker defaults to status=published).
    const all = await listFlows({
      accountKeys: null,
      statusFilter,
      includeArchived,
    });
    const flows = all.filter((f) => !f.accountKey);
    return NextResponse.json({ flows });
  }

  const accountKeys = accountKeyParam ? [accountKeyParam] : scoped;

  // If role is account-scoped (client / admin with assignments) make
  // sure they can't request a flow outside their assigned scope by
  // intersecting the explicit accountKey param with their allowed set.
  if (scoped && accountKeyParam && !scoped.includes(accountKeyParam)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const flows = await listFlows({
    accountKeys: accountKeys ?? null,
    statusFilter,
    includeArchived,
  });
  return NextResponse.json({ flows });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const description = typeof body?.description === 'string' ? body.description : '';
  const accountKey = typeof body?.accountKey === 'string' ? body.accountKey.trim() : null;

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const scoped = clientAccountKeysFromSession(session!);
  if (accountKey && scoped && !scoped.includes(accountKey)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const flow = await createFlow({
    name,
    description,
    accountKey,
    createdByUserId: session!.user.id,
  });
  return NextResponse.json({ flow }, { status: 201 });
}
