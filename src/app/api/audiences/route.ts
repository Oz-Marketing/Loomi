import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import * as audienceService from '@/lib/services/audiences';
import { resolveFilterFields } from '@/lib/services/audience-fields';
import {
  formatFilterErrors,
  parseAndValidateFilterDefinition,
} from '@/lib/smart-list-validate';

/**
 * GET /api/audiences
 * List audiences accessible to the current user.
 */
export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;

  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];

  const audiences =
    userRole === 'developer'
      ? await audienceService.getAudiences()
      : await audienceService.getAudiences(userAccountKeys);

  return NextResponse.json({ audiences });
}

/**
 * POST /api/audiences
 * Create a new audience.
 */
export async function POST(req: Request) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await req.json();
  const { name, description, accountKey, filters, icon, color } = body;

  if (!name || !filters) {
    return NextResponse.json({ error: 'name and filters are required' }, { status: 400 });
  }

  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  const isPrivileged = userRole === 'developer' || userRole === 'super_admin';
  const scopedAccountKey: string | null =
    typeof accountKey === 'string' && accountKey.trim() ? accountKey.trim() : null;

  // Scope check. An audience with no accountKey is ORG-WIDE: getAudiences()
  // hands it to every user, and only developers/super_admins can edit or
  // delete it (see [id]/route.ts assertWriteAccess). Creation used to skip
  // this check entirely whenever accountKey was absent, so any authenticated
  // user could mint a segment visible everywhere that they then couldn't
  // remove. Org-wide creation is now privileged, and everyone else must name
  // an account they're actually assigned to.
  if (!scopedAccountKey) {
    if (!isPrivileged) {
      return NextResponse.json(
        { error: 'Only developers and super admins can create org-wide segments' },
        { status: 403 },
      );
    }
  } else if (!isPrivileged && !userAccountKeys.includes(scopedAccountKey)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Validate the filter definition against the same field catalogue the
  // builder offered, so an unknown field, a mistyped operator, or a
  // valueless condition is a 400 here rather than a segment that quietly
  // matches nobody at send time.
  const fields = await resolveFilterFields(scopedAccountKey);
  const validation = parseAndValidateFilterDefinition(filters, fields);
  if (!validation.ok) {
    return NextResponse.json(
      { error: `Invalid filter definition — ${formatFilterErrors(validation.errors)}`, details: validation.errors },
      { status: 400 },
    );
  }

  const audience = await audienceService.createAudience({
    name,
    description,
    accountKey: scopedAccountKey,
    createdByUserId: session!.user.id,
    filters,
    icon,
    color,
  });

  return NextResponse.json({ audience }, { status: 201 });
}
