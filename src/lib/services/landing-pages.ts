import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  emptyLandingPageTemplate,
  isV1LandingPageTemplate,
  parseLandingPageTemplate,
  type LandingPageTemplate,
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
  accountKey: string;
  name: string;
  slug: string;
  status: LandingPageStatus;
  createdByUserId: string;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
  /** Parsed LandingPageTemplate — included on every list response so
   *  the card view can render a preview thumbnail without per-card
   *  refetching. Falls back to an empty template on parse failure. */
  schema: LandingPageTemplate;
  /** SEO + share preview metadata. Null when unset. */
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
}

export interface LandingPageDetail extends LandingPageSummary {
  /** Public share URL of the published landing page. Always populated
   *  (even for drafts — the URL is reserved on create). */
  publicUrl: string;
}

interface LandingPageRow {
  id: string;
  accountKey: string;
  name: string;
  slug: string;
  status: string;
  schema: Prisma.JsonValue;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  createdByUserId: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toSummary(row: LandingPageRow): LandingPageSummary {
  const parsed = parseLandingPageTemplate(row.schema) ?? emptyLandingPageTemplate();
  return {
    id: row.id,
    accountKey: row.accountKey,
    name: row.name,
    slug: row.slug,
    status: (row.status as LandingPageStatus) ?? 'draft',
    createdByUserId: row.createdByUserId ?? '',
    publishedAt: row.publishedAt?.toISOString() ?? '',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    schema: parsed,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    ogImageUrl: row.ogImageUrl,
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
    where: accountKeys && accountKeys.length > 0 ? { accountKey: { in: accountKeys } } : undefined,
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map(toSummary);
}

export async function getLandingPage(
  id: string,
  accountKeys?: string[] | null,
): Promise<LandingPageDetail | null> {
  const row = await prisma.landingPage.findUnique({ where: { id } });
  if (!row) return null;
  if (accountKeys && accountKeys.length > 0 && !accountKeys.includes(row.accountKey)) {
    return null;
  }
  return toDetail(row);
}

export async function getPublishedLandingPageBySlug(slug: string): Promise<LandingPageDetail | null> {
  const row = await prisma.landingPage.findUnique({ where: { slug } });
  if (!row || row.status !== 'published') return null;
  return toDetail(row);
}

// ── Create / update / delete ───────────────────────────────────────

export interface CreateLandingPageInput {
  accountKey: string;
  name: string;
  slug?: string;
  schema?: LandingPageTemplate;
  createdByUserId?: string;
}

export async function createLandingPage(input: CreateLandingPageInput): Promise<LandingPageDetail> {
  if (!input.name?.trim()) throw new LandingPageServiceError('Name is required.');
  const baseSlug = slugify(input.slug || input.name);
  if (!isValidSlug(baseSlug)) {
    throw new LandingPageServiceError('Slug must be 2–80 lowercase letters, numbers, or hyphens.');
  }
  const slug = await ensureUniqueSlug(baseSlug);
  const schema = (input.schema ?? emptyLandingPageTemplate()) as unknown as Prisma.InputJsonValue;

  const row = await prisma.landingPage.create({
    data: {
      accountKey: input.accountKey,
      name: input.name.trim(),
      slug,
      schema,
      createdByUserId: input.createdByUserId,
    },
  });
  return toDetail(row);
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
  },
): Promise<LandingPageDetail> {
  const existing = await prisma.landingPage.findUnique({ where: { id } });
  if (!existing) throw new LandingPageServiceError('Not found.', 404);
  if (accountKeys && accountKeys.length > 0 && !accountKeys.includes(existing.accountKey)) {
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
    if (!isV1LandingPageTemplate(patch.schema)) {
      throw new LandingPageServiceError('Schema must be a v1 LandingPageTemplate.');
    }
    data.schema = patch.schema as unknown as Prisma.InputJsonValue;
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

  const row = await prisma.landingPage.update({ where: { id }, data });
  return toDetail(row);
}

export async function deleteLandingPage(
  id: string,
  accountKeys: string[] | null,
): Promise<void> {
  const existing = await prisma.landingPage.findUnique({ where: { id } });
  if (!existing) throw new LandingPageServiceError('Not found.', 404);
  if (accountKeys && accountKeys.length > 0 && !accountKeys.includes(existing.accountKey)) {
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
  if (accountKeys && accountKeys.length > 0 && !accountKeys.includes(source.accountKey)) {
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
      createdByUserId: options.createdByUserId,
    },
  });
  return toDetail(row);
}
