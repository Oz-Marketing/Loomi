/**
 * Font helpers shared by the Ad Generator preview (browser) and render (server).
 *
 * Live preview uses @font-face with the remote S3 URL; the server render embeds
 * the font as a base64 data URI (see the render route) so cross-origin/CORS can
 * never silently drop an OEM-required font from the final PNG.
 */

export interface FontFace {
  family: string;
  weight?: string;
  style?: string;
  url: string;
}

/** Strip characters that could break out of a CSS string / @font-face block. */
export function cssSafeFamily(family: string): string {
  return family.replace(/["'\\<>{};]/g, '').trim();
}

/** woff2|woff|ttf|otf → CSS `format()` token. */
export function fontFormat(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'woff2':
      return 'woff2';
    case 'woff':
      return 'woff';
    case 'ttf':
      return 'truetype';
    case 'otf':
      return 'opentype';
    default:
      return 'woff2';
  }
}

/** One @font-face rule given an explicit `src` expression (url(...) or data URI). */
export function fontFaceRule(face: FontFace, srcExpr: string): string {
  const weight = (face.weight || '400').replace(/[^0-9a-z]/gi, '') || '400';
  const style = face.style === 'italic' ? 'italic' : 'normal';
  return `@font-face{font-family:"${cssSafeFamily(face.family)}";font-weight:${weight};font-style:${style};font-display:swap;src:${srcExpr} format("${fontFormat(face.url)}");}`;
}

/** @font-face CSS using the remote URLs — for the live browser preview. */
export function buildFontFaceCssFromUrls(faces: FontFace[]): string {
  return faces.map((f) => fontFaceRule(f, `url("${f.url}")`)).join('\n');
}

/** Parse the Account.customFonts JSON string into faces (server-side). */
export function parseCustomFonts(raw: string | null | undefined): FontFace[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as FontFace[]) : [];
  } catch {
    return [];
  }
}
