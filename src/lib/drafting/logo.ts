import sharp from 'sharp';

/**
 * Which of an account's logos goes in a drafted email's footer: the one that
 * contrasts with the footer — dark artwork on a light footer, white artwork on
 * a dark one (Connor, 2026-10-15).
 *
 * The variant names can't be trusted for that: "Light Logo" reads as either
 * "for light backgrounds" or "light-colored", and Young Chev's was uploaded the
 * second way — 81% near-white, which vanished on the white footer and left
 * only a small blue badge showing (the first live draft, 2026-10-15). So every
 * candidate is measured, and the one furthest in brightness from the
 * background wins.
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

/** Luminance (0–255) of a hex color — "#fff", "#eff1f5". Null for anything else. */
export function hexLuminance(color: string): number | null {
  const m = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The logo with the most contrast against `background`. A logo that can't be
 * fetched or read is skipped; if none can be measured, the slot most likely to
 * fit is used (Black/Dark on a light footer, White/Light on a dark one), so a
 * slow logo host never costs the footer its logo.
 */
export async function footerLogo(
  logos: LogoSet | null | undefined,
  background: string,
  fetchBytes: (url: string) => Promise<Buffer> = download,
): Promise<string | null> {
  const bg = hexLuminance(background) ?? 255;
  const darkFooter = bg < 128;
  const slots = darkFooter
    ? [logos?.white, logos?.light, logos?.dark, logos?.black]
    : [logos?.black, logos?.dark, logos?.light, logos?.white];
  const candidates = slots
    .map((u) => u?.trim())
    .filter((u, i, all): u is string => !!u && all.indexOf(u) === i);
  if (candidates.length <= 1) return candidates[0] ?? null;

  let best: { url: string; contrast: number } | null = null;
  for (const url of candidates) {
    try {
      const lum = await luminanceOf(await fetchBytes(url));
      if (lum === null) continue;
      const contrast = Math.abs(lum - bg);
      if (!best || contrast > best.contrast) best = { url, contrast };
    } catch {
      // Unreadable — the others still count.
    }
  }
  return best?.url ?? candidates[0];
}
