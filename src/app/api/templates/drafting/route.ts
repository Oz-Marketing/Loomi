import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';
import { hasUnrestrictedAccountAccess } from '@/lib/roles';
import { parseV2Template } from '@/lib/email/types';
import { REQUEST_TYPES } from '@/lib/drafting/extraction';
import { templateSlotProblems } from '@/lib/drafting/template-slots';

/**
 * POST /api/templates/drafting — mark a template as the drafting template for
 * request types (docs/email-drafting.md §4.1). Body: { slug, requestTypes: string[] };
 * an empty list unmarks it.
 *
 * Marking is allowed even when the template's slots aren't right yet, so a
 * designer can mark first and finish the layout after; the problems come back
 * for the library to show, and the drafter falls back to the built-in layout
 * until they're fixed.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requirePermission('studio.templates.edit');
  if (error) return error;

  const body = (await req.json().catch(() => null)) as { slug?: unknown; requestTypes?: unknown } | null;
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
  if (!slug) return NextResponse.json({ error: 'Missing slug' }, { status: 400 });
  const asked = Array.isArray(body?.requestTypes) ? body.requestTypes : [];
  const requestTypes = REQUEST_TYPES.filter((t) => asked.includes(t));

  const existing = await prisma.template.findUnique({ where: { slug }, select: { accountKey: true, content: true, category: true } });
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  const user = session!.user;
  const accountKeys = user.accountKeys ?? [];
  if (existing.accountKey && !hasUnrestrictedAccountAccess(user.role, accountKeys) && !accountKeys.includes(existing.accountKey)) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  if (existing.category === 'drafted') {
    return NextResponse.json({ error: 'A drafted email can’t be a drafting template. Clone it first.' }, { status: 400 });
  }

  await prisma.template.update({
    where: { slug },
    data: {
      draftingFor: requestTypes.length ? JSON.stringify(requestTypes) : null,
      updatedAt: new Date(),
      updatedByUserId: user.id,
    },
  });
  const problems = requestTypes.length ? templateSlotProblems(parseV2Template(existing.content)) : [];
  return NextResponse.json({ success: true, slug, requestTypes, problems });
}
