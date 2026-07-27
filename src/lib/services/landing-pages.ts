import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  emptyLandingPageTemplate,
  isHtmlLandingPageTemplate,
  isV1LandingPageTemplate,
  parseLandingPageContent,
  type LandingPageContent,
} from '@/lib/landing-pages/types';
import { isValidSlug, slugify } from '@/lib/landing-pages/schemas';

export type LandingPageStatus = 'draft' | 'published';

export class LandingPageServiceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = 'LandingPageServiceError';
  }
}

export interface LandingPageSummary {
  id: string;
  /** '' for an account-less system/library template. */
  accountKey: string;
  /** Set for an org-owned template (account-less, inherited by sub-accounts). */
  organizationId: string | null;
  name: string;
  slug: string;
  status: LandingPageStatus;
  /** When true, this row is a reusable template, not a live page. */
  isTemplate: boolean;
  /** Shared template taxonomy (populated for template rows). */
  category: string | null;
  tags: string[];
  createdByUserId: string;
  /** Resolved author display info (template card). Null until resolved. */
  createdByName: string | null;
  createdByImage: string | null;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
  /** Parsed LandingPageTemplate — included on every list response so
   *  the card view can render a preview thumbnail without per-card
   *  refetching. Falls back to an empty template on parse failure. */
  schema: LandingPageContent;
  /** SEO + share preview metadata. Null when unset. */
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  /** When true, the public page renders `<meta robots="noindex">` and
   *  the LP is excluded from /lp-sitemap.xml. */
  noindex: boolean;
  /** Optional per-LP favicon URL; falls back to the studio default. */
  faviconUrl: string | null;
  /** Tracking / analytics injection. The curated fields render as
   *  the vendor's standard snippets on the public page; the custom
   *  HTML strings drop verbatim into <head> / pre-</body>. */
  metaPixelId: string | null;
  ga4MeasurementId: string | null;
  gtmContainerId: string | null;
  customHeadHtml: string | null;
  customBodyEndHtml: string | null;
}

export interface LandingPageDetail extends LandingPageSummary {
  /** Public share URL of the published landing page. Always populated
   *  (even for drafts — the URL is reserved on create). */
  publicUrl: string;
}

interface LandingPageRow {
  id: string;
  accountKey: string | null;
  organizationId?: string | null;
  name: string;
  slug: string;
  status: string;
  isTemplate: boolean;
  category: string | null;
  tags: string | null;
  schema: Prisma.JsonValue;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  noindex: boolean;
  faviconUrl: string | null;
  metaPixelId: string | null;
  ga4MeasurementId: string | null;
  gtmContainerId: string | null;
  customHeadHtml: string | null;
  customBodyEndHtml: string | null;
  createdByUserId: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function parseTagsJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/** Resolve author display info (name + avatar) for a set of summaries by user id. */
async function attachAuthors(summaries: LandingPageSummary[]): Promise<LandingPageSummary[]> {
  const ids = [...new Set(summaries.map((s) => s.createdByUserId).filter(Boolean))];
  if (ids.length === 0) return summaries;
  try {
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, avatarUrl: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    for (const s of summaries) {
      const u = s.createdByUserId ? byId.get(s.createdByUserId) : undefined;
      if (u) {
        s.createdByName = u.name ?? null;
        s.createdByImage = u.avatarUrl ?? null;
      }
    }
  } catch {
    /* best-effort */
  }
  return summaries;
}

function toSummary(row: LandingPageRow): LandingPageSummary {
  // parseLandingPageContent returns either a blocks-mode or html-mode
  // template; falls back to an empty blocks template so the table and
  // builder always get a valid shape to render.
  const parsed = parseLandingPageContent(row.schema) ?? emptyLandingPageTemplate();
  return {
    id: row.id,
    accountKey: row.accountKey ?? '',
    organizationId: row.organizationId ?? null,
    name: row.name,
    slug: row.slug,
    status: (row.status as LandingPageStatus) ?? 'draft',
    isTemplate: row.isTemplate,
    category: row.category ?? null,
    tags: parseTagsJson(row.tags),
    createdByUserId: row.createdByUserId ?? '',
    createdByName: null,
    createdByImage: null,
    publishedAt: row.publishedAt?.toISOString() ?? '',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    schema: parsed,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    ogImageUrl: row.ogImageUrl,
    noindex: row.noindex,
    faviconUrl: row.faviconUrl,
    metaPixelId: row.metaPixelId,
    ga4MeasurementId: row.ga4MeasurementId,
    gtmContainerId: row.gtmContainerId,
    customHeadHtml: row.customHeadHtml,
    customBodyEndHtml: row.customBodyEndHtml,
  };
}

function publicHost(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://studio.loomilm.com').replace(/\/+$/, '');
}

function toDetail(row: LandingPageRow): LandingPageDetail {
  const summary = toSummary(row);
  return {
    ...summary,
    publicUrl: `${publicHost()}/lp/${row.slug}`,
  };
}

async function ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
  // Same defensive uniqueness loop the Form service uses: try the base
  // slug, then -2, -3, … until a free one is found. Bounded retries so
  // we don't spin on a pathological case (account with thousands of
  // identically-named pages).
  let attempt = base;
  for (let i = 2; i < 200; i++) {
    const existing = await prisma.landingPage.findUnique({ where: { slug: attempt } });
    if (!existing || existing.id === excludeId) return attempt;
    attempt = `${base}-${i}`;
  }
  throw new LandingPageServiceError('Could not allocate a unique slug; pick a different name.', 409);
}

// ── List / read ────────────────────────────────────────────────────

export async function listLandingPages(
  accountKeys?: string[] | null,
): Promise<LandingPageSummary[]> {
  const rows = await prisma.landingPage.findMany({
    // Templates are excluded from the live LP list — they live in the
    // Templates → Landing Pages tab.
    where: {
      isTemplate: false,
      ...(accountKeys && accountKeys.length > 0 ? { accountKey: { in: accountKeys } } : {}),
    },
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map(toSummary);
}

/**
 * List LP TEMPLATES (isTemplate=true) for the /templates Landing Pages tab.
 * - accountKey set → only that account's own templates.
 * - includeAll (unrestricted admin at Admin level) → the WHOLE library: global
 *   + every subaccount's own (the tab filters by scope via the rail facet).
 * - otherwise → the system library only (accountKey null).
 */
export async function listLandingPageTemplates(
  accountKey?: string | null,
  includeAll = false,
  organizationId?: string | null,
): Promise<LandingPageSummary[]> {
  let where: Record<string, unknown>;
  if (organizationId) {
    // Org-authoring view: the templates this organization owns (and cascades
    // to its sub-accounts).
    where = { isTemplate: true, organizationId };
  } else if (accountKey) {
    // A sub-account's effective template set = its own templates + any
    // authored by its parent organization (author-once inheritance).
    const account = await prisma.account.findUnique({
      where: { key: accountKey },
      select: { organizationId: true },
    });
    const orgId = account?.organizationId ?? null;
    where = {
      isTemplate: true,
      OR: [{ accountKey }, ...(orgId ? [{ organizationId: orgId }] : [])],
    };
  } else if (includeAll) {
    where = { isTemplate: true };
  } else {
    // System library only: account-less AND org-less (org templates are
    // owned inheritance, not global library).
    where = { isTemplate: true, accountKey: null, organizationId: null };
  }
  const rows = await prisma.landingPage.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
  });
  return attachAuthors(rows.map(toSummary));
}

export async function getLandingPage(
  id: string,
  accountKeys?: string[] | null,
): Promise<LandingPageDetail | null> {
  const row = await prisma.landingPage.findUnique({ where: { id } });
  if (!row) return null;
  if (
    accountKeys &&
    accountKeys.length > 0 &&
    (row.accountKey == null || !accountKeys.includes(row.accountKey))
  ) {
    return null;
  }
  return toDetail(row);
}

export async function getPublishedLandingPageBySlug(slug: string): Promise<LandingPageDetail | null> {
  const row = await prisma.landingPage.findUnique({ where: { slug } });
  if (!row || row.status !== 'published' || row.isTemplate) return null;
  return toDetail(row);
}

/** Resolve a published LP scoped to a specific account. Used by the
 *  custom-domain code path: the hostname identifies the account, and
 *  the slug identifies the page within that account. Returns null
 *  when no published LP with that slug exists in the account, even
 *  if a same-slug LP exists in another account (slugs are globally
 *  unique today, but this guard is here so we stay safe if that
 *  changes). */
export async function getPublishedLandingPageByAccountAndSlug(
  accountKey: string,
  slug: string,
): Promise<LandingPageDetail | null> {
  const row = await prisma.landingPage.findFirst({
    where: { accountKey, slug, status: 'published', isTemplate: false },
  });
  if (!row) return null;
  return toDetail(row);
}

/** Fetch one published LP by id. Used by the custom-domain home
 *  resolver — the AccountDomain row stores the LP id, not a slug. */
export async function getPublishedLandingPageById(id: string): Promise<LandingPageDetail | null> {
  const row = await prisma.landingPage.findUnique({ where: { id } });
  if (!row || row.status !== 'published' || row.isTemplate) return null;
  return toDetail(row);
}

// ── Create / update / delete ───────────────────────────────────────

export interface CreateLandingPageInput {
  // Null only for a system/library template; live pages + sub-account
  // templates always carry an account.
  accountKey: string | null;
  name: string;
  slug?: string;
  schema?: LandingPageContent;
  createdByUserId?: string;
  /** When true, the new row is a reusable template, not a live page. */
  isTemplate?: boolean;
  /** Set only for an org-authored template (account-less, owned by the org
   *  so its sub-accounts inherit it). */
  organizationId?: string | null;
}

export async function createLandingPage(input: CreateLandingPageInput): Promise<LandingPageDetail> {
  if (!input.name?.trim()) throw new LandingPageServiceError('Name is required.');
  if (!input.accountKey && !input.isTemplate) {
    throw new LandingPageServiceError('accountKey is required.');
  }
  const baseSlug = slugify(input.slug || input.name);
  if (!isValidSlug(baseSlug)) {
    throw new LandingPageServiceError('Slug must be 2–80 lowercase letters, numbers, or hyphens.');
  }
  const slug = await ensureUniqueSlug(baseSlug);
  const schema = (input.schema ?? emptyLandingPageTemplate()) as unknown as Prisma.InputJsonValue;

  const row = await prisma.landingPage.create({
    data: {
      accountKey: input.accountKey,
      organizationId: input.organizationId ?? null,
      name: input.name.trim(),
      slug,
      schema,
      isTemplate: input.isTemplate ?? false,
      createdByUserId: input.createdByUserId,
    },
  });
  return toDetail(row);
}

/**
 * "Save as template" — clone a live LP's schema into a new LP TEMPLATE
 * (`isTemplate=true`), so it shows in the Templates → Landing Pages tab and is
 * editable in place by the LP builder.
 */
export async function saveLandingPageAsTemplate(input: {
  lpId: string;
  accountKeys: string[] | null;
  name: string;
  createdByUserId?: string;
}): Promise<LandingPageDetail> {
  const trimmed = input.name.trim();
  if (!trimmed) throw new LandingPageServiceError('Template name is required.');
  const src = await prisma.landingPage.findUnique({ where: { id: input.lpId } });
  if (!src) throw new LandingPageServiceError('Source landing page not found.', 404);
  if (
    input.accountKeys &&
    input.accountKeys.length > 0 &&
    (src.accountKey == null || !input.accountKeys.includes(src.accountKey))
  ) {
    throw new LandingPageServiceError('Source landing page not found.', 404);
  }
  const schema = JSON.parse(JSON.stringify(src.schema)) as LandingPageContent;
  return createLandingPage({
    accountKey: src.accountKey,
    name: trimmed,
    schema,
    isTemplate: true,
    createdByUserId: input.createdByUserId,
  });
}

export async function updateLandingPage(
  id: string,
  accountKeys: string[] | null,
  patch: {
    name?: unknown;
    slug?: unknown;
    status?: unknown;
    schema?: unknown;
    seoTitle?: unknown;
    seoDescription?: unknown;
    ogImageUrl?: unknown;
    noindex?: unknown;
    faviconUrl?: unknown;
    metaPixelId?: unknown;
    ga4MeasurementId?: unknown;
    gtmContainerId?: unknown;
    customHeadHtml?: unknown;
    customBodyEndHtml?: unknown;
    category?: unknown;
    tags?: unknown;
  },
): Promise<LandingPageDetail> {
  const existing = await prisma.landingPage.findUnique({ where: { id } });
  if (!existing) throw new LandingPageServiceError('Not found.', 404);
  if (
    accountKeys &&
    accountKeys.length > 0 &&
    (existing.accountKey == null || !accountKeys.includes(existing.accountKey))
  ) {
    throw new LandingPageServiceError('Not found.', 404);
  }

  const data: Prisma.LandingPageUpdateInput = {};

  if (patch.name !== undefined) {
    if (typeof patch.name !== 'string' || !patch.name.trim()) {
      throw new LandingPageServiceError('Name must be a non-empty string.');
    }
    data.name = patch.name.trim();
  }

  if (patch.slug !== undefined) {
    if (typeof patch.slug !== 'string') throw new LandingPageServiceError('Slug must be a string.');
    const nextSlug = slugify(patch.slug);
    if (!isValidSlug(nextSlug)) {
      throw new LandingPageServiceError('Slug must be 2–80 lowercase letters, numbers, or hyphens.');
    }
    data.slug = await ensureUniqueSlug(nextSlug, id);
  }

  if (patch.status !== undefined) {
    if (patch.status !== 'draft' && patch.status !== 'published') {
      throw new LandingPageServiceError('Status must be draft or published.');
    }
    data.status = patch.status;
    if (patch.status === 'published' && !existing.publishedAt) {
      data.publishedAt = new Date();
    }
  }

  if (patch.schema !== undefined) {
    if (!isV1LandingPageTemplate(patch.schema) && !isHtmlLandingPageTemplate(patch.schema)) {
      throw new LandingPageServiceError('Schema must be a v1 LandingPageTemplate or HTML template.');
    }
    data.schema = patch.schema as unknown as Prisma.InputJsonValue;
  }

  // Shared template taxonomy — inline category/tags edits from the template card.
  if (patch.category !== undefined) {
    data.category = typeof patch.category === 'string' && patch.category.trim() ? patch.category.trim() : null;
  }
  if (patch.tags !== undefined) {
    data.tags = Array.isArray(patch.tags)
      ? JSON.stringify(patch.tags.filter((t): t is string => typeof t === 'string'))
      : null;
  }

  if (patch.seoTitle !== undefined) {
    if (patch.seoTitle !== null && typeof patch.seoTitle !== 'string') {
      throw new LandingPageServiceError('seoTitle must be a string or null.');
    }
    data.seoTitle = typeof patch.seoTitle === 'string' ? patch.seoTitle.trim() || null : null;
  }

  if (patch.seoDescription !== undefined) {
    if (patch.seoDescription !== null && typeof patch.seoDescription !== 'string') {
      throw new LandingPageServiceError('seoDescription must be a string or null.');
    }
    data.seoDescription =
      typeof patch.seoDescription === 'string' ? patch.seoDescription.trim() || null : null;
  }

  if (patch.ogImageUrl !== undefined) {
    if (patch.ogImageUrl !== null && typeof patch.ogImageUrl !== 'string') {
      throw new LandingPageServiceError('ogImageUrl must be a string or null.');
    }
    data.ogImageUrl = typeof patch.ogImageUrl === 'string' ? patch.ogImageUrl.trim() || null : null;
  }

  if (patch.noindex !== undefined) {
    if (typeof patch.noindex !== 'boolean') {
      throw new LandingPageServiceError('noindex must be a boolean.');
    }
    data.noindex = patch.noindex;
  }

  if (patch.faviconUrl !== undefined) {
    if (patch.faviconUrl !== null && typeof patch.faviconUrl !== 'string') {
      throw new LandingPageServiceError('faviconUrl must be a string or null.');
    }
    data.faviconUrl =
      typeof patch.faviconUrl === 'string' ? patch.faviconUrl.trim() || null : null;
  }

  // ── Tracking fields ──
  // Light format validation on the curated pixel IDs so users get a
  // friendly error instead of a silently-broken pixel on the live
  // page. The custom HTML strings are length-capped only — by design
  // we don't try to sanitize them; admins are trusted to inject
  // whatever they want on their own LP.
  if (patch.metaPixelId !== undefined) {
    data.metaPixelId = parsePixelId(patch.metaPixelId, /^[0-9]{8,20}$/i, 'Meta Pixel ID');
  }
  if (patch.ga4MeasurementId !== undefined) {
    data.ga4MeasurementId = parsePixelId(
      patch.ga4MeasurementId,
      /^G-[A-Z0-9]{6,20}$/i,
      'GA4 Measurement ID (expected format: G-XXXXXXXXXX)',
    );
  }
  if (patch.gtmContainerId !== undefined) {
    data.gtmContainerId = parsePixelId(
      patch.gtmContainerId,
      /^GTM-[A-Z0-9]{4,12}$/i,
      'GTM Container ID (expected format: GTM-XXXXXX)',
    );
  }
  if (patch.customHeadHtml !== undefined) {
    data.customHeadHtml = parseCustomHtml(patch.customHeadHtml, 'customHeadHtml');
  }
  if (patch.customBodyEndHtml !== undefined) {
    data.customBodyEndHtml = parseCustomHtml(patch.customBodyEndHtml, 'customBodyEndHtml');
  }

  const row = await prisma.landingPage.update({ where: { id }, data });
  return toDetail(row);
}

/** Normalize + validate a pixel ID string. Empty/null clears the
 *  field; non-empty must match the expected pattern. */
function parsePixelId(value: unknown, pattern: RegExp, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new LandingPageServiceError(`${label} must be a string or null.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!pattern.test(trimmed)) {
    throw new LandingPageServiceError(`${label} format is invalid.`);
  }
  return trimmed;
}

const MAX_CUSTOM_HTML_BYTES = 10 * 1024; // 10KB ceiling per field

function parseCustomHtml(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new LandingPageServiceError(`${label} must be a string or null.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_CUSTOM_HTML_BYTES) {
    throw new LandingPageServiceError(
      `${label} exceeds the 10KB size limit. Move bulky resources to an external file and reference them here.`,
    );
  }
  return trimmed;
}

export async function deleteLandingPage(
  id: string,
  accountKeys: string[] | null,
): Promise<void> {
  const existing = await prisma.landingPage.findUnique({ where: { id } });
  if (!existing) throw new LandingPageServiceError('Not found.', 404);
  if (
    accountKeys &&
    accountKeys.length > 0 &&
    (existing.accountKey == null || !accountKeys.includes(existing.accountKey))
  ) {
    throw new LandingPageServiceError('Not found.', 404);
  }
  await prisma.landingPage.delete({ where: { id } });
}

/**
 * Clone an existing landing page in a single transaction. The new
 * page:
 *  - inherits the source's schema (deep copy via JSON roundtrip)
 *  - gets a fresh slug derived from "<source.name> copy"
 *  - starts in draft status
 *  - drops SEO metadata (clones often want their own SEO; carrying
 *    over the original's title/description leads to duplicate-page
 *    SEO problems)
 */
export async function cloneLandingPage(
  id: string,
  accountKeys: string[] | null,
  options: { createdByUserId?: string; name?: string } = {},
): Promise<LandingPageDetail> {
  const source = await prisma.landingPage.findUnique({ where: { id } });
  if (!source) throw new LandingPageServiceError('Not found.', 404);
  if (
    accountKeys &&
    accountKeys.length > 0 &&
    (source.accountKey == null || !accountKeys.includes(source.accountKey))
  ) {
    throw new LandingPageServiceError('Not found.', 404);
  }

  const baseName = options.name?.trim() || `${source.name || 'Untitled'} (copy)`;
  const baseSlug = slugify(baseName);
  const slug = await ensureUniqueSlug(baseSlug);

  // Deep clone via JSON roundtrip — safe because LandingPageTemplate
  // is plain data (no Maps / Sets / functions).
  const schema = JSON.parse(JSON.stringify(source.schema)) as Prisma.InputJsonValue;

  const row = await prisma.landingPage.create({
    data: {
      accountKey: source.accountKey,
      name: baseName,
      slug,
      schema,
      status: 'draft',
      isTemplate: source.isTemplate,
      createdByUserId: options.createdByUserId,
    },
  });
  return toDetail(row);
}
