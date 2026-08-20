import { NextRequest, NextResponse } from 'next/server';
import { requireInternalJobAuth } from '@/lib/internal-jobs';
import { prisma } from '@/lib/prisma';

/**
 * The docs freshness endpoint, called by .github/workflows/docs-review.yml.
 *
 * GET  — the review stamps, so the drift job knows which commit each article was
 *        last confirmed against. These live here rather than in the repo because
 *        an article is confirmed against a deployed environment, and staging and
 *        production are legitimately at different commits.
 *
 * POST — flag the articles the job found stale, so staff see a "needs review"
 *        badge on the article itself.
 *
 * Both are guarded by `INTERNAL_JOB_SECRET`, the same shared secret the changelog
 * importer and the pacer alert cron use.
 */

/** GET /api/internal/docs/drift */
export async function GET(req: NextRequest) {
  const authError = requireInternalJobAuth(req);
  if (authError) return authError;

  const articles = await prisma.docArticle.findMany({
    select: { sourceKey: true, reviewedSha: true },
    where: { sourceKey: { not: null } },
  });

  return NextResponse.json({ articles });
}

/**
 * POST /api/internal/docs/drift
 *
 * Body: { headSha: string, flags: { sourceKey: string, note: string }[] }
 *
 * Sets the flag on everything named, and CLEARS it on everything else — the job
 * sends the complete current picture, so an article whose flag was raised by an
 * earlier run and has since been updated stops being flagged without anyone
 * having to dismiss it by hand.
 *
 * It deliberately does not stamp `reviewedSha`. Being told an article is stale is
 * not the same as reviewing it; moving the marker here would mean the next run
 * measured drift from the moment we noticed, and each individual change would
 * only ever be reported once, whether or not anybody acted on it.
 */
export async function POST(req: NextRequest) {
  const authError = requireInternalJobAuth(req);
  if (authError) return authError;

  let body: { headSha?: unknown; flags?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(body.flags)) {
    return NextResponse.json({ error: 'flags must be an array' }, { status: 400 });
  }

  const flags = body.flags
    .filter((f): f is { sourceKey: string; note: string } =>
      !!f && typeof (f as { sourceKey?: unknown }).sourceKey === 'string',
    )
    .map((f) => ({ sourceKey: f.sourceKey, note: typeof f.note === 'string' ? f.note : '' }));

  const flaggedKeys = flags.map((f) => f.sourceKey);

  let flagged = 0;
  for (const flag of flags) {
    const result = await prisma.docArticle.updateMany({
      where: { sourceKey: flag.sourceKey },
      data: { needsReview: true, reviewNote: flag.note || null },
    });
    flagged += result.count;
  }

  const cleared = await prisma.docArticle.updateMany({
    where: {
      needsReview: true,
      sourceKey: flaggedKeys.length > 0 ? { notIn: flaggedKeys } : { not: null },
    },
    data: { needsReview: false, reviewNote: null },
  });

  return NextResponse.json({ flagged, cleared: cleared.count });
}
