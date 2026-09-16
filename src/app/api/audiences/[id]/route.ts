import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { getAncestorAccountKeysForAll } from '@/lib/services/accounts';
import * as audienceService from '@/lib/services/audiences';
import { canWriteSegment } from '@/lib/segments/visibility';
import { resolveFilterFields } from '@/lib/services/audience-fields';
import {
  formatFilterErrors,
  parseAndValidateFilterDefinition,
} from '@/lib/smart-list-validate';

type RouteContext = { params: Promise<{ id: string }> };

function assertWriteAccess(
  existing: { accountKey: string | null; sharedWithChildren?: boolean | null },
  userRole: string,
  userAccountKeys: string[],
): NextResponse | null {
  // One rule, shared with the list page and the read scope — see
  // lib/segments/visibility.ts. The messages differ per refusal because
  // "you can't edit this" and "this belongs to the group" send the user
  // to very different next actions.
  const refusal = canWriteSegment(existing, { role: userRole, accountKeys: userAccountKeys });
  if (!refusal) return null;
  if (refusal === 'inherited_read_only') {
    return NextResponse.json(
      {
        error:
          'This segment is shared from the group and is read-only here. Duplicate it to make a version you can edit.',
      },
      { status: 403 },
    );
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

  // Read-side visibility: org-wide is visible to all; account-scoped is
  // visible to users assigned to that account; a group's shared segment is
  // visible to users of the accounts beneath it.
  //
  // That last case is load-bearing for Duplicate — it opens the segment by
  // id to seed the copy, so without it the one action a rooftop is given
  // for an inherited segment 403s.
  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  const isPrivileged = userRole === 'developer' || userRole === 'super_admin';
  if (!isPrivileged && existing.accountKey && !userAccountKeys.includes(existing.accountKey)) {
    const ancestors = await getAncestorAccountKeysForAll(userAccountKeys);
    const inherited = existing.sharedWithChildren === true && ancestors.includes(existing.accountKey);
    if (!inherited) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
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
    // Validated against the segment's OWN account scope — an account-scoped
    // segment may reference that account's custom fields, an org-wide one
    // may not.
    const fields = await resolveFilterFields(existing.accountKey, id);
    const validation = parseAndValidateFilterDefinition(body.filters, fields);
    if (!validation.ok) {
      return NextResponse.json(
        {
          error: `Invalid filter definition — ${formatFilterErrors(validation.errors)}`,
          details: validation.errors,
        },
        { status: 400 },
      );
    }
    updates.filters = body.filters;
  }

  if ('sharedWithChildren' in body) {
    const share = body.sharedWithChildren;
    if (typeof share !== 'boolean') {
      return NextResponse.json(
        { error: 'sharedWithChildren must be a boolean' },
        { status: 400 },
      );
    }
    // Sharing DOWN needs something below to share with. A platform-wide
    // segment already reaches everyone, and a leaf account has no
    // children — in both cases the flag would be a switch that does
    // nothing, which is worse than a refusal.
    if (share) {
      if (!existing.accountKey) {
        return NextResponse.json(
          { error: 'A platform-wide segment is already visible to every account.' },
          { status: 400 },
        );
      }
      const childCount = await prisma.account.count({
        where: { parentAccountKey: existing.accountKey },
      });
      if (childCount === 0) {
        return NextResponse.json(
          { error: 'Only a group account can share a segment with the accounts beneath it.' },
          { status: 400 },
        );
      }
    }
    updates.sharedWithChildren = share;
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
