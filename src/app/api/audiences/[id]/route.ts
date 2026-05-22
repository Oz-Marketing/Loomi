import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import * as audienceService from '@/lib/services/audiences';

type RouteContext = { params: Promise<{ id: string }> };

function assertWriteAccess(
  existing: { accountKey: string | null },
  userRole: string,
  userAccountKeys: string[],
): NextResponse | null {
  const isPrivileged = userRole === 'developer' || userRole === 'super_admin';
  if (isPrivileged) return null;

  if (!existing.accountKey) {
    // Org-wide segments are only editable by developers/super_admins.
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (userRole === 'admin' && userAccountKeys.length > 0 && !userAccountKeys.includes(existing.accountKey)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (userRole === 'client' && !userAccountKeys.includes(existing.accountKey)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

/**
 * GET /api/audiences/:id
 * Fetch a single saved segment. Used by the segment editor for edit mode.
 */
export async function GET(_req: Request, { params }: RouteContext) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const existing = await audienceService.getAudienceById(id);
  if (!existing) {
    return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
  }

  // Read-side visibility: org-wide segments are visible to all; account-scoped
  // segments are visible to users assigned to that account or to privileged roles.
  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  const isPrivileged = userRole === 'developer' || userRole === 'super_admin';
  if (!isPrivileged && existing.accountKey && !userAccountKeys.includes(existing.accountKey)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ audience: existing });
}

/**
 * PATCH /api/audiences/:id
 * Edit a saved segment. Same write rules as DELETE.
 */
export async function PATCH(req: Request, { params }: RouteContext) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const existing = await audienceService.getAudienceById(id);
  if (!existing) {
    return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
  }

  const forbidden = assertWriteAccess(
    existing,
    session!.user.role,
    session!.user.accountKeys ?? [],
  );
  if (forbidden) return forbidden;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }

  const updates: Parameters<typeof audienceService.updateAudience>[1] = {};

  if (typeof body.name === 'string') {
    const trimmed = body.name.trim();
    if (!trimmed) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    }
    updates.name = trimmed;
  }

  if ('description' in body) {
    const desc = body.description;
    if (desc === null || typeof desc === 'string') {
      updates.description = desc === null ? null : desc.trim() || null;
    }
  }

  if (typeof body.filters === 'string') {
    try {
      const parsed = JSON.parse(body.filters);
      if (parsed.version !== 1 || !Array.isArray(parsed.groups)) {
        return NextResponse.json({ error: 'Invalid filter definition' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'filters must be valid JSON' }, { status: 400 });
    }
    updates.filters = body.filters;
  }

  if ('color' in body) {
    updates.color = typeof body.color === 'string' ? body.color : null;
  }
  if ('icon' in body) {
    updates.icon = typeof body.icon === 'string' ? body.icon : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ audience: existing });
  }

  const audience = await audienceService.updateAudience(id, updates);
  return NextResponse.json({ audience });
}

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

  const forbidden = assertWriteAccess(
    existing,
    session!.user.role,
    session!.user.accountKeys ?? [],
  );
  if (forbidden) return forbidden;

  await audienceService.deleteAudience(id);
  return NextResponse.json({ deleted: true });
}
