/**
 * The Appearance catalog — one source of truth for every personalization the
 * Appearance tab offers.
 *
 * Each preference is applied as a `data-*` attribute on `<html>`, and the
 * matching token overrides live in `globals.css`. Keeping the keys here (rather
 * than inline in the component) means the API can validate an incoming value,
 * the context can normalize a stale cookie, and the settings UI can render the
 * catalog — all from the same list. Adding a preset is a code change in two
 * places (this file + the CSS block), never a migration: the DB stores plain
 * strings.
 */

export type ThemePreference = 'dark' | 'light' | 'system';
/** The theme actually painted — 'system' has been resolved away. */
export type ResolvedTheme = 'dark' | 'light';
/** `custom` is not a preset — it defers to `accentCustom` and is applied as an
 *  inline property rather than a CSS block. It is deliberately absent from
 *  `ACCENTS`, which is only the swatch row. */
/** The full Tailwind hue set, plus `custom` — which defers to `accentCustom`
 *  and is absent from `ACCENTS` because it has no fixed swatch. */
export type AccentKey =
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'emerald'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'purple'
  | 'fuchsia'
  | 'pink'
  | 'rose'
  | 'slate'
  | 'gray'
  | 'zinc'
  | 'neutral'
  | 'stone'
  | 'custom';
export type FontKey =
  | 'system'
  | 'inter'
  | 'space-grotesk'
  | 'rubik'
  | 'lexend'
  | 'syne'
  | 'bricolage';
export type DensityKey = 'compact' | 'comfortable' | 'spacious';

export interface AppearancePrefs {
  theme: ThemePreference;
  accent: AccentKey;
  /** Hex used when `accent === 'custom'`. Kept even while a preset is selected
   *  so switching back to Custom restores the last color the user mixed. */
  accentCustom: string;
  fontFamily: FontKey;
  density: DensityKey;
  reduceTransparency: boolean;
  reduceMotion: boolean;
}

export const DEFAULT_APPEARANCE: AppearancePrefs = {
  theme: 'system',
  accent: 'indigo',
  accentCustom: '#6366f1',
  fontFamily: 'system',
  density: 'comfortable',
  reduceTransparency: false,
  reduceMotion: false,
};

/**
 * Every Tailwind hue, in Tailwind's own order so the row reads as a color
 * wheel (warm → cool → neutral).
 *
 * Each entry carries two values because one hex cannot serve both themes: the
 * shade that reads well on the near-black canvas is too light on the white one.
 * Chromatic hues use 500 on dark / 600 on light. The five neutral families step
 * up to 400 on dark — their 500s are too dim against the dark canvas to work as
 * a primary.
 *
 * Unlike theme/font/density, accents are NOT applied via a CSS block. They are
 * written as inline custom properties by `applyAppearanceToDocument`, so the
 * 22 presets and the user's custom color share one code path instead of
 * needing 44 hand-written CSS rules.
 */
export const ACCENTS: { key: AccentKey; label: string; dark: string; light: string }[] = [
  { key: 'red', label: 'Red', dark: '#ef4444', light: '#dc2626' },
  { key: 'orange', label: 'Orange', dark: '#f97316', light: '#ea580c' },
  { key: 'amber', label: 'Amber', dark: '#f59e0b', light: '#d97706' },
  { key: 'yellow', label: 'Yellow', dark: '#eab308', light: '#ca8a04' },
  { key: 'lime', label: 'Lime', dark: '#84cc16', light: '#65a30d' },
  { key: 'green', label: 'Green', dark: '#22c55e', light: '#16a34a' },
  { key: 'emerald', label: 'Emerald', dark: '#10b981', light: '#059669' },
  { key: 'teal', label: 'Teal', dark: '#14b8a6', light: '#0d9488' },
  { key: 'cyan', label: 'Cyan', dark: '#06b6d4', light: '#0891b2' },
  { key: 'sky', label: 'Sky', dark: '#0ea5e9', light: '#0284c7' },
  { key: 'blue', label: 'Blue', dark: '#3b82f6', light: '#2563eb' },
  { key: 'indigo', label: 'Indigo', dark: '#6366f1', light: '#4f46e5' },
  { key: 'violet', label: 'Violet', dark: '#8b5cf6', light: '#7c3aed' },
  { key: 'purple', label: 'Purple', dark: '#a855f7', light: '#9333ea' },
  { key: 'fuchsia', label: 'Fuchsia', dark: '#d946ef', light: '#c026d3' },
  { key: 'pink', label: 'Pink', dark: '#ec4899', light: '#db2777' },
  { key: 'rose', label: 'Rose', dark: '#f43f5e', light: '#e11d48' },
  { key: 'slate', label: 'Slate', dark: '#94a3b8', light: '#475569' },
  { key: 'gray', label: 'Gray', dark: '#9ca3af', light: '#4b5563' },
  { key: 'zinc', label: 'Zinc', dark: '#a1a1aa', light: '#52525b' },
  { key: 'neutral', label: 'Neutral', dark: '#a3a3a3', light: '#525252' },
  { key: 'stone', label: 'Stone', dark: '#a8a29e', light: '#57534e' },
];

const ACCENT_BY_KEY = new Map(ACCENTS.map((a) => [a.key, a]));

/** Expand `#abc` to `#aabbcc` and lowercase. Returns null if not a valid hex. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw
      .split('')
      .map((c) => c + c)
      .join('')}`.toLowerCase();
  }
  return /^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw.toLowerCase()}` : null;
}

/** WCAG relative luminance, used to choose readable text on the accent and to
 *  warn when a custom color won't stand out against the page. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * Text/icon color to sit ON the accent. Computed rather than hand-tuned per
 * color, which is what lets bright hues like amber, yellow and lime take dark
 * text automatically instead of shipping unreadable white-on-yellow.
 */
export function accentForeground(hex: string): string {
  return relativeLuminance(hex) > 0.4 ? '#1c1917' : '#ffffff';
}

/** The page background each theme paints, for contrast checks. */
export const THEME_BACKGROUND: Record<ResolvedTheme, string> = {
  dark: '#09090b',
  light: '#f8f9fb',
};

/** The accent hex actually in force, resolving both the preset table and the
 *  custom color. One helper so the picker previews exactly what gets applied. */
export function accentHex(prefs: AppearancePrefs, resolved: ResolvedTheme): string {
  if (prefs.accent === 'custom') {
    return normalizeHex(prefs.accentCustom) ?? DEFAULT_APPEARANCE.accentCustom;
  }
  const entry = ACCENT_BY_KEY.get(prefs.accent);
  if (!entry) return resolved === 'dark' ? '#6366f1' : '#4f46e5';
  return resolved === 'dark' ? entry.dark : entry.light;
}

/**
 * All sans-serif, by design — Loomi is a dense data UI and serif/monospace faces
 * hurt legibility in tables at these sizes.
 *
 * Everything except `system` is a Google font, self-hosted through `next/font`
 * (see `./fonts.ts`). `preview` is the stack the settings card renders its
 * sample in, so each face is visible in its own typeface before it's applied.
 * The `--font-*` variables it references are declared globally on `<html>`.
 */
export const FONTS: { key: FontKey; label: string; description: string; preview: string }[] = [
  {
    key: 'system',
    label: 'System',
    description: "Your OS's interface font — San Francisco on Mac, Segoe on Windows.",
    preview: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  {
    key: 'inter',
    label: 'Inter',
    description: 'The modern interface workhorse. Neutral, with very legible numerals.',
    preview: 'var(--font-inter), system-ui, sans-serif',
  },
  {
    key: 'space-grotesk',
    label: 'Space Grotesk',
    description: 'Technical and angular, with cut-off terminals. Reads engineered.',
    preview: 'var(--font-space-grotesk), system-ui, sans-serif',
  },
  {
    key: 'rubik',
    label: 'Rubik',
    description: 'Softly rounded corners on every stem. The warmest option here.',
    preview: 'var(--font-rubik), system-ui, sans-serif',
  },
  {
    key: 'lexend',
    label: 'Lexend',
    description: 'Wide apertures and loose spacing, designed to reduce reading effort.',
    preview: 'var(--font-lexend), system-ui, sans-serif',
  },
  {
    key: 'syne',
    label: 'Syne',
    description: 'Editorial and deliberately odd — narrow caps, unusual proportions.',
    preview: 'var(--font-syne), system-ui, sans-serif',
  },
  {
    key: 'bricolage',
    label: 'Bricolage Grotesque',
    description: 'Contemporary grotesque with quirky details and tight, dense fit.',
    preview: 'var(--font-bricolage), system-ui, sans-serif',
  },
];

/**
 * Density works by scaling the root font size. Tailwind v4 sizes both spacing
 * and type in `rem`, so one root value rescales padding, gaps, text and control
 * heights together and stays proportional — no per-utility migration.
 *
 * Breakpoints are deliberately unaffected: `rem` inside a media query resolves
 * against the browser's initial font size, not the root override, so `md:` still
 * flips at the same viewport width in every density.
 */
export const DENSITIES: { key: DensityKey; label: string; description: string; rootPx: number }[] = [
  {
    key: 'compact',
    label: 'Compact',
    description: 'More rows on screen. Best for long tables and the pacer.',
    rootPx: 14,
  },
  {
    key: 'comfortable',
    label: 'Comfortable',
    description: 'The standard Loomi spacing.',
    rootPx: 16,
  },
  {
    key: 'spacious',
    label: 'Spacious',
    description: 'Roomier text and controls, with more breathing room.',
    rootPx: 17,
  },
];

// 'custom' is a valid stored value but has no swatch entry, so it is added here
// rather than derived from the table.
const ACCENT_KEYS = new Set<string>([...ACCENTS.map((a) => a.key), 'custom']);
const FONT_KEYS = new Set<string>(FONTS.map((f) => f.key));
const DENSITY_KEYS = new Set<string>(DENSITIES.map((d) => d.key));

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'dark' || v === 'light' || v === 'system';
}

/**
 * Coerce an arbitrary object (a parsed cookie, a DB row, a request body) into a
 * complete, valid preference set. Anything unrecognized falls back to its
 * default rather than throwing — a stale cookie from a removed preset should
 * degrade to the default look, not break the app shell.
 */
export function normalizeAppearance(input: unknown): AppearancePrefs {
  const raw = (input ?? {}) as Record<string, unknown>;
  return {
    theme: isThemePreference(raw.theme) ? raw.theme : DEFAULT_APPEARANCE.theme,
    accent:
      typeof raw.accent === 'string' && ACCENT_KEYS.has(raw.accent)
        ? (raw.accent as AccentKey)
        : DEFAULT_APPEARANCE.accent,
    // An unparseable hex falls back to the default rather than rejecting the
    // whole payload — a bad color shouldn't cost the user their other settings.
    accentCustom: normalizeHex(raw.accentCustom) ?? DEFAULT_APPEARANCE.accentCustom,
    fontFamily:
      typeof raw.fontFamily === 'string' && FONT_KEYS.has(raw.fontFamily)
        ? (raw.fontFamily as FontKey)
        : DEFAULT_APPEARANCE.fontFamily,
    density:
      typeof raw.density === 'string' && DENSITY_KEYS.has(raw.density)
        ? (raw.density as DensityKey)
        : DEFAULT_APPEARANCE.density,
    reduceTransparency:
      typeof raw.reduceTransparency === 'boolean'
        ? raw.reduceTransparency
        : DEFAULT_APPEARANCE.reduceTransparency,
    reduceMotion:
      typeof raw.reduceMotion === 'boolean'
        ? raw.reduceMotion
        : DEFAULT_APPEARANCE.reduceMotion,
  };
}

/**
 * Serialize for the cookie. A compact `k:v|k:v` encoding rather than JSON so the
 * value needs no percent-encoding — cookie values can't contain `,` `;` or
 * spaces without quoting, and JSON braces survive round-trips inconsistently
 * across proxies.
 */
export function encodeAppearance(prefs: AppearancePrefs): string {
  return [
    `t:${prefs.theme}`,
    `a:${prefs.accent}`,
    // Stored without the leading '#'. It is a legal cookie octet, but dropping
    // it keeps the value alphanumeric and avoids any fragment-parsing surprise.
    `ac:${prefs.accentCustom.replace(/^#/, '')}`,
    `f:${prefs.fontFamily}`,
    `d:${prefs.density}`,
    `rt:${prefs.reduceTransparency ? 1 : 0}`,
    `rm:${prefs.reduceMotion ? 1 : 0}`,
  ].join('|');
}

export function decodeAppearance(value: string | null | undefined): AppearancePrefs | null {
  if (!value) return null;
  const parts = value.split('|');
  const map = new Map<string, string>();
  for (const part of parts) {
    const idx = part.indexOf(':');
    if (idx > 0) map.set(part.slice(0, idx), part.slice(idx + 1));
  }
  if (map.size === 0) return null;
  return normalizeAppearance({
    theme: map.get('t'),
    accent: map.get('a'),
    accentCustom: map.get('ac'),
    fontFamily: map.get('f'),
    density: map.get('d'),
    reduceTransparency: map.get('rt') === '1',
    reduceMotion: map.get('rm') === '1',
  });
}

/**
 * Write every preference onto `<html>`. Called by the theme context on each
 * change.
 *
 * Theme/font/density are data attributes matched by CSS blocks. Booleans are
 * written as presence/absence so the CSS can match the bare attribute.
 *
 * The accent is different: it is set as inline custom properties. That is what
 * lets 22 presets and an arbitrary user-picked color share one path — and
 * inline properties outrank the `:root` / `[data-theme]` blocks without needing
 * `!important`. `data-accent` is still written so the current choice is visible
 * in devtools and available to future CSS hooks.
 */
export function applyAppearanceToDocument(
  prefs: AppearancePrefs,
  resolved: ResolvedTheme,
): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  el.setAttribute('data-theme', resolved);
  el.setAttribute('data-accent', prefs.accent);
  el.setAttribute('data-font', prefs.fontFamily);
  el.setAttribute('data-density', prefs.density);
  el.toggleAttribute('data-reduce-transparency', prefs.reduceTransparency);
  el.toggleAttribute('data-reduce-motion', prefs.reduceMotion);

  const hex = accentHex(prefs, resolved);
  el.style.setProperty('--primary', hex);
  el.style.setProperty('--primary-foreground', accentForeground(hex));
  el.style.setProperty('--ring', hex);
  el.style.setProperty('--sidebar-ring', hex);
}
