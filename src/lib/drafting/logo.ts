import sharp from 'sharp';

/**
 * Which of an account's logos goes in a drafted email's footer.
 *
 * Drafts are always light (white, or VW's #eff1f5), so the footer needs DARK
 * artwork. The variant names can't be trusted for that: "Light Logo" reads as
 * either "for light backgrounds" or "light-colored", and Young Chev's was
 * uploaded the second way — 81% near-white, which vanishes on white and left
 * only a small blue badge showing (found on the first live draft, 2026-10-15).
 * So every candidate is measured and the darkest is used.
 */

export interface LogoSet {
  light?: string;
  dark?: string;
  white?: string;
  black?: string;
}

/** Mean luminance (0–255) of the opaque pixels of RGBA data, or null if nothing is opaque. */
export function opaqueLuminance(rgba: Uint8Array | Buffer): number | null {
  let n = 0;
  let sum = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    n++;
    sum += 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  }
  return n ? sum / n : null;
}

/** Smallest the measurement needs; full-size logos are hundreds of pixels wide. */
const SAMPLE_WIDTH = 160;

async function luminanceOf(bytes: Buffer): Promise<number | null> {
  const { data } = await sharp(bytes).resize({ width: SAMPLE_WIDTH, withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return opaqueLuminance(data);
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`logo ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * The darkest of the account's logos, for a light background. A logo that
 * can't be fetched or read is skipped; if none can be measured, the first one
 * on file is used, so a slow logo host never costs the footer its logo.
 */
export async function footerLogo(
  logos: LogoSet | null | undefined,
  fetchBytes: (url: string) => Promise<Buffer> = download,
): Promise<string | null> {
  const candidates = [logos?.black, logos?.dark, logos?.light, logos?.white]
    .map((u) => u?.trim())
    .filter((u, i, all): u is string => !!u && all.indexOf(u) === i);
  if (candidates.length <= 1) return candidates[0] ?? null;

  let best: { url: string; lum: number } | null = null;
  for (const url of candidates) {
    try {
      const lum = await luminanceOf(await fetchBytes(url));
      if (lum !== null && (!best || lum < best.lum)) best = { url, lum };
    } catch {
      // Unreadable — the others still count.
    }
  }
  return best?.url ?? candidates[0];
}
