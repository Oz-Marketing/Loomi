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
 * Replace `data.fontFaceCss` with the base64-embedded @font-face for ALL of the
 * account's custom fonts, so the render matches the editor regardless of whether
 * a font is chosen at the doc level (`data.fontFamily`) or per element
 * (`el.fontFamily`). Embedding every account face (not just the doc-level one)
 * is what keeps per-element brand fonts from silently dropping on export.
 * Mutates + returns data. Leaves `data.fontFaceCss` untouched when the account
 * has no custom fonts (or none could be fetched).
 */
export async function embedAccountFontCss(accountKey: string | undefined, data: Record<string, string>): Promise<Record<string, string>> {
  if (!accountKey) return data;
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { customFonts: true },
  });
  const faces = parseCustomFonts(account?.customFonts);
  if (faces.length) data.fontFaceCss = await embeddedFontFaceCss(faces);
  return data;
}
