/**
 * CSS colors, reduced to what a brand palette rule needs: which color is it,
 * is it a gray, is it a red.
 *
 * Pure.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** The named colors an email realistically carries. Anything else must be hex or rgb(). */
const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  blue: '#0000ff',
  green: '#008000',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  navy: '#000080',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
};

/** Keywords that carry no color of their own. */
const NOT_A_COLOR = new Set(['transparent', 'inherit', 'initial', 'unset', 'currentcolor', 'none']);

export function parseColor(raw: string): Rgb | null {
  const v = raw.trim().toLowerCase();
  if (!v || NOT_A_COLOR.has(v)) return null;
  const named = NAMED[v];
  if (named) return parseColor(named);

  const hex = v.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    // An 8-digit hex with zero alpha is invisible.
    if (h.length === 8 && h.slice(6) === '00') return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  const fn = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (fn) {
    if (fn[4] !== undefined && parseFloat(fn[4]) === 0) return null;
    return { r: Math.round(+fn[1]), g: Math.round(+fn[2]), b: Math.round(+fn[3]) };
  }
  return null;
}

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')}`;
}

/** Every color token in one declaration value: "1px solid #c00", "#fff url(x.png)". */
export function colorsIn(value: string): Rgb[] {
  // A URL is not a color, however it's spelled ("…/red-car.png").
  const withoutUrls = value.replace(/url\([^)]*\)/gi, ' ');
  const tokens = withoutUrls.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b[a-z]+\b/gi) ?? [];
  return tokens.map(parseColor).filter((c): c is Rgb => c !== null);
}

/** Close enough to neutral that only the eye of a brand manager would call it a color. */
export function isAchromatic({ r, g, b }: Rgb, tolerance = 10): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) <= tolerance;
}

/** Hue within ±20° of red, saturated enough to read as red rather than brown-gray. */
export function isRed({ r, g, b }: Rgb): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (max < 60 || delta / max < 0.35) return false;
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return hue <= 20 || hue >= 340;
}
