import { prisma } from '@/lib/prisma';
import { createVersion } from './template-versions';

type TemplateScope = 'library' | 'subaccount' | 'all';

interface TemplateListOptions {
  type?: string;
  publishedOnly?: boolean;
  // Filter by ownership. When provided, only templates owned by this
  // subaccount are returned (and `scope` is ignored).
  accountKey?: string;
  // Org-owned templates (Phase 2 inheritance). When provided, returns only
  // templates authored at this organization (accountKey IS NULL, organizationId
  // = this). Ignored when `accountKey` is set.
  organizationId?: string;
  // When `accountKey`/`organizationId` are not provided, controls global scope:
  //   - 'library' (default): shared Loomi library only (accountKey IS NULL AND
  //     organizationId IS NULL — org-owned templates are NOT library templates)
  //   - 'subaccount': only subaccount-owned templates (accountKey IS NOT NULL)
  //   - 'all': no scope filter
  scope?: TemplateScope;
}

function buildWhere(options: TemplateListOptions = {}) {
  const where: {
    type?: string;
    published?: boolean;
    accountKey?: string | null | { not: null };
    organizationId?: string | null;
  } = {};
  if (options.type) where.type = options.type;
  if (options.publishedOnly) where.published = true;
  if (options.accountKey) {
    where.accountKey = options.accountKey;
  } else if (options.organizationId) {
    where.organizationId = options.organizationId;
  } else {
    const scope = options.scope ?? 'library';
    if (scope === 'library') {
      // Library = neither sub-account- nor org-owned. Excluding org-owned here
      // is what keeps inherited templates out of the global library list.
      where.accountKey = null;
      where.organizationId = null;
    } else if (scope === 'subaccount') {
      where.accountKey = { not: null };
    }
    // 'all' → no ownership filter
  }
  return Object.keys(where).length > 0 ? where : undefined;
}

export async function getTemplates(typeOrOptions?: string | TemplateListOptions) {
  const options: TemplateListOptions =
    typeof typeOrOptions === 'string' ? { type: typeOrOptions } : typeOrOptions || {};
  return prisma.template.findMany({
    where: buildWhere(options),
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      slug: true,
      accountKey: true,
      organizationId: true,
      title: true,
      type: true,
      category: true,
      preheader: true,
      published: true,
      publishedAt: true,
      createdAt: true,
      updatedAt: true,
      createdByUser: {
        select: { id: true, name: true, avatarUrl: true },
      },
      updatedByUser: {
        select: { id: true, name: true, avatarUrl: true },
      },
      publishedByUser: {
        select: { id: true, name: true, avatarUrl: true },
      },
    },
  });
}

export async function getTemplatesWithContent(typeOrOptions?: string | TemplateListOptions) {
  const options: TemplateListOptions =
    typeof typeOrOptions === 'string' ? { type: typeOrOptions } : typeOrOptions || {};
  return prisma.template.findMany({
    where: buildWhere(options),
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      slug: true,
      accountKey: true,
      organizationId: true,
      title: true,
      content: true,
      type: true,
      category: true,
      preheader: true,
      published: true,
      publishedAt: true,
      createdAt: true,
      updatedAt: true,
      createdByUser: {
        select: { id: true, name: true, avatarUrl: true },
      },
      updatedByUser: {
        select: { id: true, name: true, avatarUrl: true },
      },
      publishedByUser: {
        select: { id: true, name: true, avatarUrl: true },
      },
    },
  });
}

export async function getTemplate(slug: string) {
  return prisma.template.findUnique({ where: { slug } });
}

export async function getTemplateById(id: string) {
  return prisma.template.findUnique({ where: { id } });
}

export async function createTemplate(data: {
  slug: string;
  title: string;
  type: string;
  content: string;
  category?: string;
  preheader?: string;
  createdByUserId?: string;
  accountKey?: string | null;
  // Set (with accountKey null) to author an org-owned template that every
  // child rooftop inherits.
  organizationId?: string | null;
}) {
  return prisma.template.create({ data });
}

/**
 * The templates a sub-account effectively sees: its own, plus any templates
 * authored at its parent organization (inherited, read-only until cloned).
 * Library templates are intentionally excluded — those are listed separately.
 */
export async function getEffectiveTemplatesForAccount(
  accountKey: string,
  opts: { type?: string } = {},
) {
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { organizationId: true },
  });
  const orgId = account?.organizationId ?? null;

  const where = {
    ...(opts.type ? { type: opts.type } : {}),
    OR: [{ accountKey }, ...(orgId ? [{ organizationId: orgId }] : [])],
  };

  // Content is always selected so this composes with getTemplatesWithContent's
  // shape (both feed the same API response mapping).
  return prisma.template.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      slug: true,
      accountKey: true,
      organizationId: true,
      title: true,
      content: true,
      type: true,
      category: true,
      preheader: true,
      published: true,
      publishedAt: true,
      createdAt: true,
      updatedAt: true,
      createdByUser: { select: { id: true, name: true, avatarUrl: true } },
      updatedByUser: { select: { id: true, name: true, avatarUrl: true } },
      publishedByUser: { select: { id: true, name: true, avatarUrl: true } },
    },
  });
}

export async function updateTemplate(
  slug: string,
  data: { content?: string; title?: string; preheader?: string; category?: string },
  snapshot = true,
  userId?: string,
) {
  const existing = await prisma.template.findUnique({ where: { slug } });
  if (!existing) throw new Error(`Template "${slug}" not found`);

  // Create a version snapshot before updating
  if (snapshot && data.content && data.content !== existing.content) {
    await createVersion(existing.id, existing.content, userId);
  }

  // Derive new slug from title when title changes
  const updateData: Record<string, unknown> = {
    ...data,
    updatedAt: new Date(),
    updatedByUserId: userId || null,
  };
  if (data.title && data.title !== existing.title) {
    const newSlug = data.title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (newSlug && newSlug !== slug) {
      // Only rename if the new slug doesn't collide with another template
      const collision = await prisma.template.findUnique({ where: { slug: newSlug } });
      if (!collision) {
        updateData.slug = newSlug;
      }
    }
  }

  return prisma.template.update({
    where: { slug },
    data: updateData,
  });
}

export async function deleteTemplate(slug: string) {
  return prisma.template.delete({ where: { slug } });
}

export async function setPublished(slug: string, published: boolean, userId?: string) {
  return prisma.template.update({
    where: { slug },
    data: {
      published,
      publishedAt: published ? new Date() : null,
      publishedByUserId: published ? userId || null : null,
    },
  });
}

export async function setPublishedBulk(slugs: string[], published: boolean, userId?: string) {
  if (slugs.length === 0) return { count: 0 };
  // Publish is library-only. Subaccount-owned templates are already private
  // to their account, so silently exclude them from bulk publish actions.
  return prisma.template.updateMany({
    where: { slug: { in: slugs }, accountKey: null },
    data: {
      published,
      publishedAt: published ? new Date() : null,
      publishedByUserId: published ? userId || null : null,
    },
  });
}

export async function cloneTemplate(
  sourceSlug: string,
  targetSlug?: string,
  userId?: string,
  accountKey?: string | null,
) {
  const source = await prisma.template.findUnique({ where: { slug: sourceSlug } });
  if (!source) throw new Error(`Template "${sourceSlug}" not found`);

  // Generate a unique slug if not provided
  let slug = targetSlug || `${sourceSlug}-copy`;
  let attempt = 0;
  while (await prisma.template.findUnique({ where: { slug } })) {
    attempt++;
    slug = `${sourceSlug}-copy-${attempt}`;
  }

  const title = slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  // When cloning into a subaccount the new copy is owned by that subaccount
  // and is a draft regardless of the source's publish state — `published` is
  // a library-only concept.
  const targetAccountKey = accountKey ?? source.accountKey ?? null;

  return prisma.template.create({
    data: {
      slug,
      title,
      type: source.type,
      category: source.category,
      content: source.content,
      preheader: source.preheader,
      accountKey: targetAccountKey,
      createdByUserId: userId || null,
    },
  });
}
