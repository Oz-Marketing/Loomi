import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import { parseTemplate } from '@/lib/template-parser';
import { serializeTemplate } from '@/lib/template-serializer';
import { getStarterTemplate } from '@/lib/template-starters';
import * as templateService from '@/lib/services/templates';
import { isVisualEditableTemplate } from '@/lib/email/types';

function extractFrontmatterTitle(content: string): string | undefined {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return undefined;
  const titleMatch = fmMatch[1].match(/^title:\s*(.+)$/m);
  if (!titleMatch) return undefined;
  const normalized = titleMatch[1].trim().replace(/^["']|["']$/g, '');
  return normalized || undefined;
}

function hasVisualTemplateScaffold(content: string): boolean {
  return isVisualEditableTemplate(content);
}

export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const role = session!.user.role;
  const isClient = role === 'client';

  const design = req.nextUrl.searchParams.get('design');
  const format = req.nextUrl.searchParams.get('format'); // 'raw' for raw HTML
  const type = req.nextUrl.searchParams.get('type'); // 'lifecycle' | 'design'
  // Clients only ever see published templates; management roles can opt in.
  const publishedOnly = isClient
    ? true
    : req.nextUrl.searchParams.get('publishedOnly') === 'true';

  if (design) {
    // Read specific template by slug
    try {
      const template = await templateService.getTemplate(design);
      if (!template) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 });
      }
      // Hide unpublished templates from client role even when targeted by slug.
      if (isClient && !template.published) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 });
      }

      if (format === 'raw') {
        return NextResponse.json({ raw: template.content, id: template.id, slug: template.slug });
      }

      const parsed = parseTemplate(template.content);
      return NextResponse.json({ ...parsed, id: template.id, slug: template.slug });
    } catch {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
  }

  // List templates
  const templates = await templateService.getTemplatesWithContent({
    type: type || undefined,
    publishedOnly,
  });
  return NextResponse.json(
    templates.map((t) => ({
      id: t.id,
      design: t.slug,
      name: extractFrontmatterTitle(t.content) || t.title,
      editorType: hasVisualTemplateScaffold(t.content) ? 'visual' : 'code',
      type: t.type,
      category: t.category,
      published: t.published,
      publishedAt: t.publishedAt ? t.publishedAt.toISOString() : null,
      publishedBy: t.publishedByUser?.name || null,
      updatedAt: t.updatedAt.toISOString(),
      createdBy: t.createdByUser?.name || null,
      createdByAvatar: t.createdByUser?.avatarUrl || null,
      updatedBy: t.updatedByUser?.name || null,
      updatedByAvatar: t.updatedByUser?.avatarUrl || null,
    })),
  );
}

export async function PUT(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    const body = await req.json();
    const { design, template, raw } = body;
    const createSnapshot = body.createSnapshot !== false;

    if (!design) {
      return NextResponse.json({ error: 'Missing design slug' }, { status: 400 });
    }

    let content: string;
    if (raw !== undefined) {
      content = raw;
    } else if (template) {
      content = serializeTemplate(template);
    } else {
      return NextResponse.json({ error: 'Missing template or raw content' }, { status: 400 });
    }

    // Extract title and preheader from content frontmatter
    let title: string | undefined;
    let preheader: string | undefined;
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const titleMatch = fmMatch[1].match(/^title:\s*(.+)$/m);
      if (titleMatch) title = titleMatch[1].trim().replace(/^["']|["']$/g, '');
      const phMatch = fmMatch[1].match(/^preheader:\s*(.+)$/m);
      if (phMatch) preheader = phMatch[1].trim().replace(/^["']|["']$/g, '');
    }

    const updated = await templateService.updateTemplate(
      design,
      { content, title, preheader },
      createSnapshot,
      session!.user.id,
    );

    return NextResponse.json({ success: true, slug: updated.slug });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    const { design, type: templateType, mode } = await req.json();

    if (!design) {
      return NextResponse.json({ error: 'Missing design name' }, { status: 400 });
    }

    const safeSlug = design
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (!safeSlug) {
      return NextResponse.json({ error: 'Invalid design name' }, { status: 400 });
    }

    const designLabel = safeSlug
      .split('-')
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    const createMode = mode === 'code' ? 'code' : 'visual';
    const starter = getStarterTemplate(createMode, designLabel);

    await templateService.createTemplate({
      slug: safeSlug,
      title: designLabel,
      type: templateType || 'design',
      content: starter,
      createdByUserId: session!.user.id,
    });

    return NextResponse.json({ design: safeSlug });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'Template already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    const design = req.nextUrl.searchParams.get('design');

    if (!design) {
      return NextResponse.json({ error: 'Missing design' }, { status: 400 });
    }

    const template = await templateService.getTemplate(design);
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    await templateService.deleteTemplate(design);

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
