/**
 * Responsive (per-breakpoint) styling for form blocks.
 *
 * A block may carry a `mobile` bag of overrides for a small subset of
 * props (font size, spacing, alignment) plus two hide toggles in its base
 * props (`hideOnMobile` / `hideOnDesktop`). At render time we turn those
 * into a scoped `<style>` block: a generated class on the block's root
 * element + `@media` rules that override the base inline styles at the
 * mobile breakpoint.
 *
 * Why a stylesheet and not more inline styles: inline styles can't express
 * media queries. The base look stays inline; the media rules use
 * `!important` so they win over the inline base (the only way a stylesheet
 * rule beats an inline one). This mirrors the existing column-stacking CSS.
 */
import type { Block } from './types';

export const MOBILE_BREAKPOINT = 500;

type CssBuilder = (value: unknown) => string | null;

function px(value: unknown, prop: string): string | null {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? `${prop}:${n}px` : null;
}

function raw(value: unknown, prop: string): string | null {
  if (value === '' || value == null) return null;
  return `${prop}:${String(value)}`;
}

/**
 * The prop keys that may hold a mobile override, mapped to the CSS they
 * produce. Kept generic across block types — a block only contributes an
 * override for keys it actually stores in `mobile`.
 */
const RESPONSIVE_PROP_CSS: Record<string, CssBuilder> = {
  fontSize: (v) => px(v, 'font-size'),
  lineHeight: (v) => raw(v, 'line-height'),
  align: (v) => raw(v, 'text-align'),
  gap: (v) => px(v, 'gap'),
  marginTop: (v) => px(v, 'margin-top'),
  marginRight: (v) => px(v, 'margin-right'),
  marginBottom: (v) => px(v, 'margin-bottom'),
  marginLeft: (v) => px(v, 'margin-left'),
  paddingTop: (v) => px(v, 'padding-top'),
  paddingRight: (v) => px(v, 'padding-right'),
  paddingBottom: (v) => px(v, 'padding-bottom'),
  paddingLeft: (v) => px(v, 'padding-left'),
};

/** Prop keys that can be overridden per-breakpoint (used by the editor). */
export const RESPONSIVE_PROP_KEYS: ReadonlySet<string> = new Set(
  Object.keys(RESPONSIVE_PROP_CSS),
);

/** Stable class applied to a block's root element when it has responsive rules. */
export function blockResponsiveClass(id: string): string {
  return `loomi-fb-${id}`;
}

function hasHide(block: Block): { mobile: boolean; desktop: boolean } {
  return {
    mobile: block.props?.hideOnMobile === true,
    desktop: block.props?.hideOnDesktop === true,
  };
}

/** True when a block needs a generated class + `<style>` (overrides or hide). */
export function blockHasResponsive(block: Block): boolean {
  const hide = hasHide(block);
  if (hide.mobile || hide.desktop) return true;
  return !!block.mobile && Object.keys(block.mobile).length > 0;
}

/**
 * Build the scoped CSS for a block's responsive rules, or null when the
 * block has none. `className` is the selector these rules target — attach
 * the same class to the block's root element.
 */
export function buildBlockResponsiveCss(className: string, block: Block): string | null {
  const decls: string[] = [];
  const mobile = block.mobile ?? {};
  for (const [key, value] of Object.entries(mobile)) {
    const builder = RESPONSIVE_PROP_CSS[key];
    if (!builder) continue;
    const css = builder(value);
    if (css) decls.push(`${css} !important`);
  }

  const hide = hasHide(block);
  const rules: string[] = [];

  const mobileBody = [...decls];
  if (hide.mobile) mobileBody.push('display:none !important');
  if (mobileBody.length) {
    rules.push(`@media (max-width:${MOBILE_BREAKPOINT}px){.${className}{${mobileBody.join(';')}}}`);
  }
  if (hide.desktop) {
    rules.push(`@media (min-width:${MOBILE_BREAKPOINT + 1}px){.${className}{display:none !important}}`);
  }

  return rules.length ? rules.join('') : null;
}
