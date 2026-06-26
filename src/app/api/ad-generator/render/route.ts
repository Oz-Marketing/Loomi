/**
 * Ad Generator render — POST /api/ad-generator/render
 *
 * Body: { templateId, sizeId, accountKey?, data }. Renders the template HTML for
 * the chosen size, rasterizes to PNG via headless Chromium, returns it as a
 * download. Same template function as the client preview → pixel-identical.
 *
 * If the data selects a custom font (data.fontFamily) and an accountKey is given,
 * the account's matching font files are base64-embedded into the @font-face so
 * the OEM font renders reliably regardless of cross-origin/CORS.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { downloadFromS3, s3KeyFromPublicUrl } from '@/lib/s3';
import { resolveTemplate } from '@/lib/ad-generator/resolve-template';
import { adTemplateFromDoc } from '@/lib/ad-generator/doc-template';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import { renderAd } from '@/lib/ad-generator/render';
import { fontFaceRule, parseCustomFonts, type FontFace } from '@/lib/ad-generator/fonts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FONT_MIME: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

/** Embed each face as a base64 data URI so the render never depends on CORS. */
async function embeddedFontFaceCss(faces: FontFace[]): Promise<string> {
  const rules: string[] = [];
  for (const f of faces) {
    const k = s3KeyFromPublicUrl(f.url);
    if (!k) continue;
    try {
      const buf = await downloadFromS3(k);
      const ext = f.url.split('?')[0].split('.').pop()?.toLowerCase() || 'woff2';
      const mime = FONT_MIME[ext] || 'font/woff2';
      rules.push(fontFaceRule(f, `url("data:${mime};base64,${buf.toString('base64')}")`));
    } catch {
      // Skip a font we can't fetch; the template falls back to the system stack.
    }
  }
  return rules.join('\n');
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { templateId?: string; sizeId?: string; accountKey?: string; data?: Record<string, string>; doc?: TemplateDoc };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Prefer the ad's own snapshot doc when supplied (each ad is an independent
  // copy); otherwise resolve the template id live (code templates / older ads).
  const snapshot = body.doc;
  const template =
    snapshot && Array.isArray(snapshot.sizes) && Array.isArray(snapshot.elements) && snapshot.layouts
      ? adTemplateFromDoc(body.templateId || 'snapshot', snapshot)
      : await resolveTemplate(body.templateId ?? '');
  if (!template) return NextResponse.json({ error: 'Unknown template' }, { status: 400 });
  const size = template.sizes.find((s) => s.id === body.sizeId);
  if (!size) return NextResponse.json({ error: 'Unknown size' }, { status: 400 });

  const data = { ...(body.data ?? {}) };

  // Re-build the font @font-face with base64-embedded files (preview sends URL-based).
  const family = data.fontFamily;
  if (body.accountKey && family) {
    const account = await prisma.account.findUnique({
      where: { key: body.accountKey },
      select: { customFonts: true },
    });
    const faces = parseCustomFonts(account?.customFonts).filter((f) => f.family === family);
    data.fontFaceCss = await embeddedFontFaceCss(faces);
  }

  const html = template.render({ ...template.defaults, ...data }, size);

  try {
    const png = await renderAd({ html, width: size.width, height: size.height });
    return new NextResponse(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="${template.id}-${size.id}.png"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ad-generator/render] failed', err);
    return NextResponse.json({ error: 'Render failed' }, { status: 500 });
  }
}
