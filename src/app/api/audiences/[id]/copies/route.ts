import { NextResponse } from 'next/server';
import { withRouteErrors } from '@/lib/api-errors';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import * as audienceService from '@/lib/services/audiences';
import { resolveFilterFields } from '@/lib/services/audience-fields';
import { canWriteSegment } from '@/lib/segments/visibility';
import { copyMatchesSource, findPushNameClashes, planPush } from '@/lib/segments/copies';
import {
  formatFilterErrors,
  parseAndValidateFilterDefinition,
} from '@/lib/smart-list-validate';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/audiences/:id/copies
 *
 * The copy links around one segment, for the editor:
 *  - `copies`: when this is an original, its linked copies — listed only to
 *    someone who may edit the original, since that is who can push to them.
 *  - `source`: when this is a copy, the original it came from — named only
 *    if the viewer is assigned to the original's account.
 */
async function handleGet(_req: Request, { params }: RouteContext) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const segment = await audienceService.getAudienceById(id);
  if (!segment) return NextResponse.json({ error: 'Segment not found' }, { status: 404 });

  const user = { role: session!.user.role, accountKeys: session!.user.accountKeys ?? [] };
  const isPrivileged = user.role === 'developer' || user.role === 'super_admin';
  const canEditThis = canWriteSegment(segment, user) === null;

  const copies = canEditThis
    ? (await audienceService.getAudienceCopies(id)).map((copy) => ({
        id: copy.id,
        accountKey: copy.accountKey,
        upToDate: copyMatchesSource(segment, copy),
        canPush:
          isPrivileged || (copy.accountKey !== null && user.accountKeys.includes(copy.accountKey)),
      }))
    : [];

  let source: { id: string; name: string; accountKey: string | null } | null = null;
  let hasHiddenSource = false;
  if (segment.sourceAudienceId) {
    const original = await audienceService.getAudienceById(segment.sourceAudienceId);
    if (original) {
      const readable =
        isPrivileged ||
        original.accountKey === null ||
        user.accountKeys.includes(original.accountKey);
      if (readable) source = { id: original.id, name: original.name, accountKey: original.accountKey };
      else hasHiddenSource = true;
    }
  }

  return NextResponse.json({ copies, source, hasHiddenSource });
}

/**
 * POST /api/audiences/:id/copies — push this segment's SAVED name,
 * description, filter, icon and color to its linked copies.
 *
 * Body: `{ copyIds?: string[] }`; omitted means every linked copy.
 *
 * All-or-nothing, like the fan-out that made the copies: every check runs
 * before any write, and a refusal names the accounts responsible. A push
 * that landed in some accounts and not others would leave the user opening
 * each one to find out which.
 */
async function handlePost(req: Request, { params }: RouteContext) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const source = await audienceService.getAudienceById(id);
  if (!source) return NextResponse.json({ error: 'Segment not found' }, { status: 404 });

  const user = { role: session!.user.role, accountKeys: session!.user.accountKeys ?? [] };
  if (canWriteSegment(source, user) !== null) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const requestedIds = Array.isArray(body?.copyIds)
    ? (body.copyIds as unknown[]).filter((v): v is string => typeof v === 'string')
    : undefined;

  const { targets, unknown, denied } = planPush({
    copies: await audienceService.getAudienceCopies(id),
    requestedIds,
    writableKeys: user.accountKeys,
    isPrivileged: user.role === 'developer' || user.role === 'super_admin',
  });

  if (unknown.length > 0) {
    return NextResponse.json(
      { error: 'Some of those segments are not copies of this one.', unknown },
      { status: 400 },
    );
  }
  if (denied.length > 0) {
    const keys = denied.map((c) => c.accountKey ?? 'platform-wide');
    return NextResponse.json(
      { error: `Not authorized to change segments in: ${keys.join(', ')}`, denied: keys },
      { status: 403 },
    );
  }
  if (targets.length === 0) {
    return NextResponse.json({ error: 'This segment has no copies to push to.' }, { status: 400 });
  }

  // The field catalogue is per account, so a filter on a custom field (or a
  // reference to another segment) can be valid here and dangling in a copy's
  // account. Validated against each copy's OWN scope, excluding itself from
  // the segment-reference options exactly as its own PATCH would.
  const invalid: Array<{ accountKey: string | null; error: string }> = [];
  for (const copy of targets) {
    const fields = await resolveFilterFields(copy.accountKey, copy.id);
    const validation = parseAndValidateFilterDefinition(source.filters, fields);
    if (!validation.ok) {
      invalid.push({ accountKey: copy.accountKey, error: formatFilterErrors(validation.errors) });
    }
  }
  if (invalid.length > 0) {
    return NextResponse.json(
      {
        error: `This filter isn't valid in ${invalid.map((e) => e.accountKey).join(', ')} — ${invalid[0]!.error}`,
        details: invalid,
      },
      { status: 400 },
    );
  }

  // A rename is pushed too, and (name, accountKey) is unique.
  const targetKeys = targets.map((t) => t.accountKey).filter((k): k is string => k !== null);
  const sameName = await prisma.audience.findMany({
    where: { name: source.name, accountKey: { in: targetKeys } },
    select: { id: true, name: true, accountKey: true },
  });
  const clashes = findPushNameClashes(source.name, targets, sameName);
  if (clashes.length > 0) {
    const keys = clashes.map((c) => c.accountKey);
    return NextResponse.json(
      {
        error: `Another segment is already called "${source.name}" in: ${keys.join(', ')}. Rename one of them first.`,
        clashes: keys,
      },
      { status: 409 },
    );
  }

  await audienceService.pushAudienceToCopies(source, targets.map((t) => t.id));
  return NextResponse.json({ pushed: targets.map((t) => ({ id: t.id, accountKey: t.accountKey })) });
}

export const GET = withRouteErrors(handleGet, 'audience-copies');
export const POST = withRouteErrors(handlePost, 'audience-copies');
