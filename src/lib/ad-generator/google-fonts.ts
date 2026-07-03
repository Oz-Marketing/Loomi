/**
 * Curated Google Fonts library for the Ad Generator.
 *
 * Google Fonts are open-licensed (OFL / Apache) — free for commercial use, so
 * they're safe to bake into client ad creative. This is a hand-picked set (not
 * the full ~1,700-family catalog) chosen for range + quality across categories.
 *
 * Loading model:
 *  - Editor (canvas iframe + dropdown previews): loaded by URL via the Google
 *    Fonts CSS2 API. `fonts.gstatic.com` sends permissive CORS headers, so
 *    unlike our own S3-hosted uploads these load fine cross-origin (no embed).
 *  - Export (headless Chromium): the USED families are base64-embedded
 *    server-side (see render-fonts.ts) so a one-shot screenshot never races the
 *    network for a webfont.
 *
 * Weights are kept to what each family actually ships so the CSS2 API request
 * never 400s (an invalid weight fails the whole combined request). Other weights
 * the user picks are synthesized by the browser.
 */

export type GoogleFontCategory = 'Sans serif' | 'Serif' | 'Display' | 'Handwriting' | 'Monospace';

export interface GoogleFont {
  family: string;
  category: GoogleFontCategory;
  weights: number[];
}

const TEXT = [400, 700];
const ONE = [400];

export const GOOGLE_FONTS: GoogleFont[] = [
  // ── Sans serif ──
  { family: 'Inter', category: 'Sans serif', weights: [400, 500, 600, 700] },
  { family: 'Roboto', category: 'Sans serif', weights: [400, 500, 700] },
  { family: 'Open Sans', category: 'Sans serif', weights: [400, 600, 700] },
  { family: 'Lato', category: 'Sans serif', weights: [400, 700] },
  { family: 'Montserrat', category: 'Sans serif', weights: [400, 500, 600, 700, 800] },
  { family: 'Poppins', category: 'Sans serif', weights: [400, 500, 600, 700] },
  { family: 'Raleway', category: 'Sans serif', weights: [400, 600, 700] },
  { family: 'Work Sans', category: 'Sans serif', weights: [400, 500, 600, 700] },
  { family: 'Nunito', category: 'Sans serif', weights: [400, 600, 700, 800] },
  { family: 'Nunito Sans', category: 'Sans serif', weights: TEXT },
  { family: 'Rubik', category: 'Sans serif', weights: [400, 500, 600, 700] },
  { family: 'Mulish', category: 'Sans serif', weights: TEXT },
  { family: 'Manrope', category: 'Sans serif', weights: [400, 600, 700, 800] },
  { family: 'DM Sans', category: 'Sans serif', weights: [400, 500, 700] },
  { family: 'Karla', category: 'Sans serif', weights: TEXT },
  { family: 'Quicksand', category: 'Sans serif', weights: [400, 500, 700] },
  { family: 'Josefin Sans', category: 'Sans serif', weights: [400, 600, 700] },
  { family: 'Barlow', category: 'Sans serif', weights: [400, 500, 600, 700] },
  { family: 'Archivo', category: 'Sans serif', weights: [400, 600, 700] },
  { family: 'Figtree', category: 'Sans serif', weights: [400, 500, 600, 700] },
  { family: 'Sora', category: 'Sans serif', weights: [400, 600, 700] },
  { family: 'Space Grotesk', category: 'Sans serif', weights: [400, 500, 700] },
  { family: 'Outfit', category: 'Sans serif', weights: [400, 500, 600, 700] },
  { family: 'Plus Jakarta Sans', category: 'Sans serif', weights: [400, 500, 600, 700] },
  { family: 'Kanit', category: 'Sans serif', weights: [400, 500, 600, 700] },
  { family: 'Fira Sans', category: 'Sans serif', weights: [400, 500, 700] },
  { family: 'PT Sans', category: 'Sans serif', weights: TEXT },
  { family: 'Cabin', category: 'Sans serif', weights: [400, 600, 700] },
  { family: 'Assistant', category: 'Sans serif', weights: [400, 600, 700] },

  // ── Serif ──
  { family: 'Playfair Display', category: 'Serif', weights: [400, 600, 700, 800] },
  { family: 'Merriweather', category: 'Serif', weights: TEXT },
  { family: 'Lora', category: 'Serif', weights: [400, 500, 600, 700] },
  { family: 'PT Serif', category: 'Serif', weights: TEXT },
  { family: 'Roboto Slab', category: 'Serif', weights: [400, 500, 700] },
  { family: 'Bitter', category: 'Serif', weights: [400, 600, 700] },
  { family: 'Cormorant Garamond', category: 'Serif', weights: [400, 500, 600, 700] },
  { family: 'EB Garamond', category: 'Serif', weights: [400, 500, 600, 700] },
  { family: 'Libre Baskerville', category: 'Serif', weights: TEXT },
  { family: 'Crimson Text', category: 'Serif', weights: [400, 600, 700] },
  { family: 'Source Serif 4', category: 'Serif', weights: [400, 600, 700] },
  { family: 'Noto Serif', category: 'Serif', weights: TEXT },
  { family: 'Zilla Slab', category: 'Serif', weights: [400, 500, 700] },
  { family: 'Spectral', category: 'Serif', weights: [400, 600, 700] },
  { family: 'DM Serif Display', category: 'Serif', weights: ONE },
  { family: 'Frank Ruhl Libre', category: 'Serif', weights: [400, 700, 900] },

  // ── Display ──
  { family: 'Bebas Neue', category: 'Display', weights: ONE },
  { family: 'Anton', category: 'Display', weights: ONE },
  { family: 'Archivo Black', category: 'Display', weights: ONE },
  { family: 'Righteous', category: 'Display', weights: ONE },
  { family: 'Alfa Slab One', category: 'Display', weights: ONE },
  { family: 'Bungee', category: 'Display', weights: ONE },
  { family: 'Titan One', category: 'Display', weights: ONE },
  { family: 'Fredoka', category: 'Display', weights: [400, 500, 600, 700] },
  { family: 'Baloo 2', category: 'Display', weights: [400, 600, 700, 800] },
  { family: 'Passion One', category: 'Display', weights: [400, 700, 900] },
  { family: 'Staatliches', category: 'Display', weights: ONE },
  { family: 'Teko', category: 'Display', weights: [400, 500, 600, 700] },
  { family: 'Russo One', category: 'Display', weights: ONE },
  { family: 'Chewy', category: 'Display', weights: ONE },
  { family: 'Luckiest Guy', category: 'Display', weights: ONE },
  { family: 'Bangers', category: 'Display', weights: ONE },

  // ── Handwriting / Script ──
  { family: 'Pacifico', category: 'Handwriting', weights: ONE },
  { family: 'Lobster', category: 'Handwriting', weights: ONE },
  { family: 'Dancing Script', category: 'Handwriting', weights: [400, 600, 700] },
  { family: 'Caveat', category: 'Handwriting', weights: [400, 600, 700] },
  { family: 'Satisfy', category: 'Handwriting', weights: ONE },
  { family: 'Great Vibes', category: 'Handwriting', weights: ONE },
  { family: 'Sacramento', category: 'Handwriting', weights: ONE },
  { family: 'Shadows Into Light', category: 'Handwriting', weights: ONE },
  { family: 'Permanent Marker', category: 'Handwriting', weights: ONE },
  { family: 'Kalam', category: 'Handwriting', weights: TEXT },
  { family: 'Courgette', category: 'Handwriting', weights: ONE },
  { family: 'Cookie', category: 'Handwriting', weights: ONE },

  // ── Monospace ──
  { family: 'Space Mono', category: 'Monospace', weights: TEXT },
  { family: 'JetBrains Mono', category: 'Monospace', weights: [400, 500, 700] },
  { family: 'Roboto Mono', category: 'Monospace', weights: [400, 500, 700] },
  { family: 'IBM Plex Mono', category: 'Monospace', weights: [400, 500, 700] },
  { family: 'Fira Code', category: 'Monospace', weights: [400, 500, 700] },
  { family: 'Source Code Pro', category: 'Monospace', weights: [400, 600, 700] },
];

const BY_FAMILY = new Map(GOOGLE_FONTS.map((f) => [f.family, f]));

/** Fast membership check — is this family one of our curated Google fonts? */
export function isGoogleFont(family: string | null | undefined): boolean {
  return !!family && BY_FAMILY.has(family);
}

export function googleFont(family: string): GoogleFont | undefined {
  return BY_FAMILY.get(family);
}

/**
 * Build a Google Fonts CSS2 API URL for the given families. Pass `weightsOverride`
 * to request a single weight (e.g. [400] for lightweight dropdown previews);
 * otherwise each family's full declared weight set is requested. Families not in
 * the catalog are ignored. Returns '' when nothing valid is requested.
 */
export function googleFontsCssUrl(families: string[], weightsOverride?: number[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const family of families) {
    const gf = BY_FAMILY.get(family);
    if (!gf || seen.has(family)) continue;
    seen.add(family);
    const weights = (weightsOverride ?? gf.weights).filter((w) => gf.weights.includes(w));
    const wght = (weights.length ? weights : [400]).slice().sort((a, b) => a - b).join(';');
    parts.push(`family=${family.replace(/ /g, '+')}:wght@${wght}`);
  }
  if (!parts.length) return '';
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap`;
}

/** The families used by a doc (per-element + doc-level) that are Google fonts. */
export function usedGoogleFontFamilies(
  elements: { fontFamily?: string }[],
  docFontFamily?: string,
): string[] {
  const set = new Set<string>();
  if (docFontFamily && BY_FAMILY.has(docFontFamily)) set.add(docFontFamily);
  for (const el of elements) {
    if (el.fontFamily && BY_FAMILY.has(el.fontFamily)) set.add(el.fontFamily);
  }
  return [...set];
}
