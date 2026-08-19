import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';
import { docReaderFromSession } from '@/lib/docs/reader';
import { canReadDoc, DOC_AUDIENCES, type DocAudience, type DocSector } from '@/lib/docs/types';

/**
 * GET /api/docs/[slug]
 *
 * One article, body included.
 *
 * The visibility check is re-run here rather than trusted from the index. The
 * list route filters in SQL; this one filters in code, against the same rule in
 * `canReadDoc`. A client who guesses a staff article's slug gets a 404, not the
 * article — and a 404 rather than a 403, because "that article exists and you
 * can't have it" is itself a small leak.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { slug } = await params;

  try {
    const article = await prisma.docArticle.findUnique({ where: { slug } });
    if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const reader = docReaderFromSession(session!);
    const visible = canReadDoc(
      {
        audience: article.audience as DocAudience,
        sector: article.sector as DocSector,
        status: article.status as 'draft' | 'published',
      },
      reader,
    );
    if (!visible) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ article, isStaff: !reader.isClient });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load the article';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/docs/[slug]
 *
 * Edit an article in place. Requires `agency.docs.manage`.
 *
 * Saving here latches `editedInApp`, which permanently stops `scripts/seed-docs.ts`
 * from overwriting this row from its markdown file. That is the trade the hybrid
 * model makes: you can fix a sentence without a deploy, and in exchange this
 * article stops tracking the repo. The UI says so before the first save.
 *
 * Body: { title?, summary?, body?, audience?, status?, category?, needsReview? }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { session, error } = await requirePermission('agency.docs.manage');
  if (error) return error;

  const { slug } = await params;

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const data: Record<string, unknown> = {};

  if (typeof payload.title === 'string') {
    if (!payload.title.trim()) {
      return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
    }
    data.title = payload.title.trim();
  }
  if (typeof payload.summary === 'string') data.summary = payload.summary.trim();
  if (typeof payload.body === 'string') data.body = payload.body;
  if (typeof payload.category === 'string' && payload.category.trim()) {
    data.category = payload.category.trim();
  }
  // An unrecognized audience is rejected rather than coerced. Coercing would
  // have to pick a direction, and either direction is wrong here: widening leaks
  // an internal article, narrowing silently hides one somebody just wrote.
  if (payload.audience !== undefined) {
    if (!DOC_AUDIENCES.includes(payload.audience as DocAudience)) {
      return NextResponse.json({ error: 'audience must be "everyone" or "staff"' }, { status: 400 });
    }
    data.audience = payload.audience;
  }
  if (payload.status !== undefined) {
    if (payload.status !== 'draft' && payload.status !== 'published') {
      return NextResponse.json({ error: 'status must be "draft" or "published"' }, { status: 400 });
    }
    data.status = payload.status;
  }

  if (Object.keys(data).length === 0 && payload.needsReview === undefined) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  // Clearing the flag is "I have looked at this and it is correct", so it stamps
  // the reviewer and the time along with it — otherwise the badge just goes away
  // and nobody can tell whether anyone actually checked.
  if (payload.needsReview === false) {
    data.needsReview = false;
    data.reviewNote = null;
    data.reviewedAt = new Date();
  }

  try {
    const updated = await prisma.docArticle.update({
      where: { slug },
      data: {
        ...data,
        editedInApp: true,
        updatedBy: session!.user.name || session!.user.email || 'Unknown',
      },
    });
    return NextResponse.json({ article: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save the article';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
