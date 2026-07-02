import { prisma } from '@/lib/prisma';
import { downloadFromS3, s3KeyFromPublicUrl } from '@/lib/s3';
import { fontFaceRule, parseCustomFonts, type FontFace } from '@/lib/ad-generator/fonts';

/**
 * Server-side font embedding for ad renders (shared by the single-PNG and ZIP
 * routes). The preview sends URL-based @font-face css; for the headless render
 * we re-build it with base64-embedded files so the OEM font loads reliably
 * regardless of cross-origin/CORS.
 */

const FONT_MIME: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

/** Embed each face as a base64 data URI so the render never depends on CORS. */
export async function embeddedFontFaceCss(faces: FontFace[]): Promise<string> {
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

/**
 * If the render data selects a custom font and an account is given, replace
 * `data.fontFaceCss` with the base64-embedded version. Mutates + returns data.
 */
export async function embedAccountFontCss(accountKey: string | undefined, data: Record<string, string>): Promise<Record<string, string>> {
  const family = data.fontFamily;
  if (accountKey && family) {
    const account = await prisma.account.findUnique({
      where: { key: accountKey },
      select: { customFonts: true },
    });
    const faces = parseCustomFonts(account?.customFonts).filter((f) => f.family === family);
    data.fontFaceCss = await embeddedFontFaceCss(faces);
  }
  return data;
}
