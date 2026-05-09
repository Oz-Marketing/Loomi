import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as templateService from '@/lib/services/templates';
import { renderCampaignScreenshotFromHtml } from '@/lib/esp/screenshot-render';
import { isV2Template, parseV2Template } from '@/lib/email/types';
import { renderEmailTemplate } from '@/lib/email/render';

/**
 * Compile any supported template format to email-safe HTML.
 *  - v2 JSON  → react-email render
 *  - Pure HTML → returned as-is
 */
async function compileToHtml(content: string): Promise<string> {
  if (isV2Template(content)) {
    const tpl = parseV2Template(content);
    if (!tpl) throw new Error('Invalid v2 template JSON');
    return renderEmailTemplate(tpl);
  }
  return content;
}

function sanitizeFileName(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const safe = trimmed
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return safe || 'template';
}

/**
 * GET /api/templates/screenshot?design=slug
 *
 * Compile a library template and download a high-resolution PNG screenshot.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const design = req.nextUrl.searchParams.get('design');
  if (!design) {
    return NextResponse.json({ error: 'design is required' }, { status: 400 });
  }

  const template = await templateService.getTemplate(design);
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  try {
    const compiledHtml = await compileToHtml(template.content);

    const screenshot = await renderCampaignScreenshotFromHtml({
      html: compiledHtml,
      filename: `${sanitizeFileName(template.title || design)}.png`,
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
