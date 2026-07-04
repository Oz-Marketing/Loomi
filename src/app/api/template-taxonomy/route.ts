/**
 * Shared template taxonomy — GET /api/template-taxonomy
 *
 * Returns the union of Categories + Tags across EVERY template kind (email, ads,
 * forms, landing pages) so the shared template card's category/tag popovers show
 * the same suggestions everywhere. Read-only; resilient (a kind that isn't
 * migrated in this environment just contributes nothing).
 */
import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const categories = new Set<string>();
  const tags = new Set<string>();

  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };

  const [emailCats, adRows, formRows, lpRows, tagVocab] = await Promise.all([
    safe(() => prisma.template.findMany({ where: { category: { not: null } }, select: { category: true }, distinct: ['category'] }), [] as { category: string | null }[]),
    safe(() => prisma.adTemplateDoc.findMany({ select: { category: true, tags: true } }), [] as { category: string | null; tags: string | null }[]),
    safe(() => prisma.form.findMany({ where: { isTemplate: true }, select: { category: true, tags: true } }), [] as { category: string | null; tags: string | null }[]),
    safe(() => prisma.accountLandingPageTemplate.findMany({ select: { category: true, tags: true } }), [] as { category: string | null; tags: string | null }[]),
    safe(() => prisma.templateTag.findMany({ select: { name: true } }), [] as { name: string }[]),
  ]);

  for (const r of emailCats) if (r.category) categories.add(r.category);
  for (const rows of [adRows, formRows, lpRows]) {
    for (const r of rows) {
      if (r.category) categories.add(r.category);
      for (const t of parseTags(r.tags)) tags.add(t);
    }
  }
  for (const t of tagVocab) if (t.name) tags.add(t.name);

  return NextResponse.json({
    categories: [...categories].sort((a, b) => a.localeCompare(b)),
    tags: [...tags].sort((a, b) => a.localeCompare(b)),
  });
}
