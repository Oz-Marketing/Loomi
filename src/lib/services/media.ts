import type { MediaAsset } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAccountOems, normalizeOems } from '@/lib/oems';
import { s3PublicUrl } from '@/lib/s3';
import { getAncestorAccountKeys } from '@/lib/services/accounts';
import { assessRights, isLicenseType, isUsageScope } from '@/lib/media-rights';
import { parsePreflight } from '@/lib/media-preflight';
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
export function serializeMediaAsset(a: MediaAsset, now = new Date()) {
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

    // ── Rights (Phase 3) ──
    licenseType: a.licenseType,
    licenseRef: a.licenseRef,
    licenseStartsAt: a.licenseStartsAt ? a.licenseStartsAt.toISOString() : null,
    licenseExpiresAt: a.licenseExpiresAt ? a.licenseExpiresAt.toISOString() : null,
    usageScope: parseListColumn(a.usageScope),
    territoryScope: parseListColumn(a.territoryScope),
    exclusive: a.exclusive,
    talentReleaseOnFile: a.talentReleaseOnFile,
    derivativesPermitted: a.derivativesPermitted,
    sublicensingPermitted: a.sublicensingPermitted,
    expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
    expiredAt: a.expiredAt ? a.expiredAt.toISOString() : null,
    expirationReason: a.expirationReason,

    // Derived server-side so every consumer agrees on the answer, rather than
    // each one re-deriving "expiring soon" from raw dates and drifting.
    rights: assessRights(a, now),

    /** Set when Account settings owns this row's lifecycle, not the library. */
    managedBy: a.managedBy,
    managedRef: a.managedRef,

    // ── Approval (Phase 5) ──
    status: a.status,
    approvedAt: a.approvedAt ? a.approvedAt.toISOString() : null,
    approvedByName: a.approvedByName,
    reviewNote: a.reviewNote,
    preflight: parsePreflight(a.preflightResult),
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
  return brandsOfAccountRow(account);
}

/**
 * Brands from a raw Account ROW — `oem` ∪ `oems`, normalized.
 *
 * Exists because `Account.oems` is a JSON STRING in the database while
 * `getAccountOems` expects an already-parsed array: every pre-existing caller was
 * client-side, where the API had parsed it first. Calling it with a raw row
 * yields brand names like `["Honda"]` and `"Can-Am"` — literal JSON fragments.
 *
 * That bug was fixed once at a call site and then reintroduced verbatim by the
 * next server-side reader, which is the signal it belonged in one function rather
 * than in each caller's memory. Anything reading brands off a DB row uses this.
 */
export function brandsOfAccountRow(row: { oem: string | null; oems: string | null }): string[] {
  return getAccountOems({ oem: row.oem, oems: coerceList(row.oems) });
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
 * Free-text search across the fields a person actually remembers.
 *
 * Filename alone was never enough: an OEM asset is found by brand ("Audi"), by
 * what it is ("template"), or by a keyword someone tagged it with — almost never
 * by `audi_shared_my25-my26-dag_template-display_v1.zip`. Alt text is included
 * because it is the one field that describes the CONTENT of an image, and on a
 * well-maintained library it is the richest thing to match against.
 *
 * `tags` is a JSON string column, so `contains` matches its serialized form.
 * That is a substring match, not a term match — searching "sale" also hits a tag
 * "summer-sale", which for a search box is the desired behaviour rather than a
 * defect. Exact tag filtering is a facet (see the assetCategory/oem params), not
 * a search concern.
 */
export function mediaSearchWhere(search: string) {
  const q = search.trim();
  if (!q) return {};
  const contains = { contains: q, mode: 'insensitive' as const };
  return {
    OR: [
      { filename: contains },
      { altText: contains },
      { oem: contains },
      { rightsHolder: contains },
      { tags: contains },
    ],
  };
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
    assetSource?: string;
    status?: string;
    search?: string;
    archived?: boolean;
    skip?: number;
    take?: number;
  } = {},
) {
  const scope = await resolveMediaScope(accountKey);

  // Search is its own AND branch, not merged into the filter object: it is
  // itself an OR across five fields, and folding it in would let a search term
  // satisfy the scope clause instead of narrowing within it.
  const where = {
    AND: [
      effectiveMediaWhere(scope),
      ...(opts.search ? [mediaSearchWhere(opts.search)] : []),
      {
        ...(opts.category ? { category: opts.category } : {}),
        ...(opts.assetCategory ? { assetCategory: opts.assetCategory } : {}),
        ...(opts.oem ? { oem: opts.oem } : {}),
        ...(opts.assetSource ? { assetSource: opts.assetSource } : {}),
        ...(opts.status ? { status: opts.status } : {}),
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
  // ── Rights (Phase 3) ──
  licenseType?: unknown;
  licenseRef?: unknown;
  licenseStartsAt?: unknown;
  licenseExpiresAt?: unknown;
  usageScope?: unknown;
  territoryScope?: unknown;
  exclusive?: unknown;
  talentReleaseOnFile?: unknown;
  derivativesPermitted?: unknown;
  sublicensingPermitted?: unknown;
  expiresAt?: unknown;
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
  licenseType?: string | null;
  licenseRef?: string | null;
  licenseStartsAt?: Date | null;
  licenseExpiresAt?: Date | null;
  usageScope?: string | null;
  territoryScope?: string | null;
  exclusive?: boolean | null;
  talentReleaseOnFile?: boolean | null;
  derivativesPermitted?: boolean | null;
  sublicensingPermitted?: boolean | null;
  expiresAt?: Date | null;
  /**
   * Cleared whenever a governing date moves. A renewal has to re-arm the 30/7
   * warnings and un-expire the asset, or the sweep would treat a freshly
   * relicensed image as still dead.
   */
  expiredAt?: Date | null;
  expirationReason?: string | null;
  expirationWarnedAt?: Date | null;
}

/** Parse a client-supplied date. Returns undefined when the value is unusable. */
function parseDateInput(raw: unknown): Date | null | undefined {
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string' && !(raw instanceof Date)) return undefined;
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Tri-state boolean: null clears, absent leaves alone, anything else must be a bool. */
function parseBoolInput(raw: unknown): boolean | null | undefined {
  if (raw === null || raw === '') return null;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
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

  // ── Rights ──

  if ('licenseType' in input) {
    const raw = input.licenseType;
    if (raw === null || raw === '') data.licenseType = null;
    else if (!isLicenseType(raw)) return { error: `Unknown licence type: ${String(raw)}` };
    else data.licenseType = raw;
  }

  if ('licenseRef' in input) {
    const raw = input.licenseRef;
    if (raw === null || raw === '') data.licenseRef = null;
    else if (typeof raw !== 'string') return { error: 'licenseRef must be a string or null' };
    else data.licenseRef = raw.trim() || null;
  }

  if ('usageScope' in input) {
    const values = coerceList(input.usageScope);
    const bad = values.find((v) => !isUsageScope(v));
    if (bad) return { error: `Unknown usage scope: ${bad}` };
    data.usageScope = serializeListColumn(values);
  }

  // Territories are free-form: they're US states today but OEM DAT assignments
  // don't map cleanly onto a fixed list, and rejecting an unrecognised one would
  // block real data. Phase 4 syncs the vocabulary from the Data Hub.
  if ('territoryScope' in input) {
    data.territoryScope = serializeListColumn(coerceList(input.territoryScope));
  }

  for (const key of ['exclusive', 'talentReleaseOnFile', 'derivativesPermitted', 'sublicensingPermitted'] as const) {
    if (!(key in input)) continue;
    const parsed = parseBoolInput(input[key]);
    if (parsed === undefined) return { error: `${key} must be true, false or null` };
    data[key] = parsed;
  }

  // Date fields, and the re-arm rule. Moving either governing date invalidates
  // whatever the sweep concluded last time — the classic renewal bug is an asset
  // that stays flagged expired after its licence was extended.
  let datesMoved = false;
  for (const key of ['licenseStartsAt', 'licenseExpiresAt', 'expiresAt'] as const) {
    if (!(key in input)) continue;
    const parsed = parseDateInput(input[key]);
    if (parsed === undefined) return { error: `${key} must be a valid date or null` };
    data[key] = parsed;
    if (key !== 'licenseStartsAt') datesMoved = true;
  }
  if (datesMoved) {
    data.expiredAt = null;
    data.expirationReason = null;
    data.expirationWarnedAt = null;
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

// ── Access ──

/**
 * May this session act on an asset in the given scope?
 *
 * Was copy-pasted into three route files before this existed, and Phase 4 would
 * have made it four. An admin-level asset (null accountKey — global or
 * OEM-shared) is writable only by developers and unrestricted admins, because
 * one row is shared by every account that can see it.
 */
export function canAccessAsset(
  session: { user: { role: string; accountKeys?: string[] } },
  accountKey: string | null,
): boolean {
  const { role, accountKeys = [] } = session.user;
  if (role === 'developer' || role === 'super_admin') return true;
  if (role === 'admin' && accountKeys.length === 0) return true;
  if (accountKey === null) return false;
  return accountKeys.includes(accountKey);
}

/**
 * Does this session only get to see APPROVED assets?
 *
 * The consumer tier from §2.2, delivered through lifecycle state rather than a
 * separate portal surface: a client sees the library their agency has cleared
 * for them, and nothing that is still being worked on.
 *
 * Deliberately keyed on the role, not on a per-account flag. "Clients see
 * approved work" is a property of what a client IS, and making it configurable
 * would create accounts where it was quietly switched off.
 */
export function isConsumerRole(role: string): boolean {
  return role === 'client';
}

// ── Scope moves ──

/**
 * An asset's destination scope. Mirrors the three scopes in the header comment:
 * global (both null), OEM-shared (accountKey null + oem), account-owned.
 */
export interface ScopeTarget {
  accountKey: string | null;
  oem: string | null;
}

export interface ScopeMoveCheck {
  /** Null when the move is allowed; a message when it isn't. */
  error: string | null;
}

/** Unrestricted admins only — the tier that may write admin-level assets. */
export function isUnrestrictedAdmin(session: {
  user: { role: string; accountKeys?: string[] };
}): boolean {
  const { role, accountKeys = [] } = session.user;
  if (role === 'developer' || role === 'super_admin') return true;
  return role === 'admin' && accountKeys.length === 0;
}

/**
 * May this session move this asset to this scope?
 *
 * Pure, so the rules are testable without a database — and these are rules
 * worth testing: a scope move changes WHO CAN SEE an asset, which is the one
 * media operation with a blast radius beyond its own row.
 *
 * Admin-only overall. Promoting a rooftop's asset to an OEM library publishes it
 * to every other account carrying that brand, and that is not a decision a
 * single rooftop's user should be able to make for the others.
 */
export function checkScopeMove(
  session: { user: { role: string; accountKeys?: string[] } },
  asset: { accountKey: string | null; oem: string | null; managedBy: string | null },
  target: ScopeTarget,
): ScopeMoveCheck {
  if (!isUnrestrictedAdmin(session)) {
    return { error: 'Only agency admins can change an asset’s scope.' };
  }

  // Account settings owns logos and fonts; the library only catalogues them.
  // Moving one would desynchronise the two and the next sync would undo it.
  if (asset.managedBy) {
    return {
      error: 'Brand logos and fonts are managed in Account settings and can’t be moved here.',
    };
  }

  if (target.accountKey !== null && target.oem !== null) {
    // Not a real scope: `oem` on an account-owned asset is descriptive, and
    // allowing both here would imply a sharing that the resolution rule doesn't
    // actually provide.
    return { error: 'An asset belongs to one account or to a brand, not both.' };
  }

  const unchanged =
    (asset.accountKey ?? null) === target.accountKey && (asset.oem ?? null) === target.oem;
  if (unchanged) return { error: 'That is already this asset’s scope.' };

  return { error: null };
}

/** Human phrase for a scope, for confirmations and toasts. */
export function describeScope(target: ScopeTarget, dealerName?: string): string {
  if (target.accountKey) return dealerName || target.accountKey;
  if (target.oem) return `every ${target.oem} sub-account`;
  return 'the Loomi library (every account)';
}
