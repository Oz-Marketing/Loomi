import { NextRequest, NextResponse } from 'next/server';
import { canAccessAccount, getAccountScope, getAuthSession } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import * as templateService from '@/lib/services/templates';
import { renderCampaignScreenshotFromHtml } from '@/lib/email/screenshot';
import { isV2Template, parseV2Template } from '@/lib/email/types';
import { renderEmailTemplate } from '@/lib/email/render';
import {
  loadPreviewAccountData,
  resolvePreviewTokens,
} from '@/lib/email/preview-substitute';

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
 * GET /api/templates/screenshot?design=slug&accountKey=youngMazda
 *
 * Compile a library template and download a high-resolution PNG screenshot.
 *
 * `accountKey` is optional and only decides whose data the mergetags resolve
 * to. Without it the PNG carries the same sample values the preview shows
 * for an unscoped viewer, which is still better than shipping raw `{{…}}`.
 */
export async function GET(req: NextRequest) {
  const { error } = await requirePermission('studio.templates.view');
  if (error) return error;

  const design = req.nextUrl.searchParams.get('design');
  if (!design) {
    return NextResponse.json({ error: 'design is required' }, { status: 400 });
  }

  const template = await templateService.getTemplate(design);
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  // Whose values the mergetags resolve to. An accountKey outside the
  // viewer's scope is ignored rather than refused — it changes nothing but
  // the sample data, and the template itself was already authorized above.
  const session = await getAuthSession();
  const requestedAccountKey = req.nextUrl.searchParams.get('accountKey');
  const accountKey =
    requestedAccountKey &&
    session?.user &&
    canAccessAccount(getAccountScope(session), requestedAccountKey)
      ? requestedAccountKey
      : null;

  try {
    const compiledHtml = await compileToHtml(template.content);
    const accountData = accountKey ? await loadPreviewAccountData(accountKey) : null;

    const screenshot = await renderCampaignScreenshotFromHtml({
      html: resolvePreviewTokens(compiledHtml, accountData),
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
