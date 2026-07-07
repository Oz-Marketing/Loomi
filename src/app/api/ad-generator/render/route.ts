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
import { hasUnrestrictedAccountAccess } from '@/lib/roles';
import { resolveTemplate } from '@/lib/ad-generator/resolve-template';
import { adTemplateFromDoc } from '@/lib/ad-generator/doc-template';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import { renderAd } from '@/lib/ad-generator/render';
import { embedAccountFontCss, googleFontFaceCss } from '@/lib/ad-generator/render-fonts';
import { usedGoogleFontFamilies } from '@/lib/ad-generator/google-fonts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

  // Re-build the font @font-face with base64-embedded files (preview sends URL-based).
  // Admins roll up every account's fonts so a picked brand font still embeds.
  const unrestricted = hasUnrestrictedAccountAccess(session.user.role, session.user.accountKeys ?? []);
  const data = await embedAccountFontCss(body.accountKey, { ...(body.data ?? {}) }, { unrestricted });

  // Embed any curated Google fonts the design uses (editor loads them by URL; the
  // export inlines them so a one-shot screenshot never races the network).
  const usedGoogle = usedGoogleFontFamilies(
    Array.isArray(snapshot?.elements) ? snapshot!.elements : [],
    typeof data.fontFamily === 'string' ? data.fontFamily : undefined,
  );
  const googleCss = await googleFontFaceCss(usedGoogle);
  if (googleCss) data.fontFaceCss = `${data.fontFaceCss ?? ''}\n${googleCss}`;

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
