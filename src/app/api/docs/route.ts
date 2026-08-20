import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { docReaderFromSession, docVisibilityWhere } from '@/lib/docs/reader';

/**
 * GET /api/docs            — the whole library
 * GET /api/docs?q=<terms>  — only articles whose BODY also matches
 *
 * The unfiltered call returns every article the reader may see, minus the
 * bodies: enough to render the index, the rails, and instant title search
 * without a round trip per keystroke.
 *
 * `q` exists because the bodies are the half the client cannot search. Somebody
 * looking for the quiet-hours rule types "quiet hours", and that phrase appears
 * in one article's body and no article's title. Every term must appear
 * somewhere in the article, matching how the client-side ranking treats them.
 *
 * Every authenticated user may read; WHAT they read is narrowed by
 * `docVisibilityWhere`. Clients get published `everyone` articles in the sectors
 * they can enter; staff get everything, drafts included.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const query = (req.nextUrl.searchParams.get('q') ?? '').trim();
  // Cap the term count so a pasted paragraph can't turn into a hundred-clause
  // query. Six terms is far past the point where anything still matches.
  const terms = query ? query.toLowerCase().split(/\s+/).slice(0, 6) : [];

  try {
    const reader = docReaderFromSession(session!);
    const articles = await prisma.docArticle.findMany({
      where: {
        ...docVisibilityWhere(reader),
        ...(terms.length > 0
          ? {
              AND: terms.map((term) => ({
                OR: [
                  { title: { contains: term, mode: 'insensitive' as const } },
                  { summary: { contains: term, mode: 'insensitive' as const } },
                  { category: { contains: term, mode: 'insensitive' as const } },
                  { body: { contains: term, mode: 'insensitive' as const } },
                ],
              })),
            }
          : {}),
      },
      select: {
        id: true,
        slug: true,
        title: true,
        summary: true,
        sector: true,
        category: true,
        audience: true,
        status: true,
        order: true,
        covers: true,
        needsReview: true,
        reviewNote: true,
        reviewedAt: true,
        sourceKey: true,
        editedInApp: true,
        updatedBy: true,
        updatedAt: true,
      },
      orderBy: [{ sector: 'asc' }, { order: 'asc' }, { title: 'asc' }],
    });

    return NextResponse.json({ articles, isStaff: !reader.isClient });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load docs';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
