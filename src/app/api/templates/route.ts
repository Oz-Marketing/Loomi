import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import { hasUnrestrictedAccountAccess } from '@/lib/roles';
import { parseTemplate } from '@/lib/template-parser';
import { serializeTemplate } from '@/lib/template-serializer';
import { getStarterTemplate } from '@/lib/template-starters';
import * as templateService from '@/lib/services/templates';
import { isVisualEditableTemplate, parseV2Template } from '@/lib/email/types';

function extractFrontmatterTitle(content: string): string | undefined {
  const v2 = parseV2Template(content);
  if (v2?.title) return v2.title;
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
  const userAccountKeys = session!.user.accountKeys ?? [];
  const isClient = role === 'client';
  const unrestricted = hasUnrestrictedAccountAccess(role, userAccountKeys);

  const design = req.nextUrl.searchParams.get('design');
  const format = req.nextUrl.searchParams.get('format'); // 'raw' for raw HTML
  const type = req.nextUrl.searchParams.get('type'); // 'lifecycle' | 'design'
  const accountKeyParam = req.nextUrl.searchParams.get('accountKey'); // scope to a specific subaccount
  const scopeParam = req.nextUrl.searchParams.get('scope'); // 'library' | 'subaccount' | 'all'
  // Clients only ever see published templates from the library. For
  // subaccount-owned templates the published flag is meaningless, so we don't
  // apply that filter when listing within an accountKey scope.
  const publishedOnly = isClient && !accountKeyParam
    ? true
    : req.nextUrl.searchParams.get('publishedOnly') === 'true';

  if (design) {
    // Read specific template by slug
    try {
      const template = await templateService.getTemplate(design);
      if (!template) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 });
      }
      // Enforce access: subaccount-owned templates require account access.
      if (template.accountKey) {
        if (!unrestricted && !userAccountKeys.includes(template.accountKey)) {
          return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }
      } else if (isClient && !template.published) {
        // Library templates: hide drafts from client role.
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

  // Resolve list scoping. Order of precedence:
  //   1. ?accountKey=<key> → templates owned by that subaccount (access-checked)
  //   2. ?scope=library|subaccount|all → explicit scope
  //   3. default → library (preserves the canonical /email/templates list)
  let listOptions: Parameters<typeof templateService.getTemplatesWithContent>[0] = {
    type: type || undefined,
    publishedOnly,
  };

  if (accountKeyParam) {
    if (!unrestricted && !userAccountKeys.includes(accountKeyParam)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    listOptions = { ...listOptions, accountKey: accountKeyParam };
  } else if (scopeParam === 'subaccount' || scopeParam === 'all') {
    // 'subaccount' / 'all' scopes are management-only — exposing every
    // subaccount's templates to a client would leak across tenants.
    if (!unrestricted) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    listOptions = { ...listOptions, scope: scopeParam };
  } else {
    listOptions = { ...listOptions, scope: 'library' };
  }

  const templates = await templateService.getTemplatesWithContent(listOptions);
  return NextResponse.json(
    templates.map((t) => ({
      id: t.id,
      design: t.slug,
      accountKey: t.accountKey,
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

    // Extract title and preheader from content. v2 JSON templates carry
    // these as top-level fields; legacy formats use a YAML `---` block.
    let title: string | undefined;
    let preheader: string | undefined;
    const v2 = parseV2Template(content);
    if (v2) {
      title = v2.title || undefined;
      preheader = v2.preheader || undefined;
    } else {
      const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const titleMatch = fmMatch[1].match(/^title:\s*(.+)$/m);
        if (titleMatch) title = titleMatch[1].trim().replace(/^["']|["']$/g, '');
        const phMatch = fmMatch[1].match(/^preheader:\s*(.+)$/m);
        if (phMatch) preheader = phMatch[1].trim().replace(/^["']|["']$/g, '');
      }
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
    const { design, type: templateType, mode, accountKey } = await req.json();

    if (!design) {
      return NextResponse.json({ error: 'Missing design name' }, { status: 400 });
    }

    const role = session!.user.role;
    const userAccountKeys = session!.user.accountKeys ?? [];
    const unrestricted = hasUnrestrictedAccountAccess(role, userAccountKeys);

    let resolvedAccountKey: string | null = null;
    if (typeof accountKey === 'string' && accountKey.trim()) {
      const key = accountKey.trim();
      if (!unrestricted && !userAccountKeys.includes(key)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      resolvedAccountKey = key;
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

    // For subaccount-owned templates, prefix the slug to keep it unique from
    // library templates that might share a name (slug is globally unique).
    const finalSlug = resolvedAccountKey
      ? await findAvailableSlug(`${resolvedAccountKey}-${safeSlug}`)
      : safeSlug;

    const designLabel = safeSlug
      .split('-')
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    const createMode = mode === 'code' ? 'code' : 'visual';
    const starter = getStarterTemplate(createMode, designLabel);

    await templateService.createTemplate({
      slug: finalSlug,
      title: designLabel,
      type: templateType || 'design',
      content: starter,
      createdByUserId: session!.user.id,
      accountKey: resolvedAccountKey,
    });

    return NextResponse.json({ design: finalSlug });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'Template already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

async function findAvailableSlug(base: string): Promise<string> {
  let slug = base;
  let attempt = 1;
  while (await templateService.getTemplate(slug)) {
    attempt += 1;
    slug = `${base}-${attempt}`;
  }
  return slug;
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
