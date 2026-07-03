/**
 * Account custom-font CSS — /api/ad-generator/fonts?accountKey=X
 *
 * Returns @font-face CSS for the account's uploaded custom fonts with each file
 * **base64-embedded** (data URI), so the builder's live preview loads brand
 * fonts reliably. The browser preview otherwise uses the remote Spaces URLs,
 * which cross-origin/CORS can silently drop — the same reason the headless
 * render embeds fonts (see render-fonts.ts). This endpoint reuses that embedding
 * so the editor is WYSIWYG with the export.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { parseCustomFonts } from '@/lib/ad-generator/fonts';
import { embeddedFontFaceCss } from '@/lib/ad-generator/render-fonts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const accountKey = req.nextUrl.searchParams.get('accountKey') || undefined;
  if (!accountKey) return NextResponse.json({ css: '' });

  try {
    const account = await prisma.account.findUnique({ where: { key: accountKey }, select: { customFonts: true } });
    const faces = parseCustomFonts(account?.customFonts);
    const css = await embeddedFontFaceCss(faces);
    return NextResponse.json({ css });
  } catch (err) {
    console.warn('[api/ad-generator/fonts] falling back to empty css:', err);
    return NextResponse.json({ css: '' });
  }
}
