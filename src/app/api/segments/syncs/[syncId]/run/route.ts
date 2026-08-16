// POST /api/segments/syncs/[syncId]/run
//
// Trigger one sync immediately. Runs inline rather than enqueuing:
// the caller wants the resulting numbers (added / removed / excluded)
// to show them, and a manual run is a deliberate, bounded action.
//
// The scheduled path goes through pg-boss instead — see the
// `loomi.audience-sync` queue in src/worker/index.ts.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';
import { runAudienceSync } from '@/lib/segments/sync/run';

type RouteContext = { params: Promise<{ syncId: string }> };

export async function POST(_req: Request, { params }: RouteContext) {
  const { session, error } = await requirePermission('studio.segments.edit');
  if (error) return error;

  const { syncId } = await params;
  const sync = await prisma.audienceSync.findUnique({
    where: { id: syncId },
    select: { id: true, accountKey: true, status: true },
  });
  if (!sync) {
    return NextResponse.json({ error: 'Sync not found' }, { status: 404 });
  }

  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  const isPrivileged = userRole === 'developer' || userRole === 'super_admin';
  if (!isPrivileged && !userAccountKeys.includes(sync.accountKey)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // A paused sync stays paused. Running it manually would push contacts
  // to a platform someone deliberately switched off.
  if (sync.status === 'paused') {
    return NextResponse.json(
      { error: 'This sync is paused. Activate it before running.' },
      { status: 409 },
    );
  }

  const result = await runAudienceSync(syncId);
  // The run itself records failures rather than throwing, so a failed
  // run is still a 200 carrying its own status — the caller wants the
  // reason, not an exception.
  return NextResponse.json({ result });
}
