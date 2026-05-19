import { prisma } from '@/lib/prisma';
import { createVersion } from './template-versions';

interface TemplateListOptions {
  type?: string;
  publishedOnly?: boolean;
}

function buildWhere(options: TemplateListOptions = {}) {
  const where: { type?: string; published?: boolean } = {};
  if (options.type) where.type = options.type;
  if (options.publishedOnly) where.published = true;
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
}) {
  return prisma.template.create({ data });
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
  return prisma.template.updateMany({
    where: { slug: { in: slugs } },
    data: {
      published,
      publishedAt: published ? new Date() : null,
      publishedByUserId: published ? userId || null : null,
    },
  });
}

export async function cloneTemplate(sourceSlug: string, targetSlug?: string, userId?: string) {
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

  return prisma.template.create({
    data: {
      slug,
      title,
      type: source.type,
      category: source.category,
      content: source.content,
      preheader: source.preheader,
      createdByUserId: userId || null,
    },
  });
}
