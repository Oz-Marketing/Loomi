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
import { hasUnrestrictedAccountAccess } from '@/lib/roles';
import { accountCustomFontFaces, embeddedFontFaceCss } from '@/lib/ad-generator/render-fonts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const accountKey = req.nextUrl.searchParams.get('accountKey') || undefined;
  // Unrestricted admins see the union of every account's fonts (roll-up); others
  // only the requested account's own.
  const unrestricted = hasUnrestrictedAccountAccess(session.user.role, session.user.accountKeys ?? []);
  if (!accountKey && !unrestricted) return NextResponse.json({ css: '' });

  try {
    const faces = await accountCustomFontFaces(accountKey, { unrestricted });
    const css = await embeddedFontFaceCss(faces);
    return NextResponse.json({ css });
  } catch (err) {
    console.warn('[api/ad-generator/fonts] falling back to empty css:', err);
    return NextResponse.json({ css: '' });
  }
}
