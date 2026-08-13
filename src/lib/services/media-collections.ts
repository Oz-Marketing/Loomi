import { prisma } from '@/lib/prisma';
import { mediaSearchWhere, serializeMediaAsset } from '@/lib/services/media';
import { MEDIA_FACET_KEYS, type MediaFacetKey } from '@/lib/media-facets';

/**
 * Collections — the replacement for folders.
 *
 * Folders could only say "an arbitrary pile someone made", and said it badly:
 * an asset lived in exactly one, so anything belonging to two contexts had to
 * pick. Collections fix both halves — membership is many-to-many, and a
 * collection can be a saved SEARCH rather than a hand-maintained list.
 *
 *   static  a curated list, in an order someone chose
 *   smart   a stored query, resolved fresh on every read
 *
 * The smart kind is why this exists at all. "All approved Audi display assets"
 * as a durable, shareable thing beats re-applying four filters every time, and
 * unlike a folder it can't go stale: new matching assets are simply in it.
 *
 * Server-only.
 */

/** The stored definition of a smart collection. */
export interface MediaCollectionQuery {
  /** Scope, mirroring the admin rail: null = any, else an account key. */
  accountKey?: string | null;
  /** Brand. `'none'` means brand-agnostic specifically. */
  oem?: string | null;
  /** Facet selection, same shape the rail produces. */
  facets?: Partial<Record<MediaFacetKey, string[]>>;
  /** Free text, matched the same way the library's search bar matches. */
  search?: string;
}

export function parseCollectionQuery(raw?: string | null): MediaCollectionQuery | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as MediaCollectionQuery) : null;
  } catch {
    return null;
  }
}

/**
 * Facet keys that map to a real column, and can therefore be pushed into SQL.
 *
 * The rest (`modelYear`, `rightsStatus`) are DERIVED — one from a JSON array
 * column, the other computed from dates at read time — so they can't be a where
 * clause and are filtered in memory after the fetch. Splitting them here rather
 * than silently ignoring the hard ones is what keeps a smart collection's result
 * honest.
 */
const COLUMN_FACETS: Partial<Record<MediaFacetKey, string>> = {
  oem: 'oem',
  assetCategory: 'assetCategory',
  assetSource: 'assetSource',
  status: 'status',
};

/** Build the Prisma `where` for a smart collection's query. */
export function smartCollectionWhere(query: MediaCollectionQuery) {
  const and: object[] = [{ archivedAt: { equals: null } }];

  if (query.search?.trim()) and.push(mediaSearchWhere(query.search.trim()));

  if (query.accountKey !== undefined) {
    and.push(
      query.accountKey === null
        ? { accountKey: { equals: null } }
        : { accountKey: query.accountKey },
    );
  }

  if (query.oem) {
    and.push(query.oem === 'none' ? { oem: { equals: null } } : { oem: query.oem });
  }

  for (const [key, column] of Object.entries(COLUMN_FACETS) as [MediaFacetKey, string][]) {
    const values = query.facets?.[key];
    if (values?.length) and.push({ [column]: { in: values } });
  }

  return { AND: and };
}

/** Facet keys a smart collection can't express in SQL — applied after the fetch. */
export function derivedFacetKeys(query: MediaCollectionQuery): MediaFacetKey[] {
  return MEDIA_FACET_KEYS.filter(
    (k) => !(k in COLUMN_FACETS) && (query.facets?.[k]?.length ?? 0) > 0,
  );
}

export interface CollectionSummary {
  id: string;
  accountKey: string | null;
  name: string;
  description: string | null;
  kind: string;
  query: MediaCollectionQuery | null;
  /** Members for static; matches for smart. */
  count: number;
  createdByName: string | null;
  updatedAt: string;
}

/**
 * Collections visible to a scope, with counts.
 *
 * `accountKey` null lists agency-level collections; a key lists that account's
 * PLUS the agency-level ones, because an agency-curated set is meant to be
 * usable from inside a rooftop.
 */
export async function listCollections(accountKey: string | null): Promise<CollectionSummary[]> {
  const rows = await prisma.mediaCollection
    .findMany({
      where:
        accountKey === null
          ? { accountKey: { equals: null } }
          : { OR: [{ accountKey }, { accountKey: { equals: null } }] },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { items: true } } },
    })
    .catch(() => []);

  const out: CollectionSummary[] = [];
  for (const row of rows) {
    const query = parseCollectionQuery(row.query);
    // A smart collection's count is a live count, not a stored one — the whole
    // point is that it moves on its own.
    let count = row._count.items;
    if (row.kind === 'smart' && query) {
      count = await prisma.mediaAsset.count({ where: smartCollectionWhere(query) }).catch(() => 0);
    }
    out.push({
      id: row.id,
      accountKey: row.accountKey,
      name: row.name,
      description: row.description,
      kind: row.kind,
      query,
      count,
      createdByName: row.createdByName,
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  return out;
}

/**
 * The assets in a collection.
 *
 * Static collections keep their manual order; smart ones come back newest-first,
 * since there is no author-chosen order to preserve.
 */
export async function collectionAssets(collectionId: string, take = 200) {
  const collection = await prisma.mediaCollection.findUnique({ where: { id: collectionId } });
  if (!collection) return null;

  if (collection.kind === 'smart') {
    const query = parseCollectionQuery(collection.query);
    if (!query) return { collection, assets: [] };

    const derived = derivedFacetKeys(query);
    const rows = await prisma.mediaAsset.findMany({
      where: smartCollectionWhere(query),
      orderBy: { createdAt: 'desc' },
      // Over-fetch when a derived facet will thin the result in memory, so the
      // page isn't short for a reason the caller can't see.
      take: derived.length > 0 ? take * 3 : take,
    });

    const serialized = rows.map((a) => serializeMediaAsset(a));
    if (derived.length === 0) return { collection, assets: serialized.slice(0, take) };

    const matches = serialized.filter((asset) =>
      derived.every((key) => {
        const wanted = query.facets?.[key] ?? [];
        if (key === 'modelYear') return asset.modelYear.some((y) => wanted.includes(y));
        if (key === 'rightsStatus') return wanted.includes(asset.rights.status);
        return true;
      }),
    );
    return { collection, assets: matches.slice(0, take) };
  }

  const items = await prisma.mediaCollectionItem.findMany({
    where: { collectionId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: { asset: true },
    take,
  });
  return { collection, assets: items.map((i) => serializeMediaAsset(i.asset)) };
}

/**
 * Add assets to a static collection.
 *
 * Idempotent by the unique index: adding something already there is a no-op
 * rather than an error, because "add these twelve" where three are already in
 * is a normal thing to do and shouldn't fail as a whole.
 */
export async function addToCollection(
  collectionId: string,
  assetIds: string[],
  userId?: string,
): Promise<{ added: number }> {
  if (assetIds.length === 0) return { added: 0 };

  const last = await prisma.mediaCollectionItem.findFirst({
    where: { collectionId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  let position = (last?.position ?? -1) + 1;

  let added = 0;
  for (const assetId of assetIds) {
    try {
      await prisma.mediaCollectionItem.create({
        data: { collectionId, assetId, position, addedBy: userId ?? null },
      });
      position += 1;
      added += 1;
    } catch {
      // Already a member, or the asset is gone. Neither is worth failing over.
    }
  }
  // Touch the collection so "recently updated" ordering means something.
  await prisma.mediaCollection.update({
    where: { id: collectionId },
    data: { updatedAt: new Date() },
  }).catch(() => {});
  return { added };
}

export async function removeFromCollection(
  collectionId: string,
  assetIds: string[],
): Promise<{ removed: number }> {
  if (assetIds.length === 0) return { removed: 0 };
  const r = await prisma.mediaCollectionItem.deleteMany({
    where: { collectionId, assetId: { in: assetIds } },
  });
  return { removed: r.count };
}
