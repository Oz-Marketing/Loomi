import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { canAccessAsset } from '@/lib/services/media';
import { listCollections, type MediaCollectionQuery } from '@/lib/services/media-collections';

/**
 * GET /api/media/collections?accountKey=…
 *
 * Collections for a scope. Omitting accountKey lists agency-level ones; passing
 * a key lists that account's PLUS the agency-level ones, because an
 * agency-curated set is meant to be usable from inside a rooftop.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const accountKey = req.nextUrl.searchParams.get('accountKey') || null;
  // Reuses the asset rule: agency-level is admin-only, an account needs a grant.
  if (!canAccessAsset(session!, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  return NextResponse.json({ collections: await listCollections(accountKey) });
}

/**
 * POST /api/media/collections
 *
 * Body: { name, description?, accountKey?, kind?: 'static' | 'smart', query? }
 *
 * A smart collection stores its QUERY, not its results — that's what makes it
 * keep up on its own instead of becoming another list to maintain.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => ({}));

  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const accountKey = typeof body?.accountKey === 'string' && body.accountKey ? body.accountKey : null;
  if (!canAccessAsset(session!, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const kind = body?.kind === 'smart' ? 'smart' : 'static';
  let query: MediaCollectionQuery | null = null;
  if (kind === 'smart') {
    if (!body?.query || typeof body.query !== 'object') {
      return NextResponse.json(
        { error: 'A smart collection needs a query — otherwise it would match everything.' },
        { status: 400 },
      );
    }
    query = body.query as MediaCollectionQuery;
  }

  const created = await prisma.mediaCollection.create({
    data: {
      accountKey,
      name,
      description: typeof body?.description === 'string' ? body.description.trim() || null : null,
      kind,
      query: query ? JSON.stringify(query) : null,
      createdBy: session!.user.id,
      createdByName: session!.user.name || session!.user.email || null,
    },
  });

  return NextResponse.json({ collection: { id: created.id, name: created.name } }, { status: 201 });
}
