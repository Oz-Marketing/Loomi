import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import * as audienceService from '@/lib/services/audiences';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * DELETE /api/audiences/:id
 *
 * Remove a saved segment. Restricted-admin users can only delete
 * segments scoped to their assigned accounts; developers + super_admins
 * can delete any.
 */
export async function DELETE(_req: Request, { params }: RouteContext) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const existing = await audienceService.getAudienceById(id);
  if (!existing) {
    return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
  }

  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  const isPrivileged = userRole === 'developer' || userRole === 'super_admin';

  if (!isPrivileged) {
    if (!existing.accountKey) {
      // Cross-account segments are owned by the org; only developers
      // can delete them.
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (userRole === 'admin' && userAccountKeys.length > 0 && !userAccountKeys.includes(existing.accountKey)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (userRole === 'client' && !userAccountKeys.includes(existing.accountKey)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  await audienceService.deleteAudience(id);
  return NextResponse.json({ deleted: true });
}
