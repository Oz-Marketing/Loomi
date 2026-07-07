import { prisma } from '@/lib/prisma';
import { downloadFromS3, s3KeyFromPublicUrl } from '@/lib/s3';
import { dedupeFontFaces, fontFaceRule, parseCustomFonts, type FontFace } from '@/lib/ad-generator/fonts';
import { googleFontsCssUrl } from '@/lib/ad-generator/google-fonts';

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

function mimeForUrl(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || 'woff2';
  return FONT_MIME[ext] || 'font/woff2';
}

/**
 * Fetch a font's raw bytes. Prefers the S3 SDK (works for private buckets and
 * recognized public URLs), but falls back to a plain server-side `fetch` for any
 * reachable URL — old-bucket URLs, CDN hosts, or anything whose prefix no longer
 * matches the current `S3_PUBLIC_URL_PREFIX` after a storage migration. The
 * server has no CORS restriction, so this succeeds where the browser preview's
 * cross-origin @font-face would be dropped. Returns null if both paths fail.
 */
async function fetchFontBytes(url: string): Promise<Buffer | null> {
  const key = s3KeyFromPublicUrl(url);
  if (key) {
    try {
      return await downloadFromS3(key);
    } catch {
      // Fall through to a direct fetch (e.g. key resolved but object moved).
    }
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Base64-embedded @font-face CSS for the given curated Google families. Fetches
 * the Google Fonts CSS2 API (a desktop UA so it returns woff2), then inlines
 * every gstatic file as a data URI — so a headless one-shot export never races
 * the network for a webfont. Returns '' if nothing valid / on any failure.
 */
export async function googleFontFaceCss(families: string[]): Promise<string> {
  const url = googleFontsCssUrl(families);
  if (!url) return '';
  let css: string;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) return '';
    css = await res.text();
  } catch {
    return '';
  }
  const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]))];
  for (const u of urls) {
    const buf = await fetchFontBytes(u);
    if (buf) css = css.split(u).join(`data:font/woff2;base64,${buf.toString('base64')}`);
  }
  return css;
}

/** Embed each face as a base64 data URI so the render never depends on CORS. */
export async function embeddedFontFaceCss(faces: FontFace[]): Promise<string> {
  const rules: string[] = [];
  for (const f of faces) {
    const buf = await fetchFontBytes(f.url);
    if (!buf) continue; // Skip a font we can't fetch; template falls back to the system stack.
    rules.push(fontFaceRule(f, `url("data:${mimeForUrl(f.url)};base64,${buf.toString('base64')}")`));
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
export async function embedAccountFontCss(
  accountKey: string | undefined,
  data: Record<string, string>,
  opts?: { unrestricted?: boolean },
): Promise<Record<string, string>> {
  const faces = await accountCustomFontFaces(accountKey, opts);
  if (faces.length) data.fontFaceCss = await embeddedFontFaceCss(faces);
  return data;
}

/**
 * The custom font faces available to a request. For unrestricted (all-account)
 * users this is the union of every account's fonts — so a brand font uploaded
 * to any subaccount rolls up and renders on export, matching the editor. For
 * everyone else it's just the given account's own fonts.
 */
export async function accountCustomFontFaces(
  accountKey: string | undefined,
  opts?: { unrestricted?: boolean },
): Promise<FontFace[]> {
  if (opts?.unrestricted) {
    const accounts = await prisma.account.findMany({ select: { customFonts: true } });
    return dedupeFontFaces(accounts.flatMap((a) => parseCustomFonts(a.customFonts)));
  }
  if (!accountKey) return [];
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { customFonts: true },
  });
  return parseCustomFonts(account?.customFonts);
}
