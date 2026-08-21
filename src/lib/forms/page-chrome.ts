/**
 * Page-level CSS for the public form route.
 *
 * `/f/[slug]` renders inside the app's root layout, which paints the
 * Studio chrome onto <body>: `data-theme="dark"`, a near-black
 * background, and `flex min-h-screen`. That's invisible on the
 * standalone page (the form's own background covers the viewport) but
 * it's exactly what a host page sees through an iframe that's taller
 * than the form — the dead space renders as a black slab instead of
 * blending into the page. `min-h-screen` also pins <body> to the
 * iframe's height, so the document can never report a height smaller
 * than the frame it's already in.
 *
 * Embedded: go fully transparent so the host page shows through any
 * leftover frame height. Standalone: paint the form's own `bodyBg` so
 * the page still looks like the builder preview.
 */

/**
 * CSS colors we'll interpolate into a <style> block: hex, rgb/rgba,
 * hsl/hsla, and bare keywords. Anything else (including anything
 * carrying a `;`, `}` or `<`) is rejected rather than escaped — a form
 * background has no reason to be exotic, and rejecting keeps the style
 * block impossible to break out of.
 */
const SAFE_CSS_COLOR =
  /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([0-9a-z%.,\s/+-]+\)|[a-z]{3,20})$/i;

export const FALLBACK_BODY_BG = '#ffffff';

/** Return `value` when it's a plain CSS color, else the fallback. */
export function safeCssColor(value: unknown, fallback = FALLBACK_BODY_BG): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return SAFE_CSS_COLOR.test(trimmed) ? trimmed : fallback;
}

/**
 * The <style> body that neutralizes the app chrome for one form page.
 * `!important` throughout: the rules it overrides come from Tailwind
 * utility classes on <body>, which outrank a bare element selector.
 */
export function publicFormChromeCss(options: {
  embed: boolean;
  bodyBg: unknown;
}): string {
  const background = options.embed ? 'transparent' : safeCssColor(options.bodyBg);
  return [
    'html, body {',
    `  background: ${background} !important;`,
    '  min-height: 0 !important;',
    '  height: auto !important;',
    '}',
    'body {',
    '  margin: 0 !important;',
    // The root layout sets `display:flex` on <body>; a flex body stretches
    // its child to the full frame height, which defeats the height the
    // resize observer reports back to the embed loader.
    '  display: block !important;',
    '}',
  ].join('\n');
}
