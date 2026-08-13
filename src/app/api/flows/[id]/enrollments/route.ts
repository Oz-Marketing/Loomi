import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import {
  getFlow,
  listFlowEnrollments,
  type EnrollmentStatus,
} from '@/lib/services/loomi-flows';

const ENROLLMENT_STATUSES: EnrollmentStatus[] = [
  'active',
  'completed',
  'exited',
  'failed',
];

/**
 * GET /api/flows/[id]/enrollments
 *
 * Per-contact history for a flow: who enrolled, where they are in the
 * graph, what each step did for them, and what they did with the emails.
 * Powers the Enrollments tab on the flow overview.
 *
 * Query params: ?status= (one of active|completed|exited|failed)
 *               ?search= (contact name or email)
 *               ?limit= (1–200, default 50) &offset=
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin', 'client');
  if (error) return error;

  const { id } = await context.params;
  const scope =
    session!.user.role === 'client' || session!.user.role === 'admin'
      ? (session!.user.accountKeys ?? [])
      : null;
  const existing = await getFlow(id, scope);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const params = req.nextUrl.searchParams;
  const limitRaw = Number(params.get('limit') || '50');
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
  const offsetRaw = Number(params.get('offset') || '0');
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

  // Unknown status values are ignored rather than rejected — the tab
  // sends '' for "all", and a stale bookmark shouldn't 400.
  const statusParam = params.get('status') || '';
  const status = ENROLLMENT_STATUSES.includes(statusParam as EnrollmentStatus)
    ? (statusParam as EnrollmentStatus)
    : undefined;

  const page = await listFlowEnrollments(id, {
    status,
    search: params.get('search') || undefined,
    limit,
    offset,
  });

  return NextResponse.json({
    enrollments: page.rows,
    total: page.total,
    counts: page.counts,
    limit,
    offset,
  });
}
