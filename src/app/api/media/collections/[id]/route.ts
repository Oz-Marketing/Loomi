import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { canAccessAsset } from '@/lib/services/media';
import {
  addToCollection,
  collectionAssets,
  removeFromCollection,
} from '@/lib/services/media-collections';

/** Load a collection and check the session may touch its scope. */
async function loadAndAuthorize(id: string, session: { user: { role: string; accountKeys?: string[] } }) {
  const collection = await prisma.mediaCollection.findUnique({ where: { id } });
  if (!collection) return { error: NextResponse.json({ error: 'Collection not found' }, { status: 404 }) };
  if (!canAccessAsset(session, collection.accountKey)) {
    return { error: NextResponse.json({ error: 'Access denied' }, { status: 403 }) };
  }
  return { collection };
}

/**
 * GET /api/media/collections/[id]
 *
 * The collection and its assets. A smart collection is resolved fresh here —
 * that read is the feature.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const auth = await loadAndAuthorize(id, session!);
  if ('error' in auth) return auth.error;

  const result = await collectionAssets(id);
  if (!result) return NextResponse.json({ error: 'Collection not found' }, { status: 404 });

  return NextResponse.json({
    collection: {
      id: result.collection.id,
      name: result.collection.name,
      description: result.collection.description,
      kind: result.collection.kind,
      accountKey: result.collection.accountKey,
    },
    files: result.assets,
  });
}

/**
 * PATCH /api/media/collections/[id]
 *
 * Body: { name?, description?, addAssetIds?, removeAssetIds? }
 *
 * Membership edits only apply to static collections: a smart one's contents are
 * defined by its query, and letting someone hand-add to it would produce a set
 * that silently disagrees with its own definition.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const auth = await loadAndAuthorize(id, session!);
  if ('error' in auth) return auth.error;
  const { collection } = auth;

  const body = await req.json().catch(() => ({}));
  const addIds: string[] = Array.isArray(body?.addAssetIds) ? body.addAssetIds.filter((v: unknown) => typeof v === 'string') : [];
  const removeIds: string[] = Array.isArray(body?.removeAssetIds) ? body.removeAssetIds.filter((v: unknown) => typeof v === 'string') : [];

  if ((addIds.length || removeIds.length) && collection.kind === 'smart') {
    return NextResponse.json(
      { error: 'A smart collection’s contents come from its search — edit the search instead.' },
      { status: 400 },
    );
  }

  const data: { name?: string; description?: string | null } = {};
  if (typeof body?.name === 'string' && body.name.trim()) data.name = body.name.trim();
  if (body?.description !== undefined) {
    data.description = typeof body.description === 'string' && body.description.trim()
      ? body.description.trim()
      : null;
  }
  if (Object.keys(data).length > 0) {
    await prisma.mediaCollection.update({ where: { id }, data });
  }

  const added = addIds.length ? (await addToCollection(id, addIds, session!.user.id)).added : 0;
  const removed = removeIds.length ? (await removeFromCollection(id, removeIds)).removed : 0;

  return NextResponse.json({ added, removed });
}

/**
 * DELETE /api/media/collections/[id]
 *
 * Removes the collection only. Membership rows cascade; the ASSETS are
 * untouched — a collection is a view over the library, not a container that
 * owns what's in it. That distinction is exactly what folders got wrong.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const auth = await loadAndAuthorize(id, session!);
  if ('error' in auth) return auth.error;

  await prisma.mediaCollection.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}
