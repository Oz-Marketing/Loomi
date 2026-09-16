import { withRouteErrors } from '@/lib/api-errors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import * as audienceService from '@/lib/services/audiences';
import { prisma } from '@/lib/prisma';
import { resolveFilterFields } from '@/lib/services/audience-fields';
import {
  formatFilterErrors,
  parseAndValidateFilterDefinition,
} from '@/lib/smart-list-validate';
import { findNameClashes, partitionTargets } from '@/lib/segments/fan-out';
import { planSegmentAcrossAccounts, SegmentLookupError } from '@/lib/segments/lookup';

/**
 * GET /api/audiences
 * List audiences accessible to the current user.
 */
async function handleGet() {
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
async function handlePost(req: Request) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await req.json();
  const { name, description, accountKey, filters, icon, color } = body;
  const shareWithChildren = body.sharedWithChildren === true;

  if (!name || !filters) {
    return NextResponse.json({ error: 'name and filters are required' }, { status: 400 });
  }

  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  const isPrivileged = userRole === 'developer' || userRole === 'super_admin';
  const scopedAccountKey: string | null =
    typeof accountKey === 'string' && accountKey.trim() ? accountKey.trim() : null;

  // ── Fan-out: the same definition in several accounts ──
  //
  // For accounts with a group in common, sharing DOWN from the group is the
  // better tool and this is not it: one row, one edit, and the rooftops get
  // it automatically. This branch is for what that cannot reach — accounts
  // with no common parent, and the case where each account needs its own
  // editable segment rather than a read-only copy of the group's.
  //
  // Additive: `accountKeys` selects this path, and every existing caller
  // (saveAsSegment, the blast recipients screens, marketing lists) sends
  // `accountKey` or nothing and is unaffected.
  if (Array.isArray(body.accountKeys)) {
    return createAcrossAccounts({
      requested: body.accountKeys as unknown[],
      name,
      description,
      filters,
      icon,
      color,
      isPrivileged,
      userAccountKeys,
      userId: session!.user.id,
    });
  }

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

  // Sharing DOWN to the group's accounts. Needs a group to share FROM:
  // platform-wide already reaches everyone, and a leaf has nothing
  // beneath it, so in both cases the flag is a switch that does nothing.
  if (shareWithChildren) {
    if (!scopedAccountKey) {
      return NextResponse.json(
        { error: 'A platform-wide segment is already visible to every account.' },
        { status: 400 },
      );
    }
    const childCount = await prisma.account.count({
      where: { parentAccountKey: scopedAccountKey },
    });
    if (childCount === 0) {
      return NextResponse.json(
        { error: 'Only a group account can share a segment with the accounts beneath it.' },
        { status: 400 },
      );
    }
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
    sharedWithChildren: shareWithChildren,
    createdByUserId: session!.user.id,
    filters,
    icon,
    color,
  });

  return NextResponse.json({ audience }, { status: 201 });
}

/**
 * Create one segment per account, refusing the whole batch rather than
 * leaving a half-finished spread of rows behind.
 *
 * All three checks run BEFORE any write. A partial fan-out is the worst
 * outcome here: the user cannot tell which accounts took it without opening
 * each one, and re-running to catch the stragglers collides on the names
 * already created.
 */
async function createAcrossAccounts(input: {
  requested: unknown[];
  name: string;
  description?: string;
  filters: string;
  icon?: string;
  color?: string;
  isPrivileged: boolean;
  userAccountKeys: string[];
  userId?: string;
}) {
  const { allowed, denied } = partitionTargets({
    requested: input.requested.filter((k): k is string => typeof k === 'string'),
    writableKeys: input.userAccountKeys,
    isPrivileged: input.isPrivileged,
  });

  // 1. Scope. Same rule the single-account create applies, so this path can
  //    never reach an account the one-at-a-time path would refuse.
  if (denied.length > 0) {
    return NextResponse.json(
      { error: `Not authorized to create segments in: ${denied.join(', ')}`, denied },
      { status: 403 },
    );
  }
  if (allowed.length === 0) {
    return NextResponse.json({ error: 'Pick at least one account' }, { status: 400 });
  }

  // 2. Validation, per account. The field catalogue is per-account, so a
  //    filter on a custom field can be valid in one and reference nothing in
  //    the next. planSegmentAcrossAccounts already does exactly this walk for
  //    the read paths; it only THROWS when every account rejects, so check
  //    `errors` to refuse when any single one does — creating a segment that
  //    is dead on arrival in one of the accounts you picked is the silent
  //    failure this whole route is trying to avoid.
  let parsedDefinition;
  try {
    parsedDefinition = JSON.parse(input.filters);
  } catch {
    return NextResponse.json({ error: 'filters must be valid JSON' }, { status: 400 });
  }

  //    planSegmentAcrossAccounts THROWS when every account rejects and only
  //    RETURNS errors when some do, so both shapes have to be handled — a
  //    filter that is invalid everywhere is the commonest case of all (a
  //    typo'd field name) and reached the caller as an unparseable 500.
  let errors: Array<{ accountKey: string; error: string }>;
  try {
    ({ errors } = await planSegmentAcrossAccounts(parsedDefinition, allowed));
  } catch (err) {
    if (err instanceof SegmentLookupError) {
      return NextResponse.json({ error: `Invalid filter definition — ${err.message}` }, { status: 400 });
    }
    throw err;
  }
  if (errors.length > 0) {
    return NextResponse.json(
      {
        error: `This filter isn't valid in ${errors.map((e) => e.accountKey).join(', ')} — ${errors[0]!.error}`,
        details: errors,
      },
      { status: 400 },
    );
  }

  // 3. Name clashes. Audience is unique on (name, accountKey) and the create
  //    path does not catch P2002, so without this a collision arrives as a
  //    generic 500 that names no account.
  const existing = await prisma.audience.findMany({
    where: { name: input.name, accountKey: { in: allowed } },
    select: { name: true, accountKey: true },
  });
  const clashes = findNameClashes(input.name, allowed, existing);
  if (clashes.length > 0) {
    return NextResponse.json(
      {
        error: `Already used in: ${clashes.join(', ')}. Rename the segment or clear those accounts.`,
        clashes,
      },
      { status: 409 },
    );
  }

  const result = await audienceService.createAudienceAcrossAccounts({
    name: input.name,
    description: input.description,
    filters: input.filters,
    accountKeys: allowed,
    createdByUserId: input.userId,
    icon: input.icon,
    color: input.color,
  });

  return NextResponse.json(result, { status: 201 });
}

// Wrapped so an unhandled throw returns the JSON error envelope instead of
// a 500 with an empty body, which a caller cannot parse or report.
export const GET = withRouteErrors(handleGet, 'audiences');
export const POST = withRouteErrors(handlePost, 'audiences');
