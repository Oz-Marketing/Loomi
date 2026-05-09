import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { renderCampaignScreenshotFromHtml } from '@/lib/esp/screenshot-render';
import { isV2Template, parseV2Template } from '@/lib/email/types';
import { renderEmailTemplate } from '@/lib/email/render';

function sanitizeFileName(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const safe = trimmed
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return safe || 'template';
}


/**
 * GET /api/esp/templates/screenshot?accountKey=xxx&templateId=yyy
 *
 * Download a high-resolution PNG screenshot of an ESP template.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const accountKey = req.nextUrl.searchParams.get('accountKey');
  const templateId = req.nextUrl.searchParams.get('templateId');
  if (!accountKey || !templateId) {
    return NextResponse.json(
      { error: 'accountKey and templateId are required' },
      { status: 400 },
    );
  }

  const userRole = session!.user.role;
  const userAccountKeys: string[] = session!.user.accountKeys ?? [];
  const hasUnrestrictedAccess =
    userRole === 'developer' ||
    userRole === 'super_admin' ||
    (userRole === 'admin' && userAccountKeys.length === 0);
  if (!hasUnrestrictedAccess && !userAccountKeys.includes(accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const template = await prisma.espTemplate.findFirst({
    where: { id: templateId, accountKey },
    select: { id: true, name: true, html: true, source: true },
  });
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  let resolvedHtml = template.html?.trim() || '';
  const source = template.source?.trim() || '';

  try {
    if (source) {
      if (isV2Template(source)) {
        const tpl = parseV2Template(source);
        if (!tpl) throw new Error('Invalid v2 template JSON');
        resolvedHtml = await renderEmailTemplate(tpl);
      } else {
        // HTML/code templates: source is the freshest representation.
        resolvedHtml = source;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    return NextResponse.json(
      { error: `Failed to compile latest template source${message ? `: ${message}` : ''}` },
      { status: 500 },
    );
  }

  if (!resolvedHtml.trim()) {
    return NextResponse.json({ error: 'Template HTML is empty' }, { status: 400 });
  }

  try {
    const screenshot = await renderCampaignScreenshotFromHtml({
      html: resolvedHtml,
      filename: `${sanitizeFileName(template.name || 'template')}.png`,
    });

    return new NextResponse(screenshot.image as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': screenshot.contentType,
        'Content-Disposition': `attachment; filename="${screenshot.filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate screenshot';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
