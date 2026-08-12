import type { MediaAsset } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAccountOems, normalizeOems } from '@/lib/oems';
import { s3PublicUrl } from '@/lib/s3';
import { getAncestorAccountKeys } from '@/lib/services/accounts';
import {
  coerceList,
  isAssetCategory,
  isAssetSource,
  parseListColumn,
  serializeListColumn,
  serializeModelYears,
} from '@/lib/media-metadata';

/**
 * Media scope resolution — Phase 1 of docs/asset-management.md.
 *
 * An asset lives in exactly one of three scopes, and a sub-account sees the
 * union of all of them:
 *
 *   global   accountKey null, oem null   — Oz-wide, brand-agnostic
 *   OEM      accountKey null, oem set    — shared by every account carrying it
 *   account  accountKey set              — owned by one account (which, given the
 *                                          hierarchy, may be a group whose
 *                                          children inherit it)
 *
 * This is the same "author once, inherit down" rule templates already use
 * (`getEffectiveTemplatesForAccount`), widened with the OEM dimension. It is why
 * an Audi asset needed by six Audi rooftops is stored once rather than six times.
 */

/**
 * The API shape of an asset.
 *
 * One serializer for every route (list, upload, patch, duplicate, crop) because
 * the payload was previously hand-built in each of them and had already drifted —
 * `updatedAt` and `archivedAt` appeared in some responses and not others. Adding
 * seven metadata fields to five copies would guarantee more of the same.
 *
 * `source` here is the STORAGE origin ('s3'), which is what the media UI reads.
 * The DAM provenance field is `assetSource` — see the schema comment.
 */
export function serializeMediaAsset(a: MediaAsset) {
  return {
    id: a.id,
    name: a.filename,
    url: s3PublicUrl(a.s3Key),
    type: a.mimeType,
    size: a.size,
    width: a.width,
    height: a.height,
    thumbnailUrl: a.thumbnailKey ? s3PublicUrl(a.thumbnailKey) : undefined,
    altText: a.altText,
    category: a.category,
    folderId: a.folderId,
    accountKey: a.accountKey,
    archivedAt: a.archivedAt ? a.archivedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    source: 's3' as const,

    // ── DAM metadata ──
    oem: a.oem,
    assetSource: a.assetSource,
    assetCategory: a.assetCategory,
    modelYear: parseListColumn(a.modelYear),
    vehicleModel: parseListColumn(a.vehicleModel),
    tags: parseListColumn(a.tags),
    rightsHolder: a.rightsHolder,
    parentAssetId: a.parentAssetId,
    contentHash: a.contentHash,
  };
}

export type SerializedMediaAsset = ReturnType<typeof serializeMediaAsset>;

/**
 * The brands an account carries — `Account.oem` ∪ `Account.oems`, normalized.
 *
 * `Account.oems` is a JSON-encoded string[] in the database. Every other caller
 * of `getAccountOems` is client-side, where the API has already parsed it into a
 * real array — this is the first server-side reader, so it has to parse first.
 * Handing the raw column straight to `normalizeOems` yields the literal token
 * `["Honda"]` as if it were a marque, and a multi-brand dealer with `oems` set
 * but `oem` empty then matches no OEM assets at all.
 */
export async function getAccountBrands(accountKey: string): Promise<string[]> {
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { oem: true, oems: true },
  });
  if (!account) return [];
  return getAccountOems({ oem: account.oem, oems: coerceList(account.oems) });
}

/** The scopes that make up an account's effective media set. */
export interface MediaScope {
  /** The account's own key. */
  accountKey: string;
  /** Ancestor account keys, nearest first. */
  ancestorKeys: string[];
  /** Brands this account carries, normalized against lib/oems.ts. */
  brands: string[];
}

export async function resolveMediaScope(accountKey: string): Promise<MediaScope> {
  const [ancestors, brands] = await Promise.all([
    getAncestorAccountKeys(accountKey),
    getAccountBrands(accountKey),
  ]);
  return { accountKey, ancestorKeys: ancestors, brands };
}

/**
 * The `OR` clause selecting everything an account may see.
 *
 * Exported separately from the query below so callers that already build their
 * own `where` (search, archive state, pagination) can compose it rather than
 * receive a fixed result set.
 *
 * Note the two null-accountKey branches are NOT interchangeable: global assets
 * must carry a null `oem` or every brand-agnostic asset would leak into a brand
 * filter, and OEM assets must name a brand the account actually carries or a
 * Honda rooftop would see Audi's templates.
 */
export function effectiveMediaWhere(scope: MediaScope) {
  const branches: object[] = [
    // Global: Oz-wide, no brand.
    { accountKey: { equals: null }, oem: { equals: null } },
    // The account's own assets.
    { accountKey: scope.accountKey },
  ];

  if (scope.brands.length > 0) {
    branches.push({ accountKey: { equals: null }, oem: { in: scope.brands } });
  }

  if (scope.ancestorKeys.length > 0) {
    branches.push({ accountKey: { in: scope.ancestorKeys } });
  }

  return { OR: branches };
}

/**
 * Every asset an account may see, newest first.
 *
 * Deliberately FLAT — no folder filter. Folders belong to a single scope
 * (`MediaFolder.accountKey`), so there is no coherent folder tree spanning
 * inherited assets; folder navigation stays within the account's own scope and
 * this view is the "everything available to me" surface. Phase 2's facets are
 * what make a set this size navigable.
 */
export async function getEffectiveMediaForAccount(
  accountKey: string,
  opts: {
    category?: string;
    assetCategory?: string;
    oem?: string;
    search?: string;
    archived?: boolean;
    skip?: number;
    take?: number;
  } = {},
) {
  const scope = await resolveMediaScope(accountKey);

  const where = {
    AND: [
      effectiveMediaWhere(scope),
      {
        ...(opts.category ? { category: opts.category } : {}),
        ...(opts.assetCategory ? { assetCategory: opts.assetCategory } : {}),
        ...(opts.oem ? { oem: opts.oem } : {}),
        ...(opts.search ? { filename: { contains: opts.search } } : {}),
        archivedAt: opts.archived ? { not: null } : { equals: null },
      },
    ],
  };

  const [assets, total] = await Promise.all([
    prisma.mediaAsset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: opts.skip ?? 0,
      take: opts.take ?? 50,
    }),
    prisma.mediaAsset.count({ where }),
  ]);

  return { assets, total, scope };
}

// ── Metadata input ──

/** The DAM fields a client may set, before validation. */
export interface AssetMetadataInput {
  oem?: unknown;
  assetSource?: unknown;
  assetCategory?: unknown;
  modelYear?: unknown;
  vehicleModel?: unknown;
  rightsHolder?: unknown;
  tags?: unknown;
}

/** Storage-ready metadata. Every field nullable — null means "clear this". */
export interface AssetMetadataData {
  oem?: string | null;
  assetSource?: string | null;
  assetCategory?: string | null;
  modelYear?: string | null;
  vehicleModel?: string | null;
  rightsHolder?: string | null;
  tags?: string | null;
}

/**
 * Validate and normalize DAM metadata for storage.
 *
 * Shared by upload (FormData) and PATCH (JSON) so the two can't accept different
 * things. Only keys actually PRESENT on the input appear in the result, which is
 * what makes a sparse PATCH work: absent means "don't touch", explicit null or
 * empty string means "clear".
 *
 * Controlled-vocabulary fields are rejected rather than silently dropped. A
 * mistyped category that vanishes without complaint is how a taxonomy quietly
 * fills with holes.
 */
export function buildAssetMetadata(
  input: AssetMetadataInput,
): { data: AssetMetadataData } | { error: string } {
  const data: AssetMetadataData = {};

  if ('oem' in input) {
    const raw = input.oem;
    if (raw === null || raw === '') {
      data.oem = null;
    } else {
      // normalizeOems canonicalizes case ("audi" → "Audi") and passes unknown
      // brands through unchanged, so a marque Loomi hasn't listed yet still
      // stores rather than blocking the upload.
      const [normalized] = normalizeOems(raw);
      if (!normalized) return { error: 'oem must be a non-empty string' };
      data.oem = normalized;
    }
  }

  if ('assetSource' in input) {
    const raw = input.assetSource;
    if (raw === null || raw === '') {
      data.assetSource = null;
    } else if (!isAssetSource(raw)) {
      return { error: `Unknown asset source: ${String(raw)}` };
    } else {
      data.assetSource = raw;
    }
  }

  if ('assetCategory' in input) {
    const raw = input.assetCategory;
    if (raw === null || raw === '') {
      data.assetCategory = null;
    } else if (!isAssetCategory(raw)) {
      return { error: `Unknown asset category: ${String(raw)}` };
    } else {
      data.assetCategory = raw;
    }
  }

  if ('modelYear' in input) {
    data.modelYear = serializeModelYears(coerceList(input.modelYear));
  }

  if ('vehicleModel' in input) {
    data.vehicleModel = serializeListColumn(coerceList(input.vehicleModel));
  }

  if ('tags' in input) {
    data.tags = serializeListColumn(coerceList(input.tags));
  }

  if ('rightsHolder' in input) {
    const raw = input.rightsHolder;
    if (raw === null || raw === '') {
      data.rightsHolder = null;
    } else if (typeof raw !== 'string') {
      return { error: 'rightsHolder must be a string or null' };
    } else {
      data.rightsHolder = raw.trim() || null;
    }
  }

  return { data };
}

/**
 * An existing asset with the same bytes, within the scope being uploaded to.
 *
 * Scope-limited on purpose: the same file legitimately exists as an OEM master
 * AND as a rooftop's own copy, and warning about that would be noise. What is
 * worth catching is the same file uploaded twice into the same place — the
 * duplicate-upload case docs/asset-management.md §11 opens with.
 */
export async function findDuplicateAsset(
  contentHash: string,
  scope: { accountKey: string | null; oem: string | null },
) {
  return prisma.mediaAsset.findFirst({
    where: {
      contentHash,
      accountKey: scope.accountKey === null ? { equals: null } : scope.accountKey,
      oem: scope.oem === null ? { equals: null } : scope.oem,
      archivedAt: { equals: null },
    },
    orderBy: { createdAt: 'asc' },
  });
}
