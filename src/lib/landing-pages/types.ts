/**
 * Loomi landing-page template format (v1) — JSON, block-based.
 *
 * Mirrors the v1 FormTemplate shape in src/lib/forms/types.ts so the
 * editor shell can be reused with a different block registry. Where
 * forms have field_* blocks (text input, email, etc.), LPs have
 * marketing-focused blocks (hero, features, testimonial, faq) and an
 * `embedded_form` block that references a Form by id.
 *
 * Storage: `LandingPage.schema` is a JSON column holding a
 * `LandingPageTemplate`.
 * Rendering: `LandingPageTemplate` -> React tree of marketing
 * components -> plain browser HTML. The public page at /lp/[slug] is a
 * Next.js Server Component; client interactivity (embedded forms,
 * accordions, etc.) hydrates as needed.
 */

export type LandingPageBlockType =
  // Containers / structural
  | 'section'
  | 'columns'
  | 'spacer'
  | 'divider'
  // Headline / copy primitives
  | 'heading'
  | 'text'
  | 'image'
  // Marketing-focused blocks
  | 'hero'
  | 'feature_row'
  | 'feature_grid'
  | 'cta'
  | 'testimonial'
  | 'faq'
  | 'video'
  | 'logo_strip'
  // Embedded form — references an existing Loomi Form by id
  | 'embedded_form'
  // Raw HTML escape hatch (advanced users)
  | 'html';

export interface Block {
  id: string;
  type: LandingPageBlockType;
  /** Desktop values (the base). */
  props: Record<string, unknown>;
  /** Sparse map of mobile-specific overrides. Only the keys the user
   *  has changed on mobile preview are stored here; everything else
   *  cascades from `props`. */
  mobileProps?: Record<string, unknown>;
  /** Only used for container blocks (`section`, `columns`). */
  children?: Block[];
}

/** Per-device viewport identity. The editor's preview toggle and the
 *  public page's media-query gate both speak this. */
export type LandingPageDevice = 'desktop' | 'mobile';

/**
 * Return the effective props for a block at the given device.
 * Desktop = the block's base `props`; mobile = base merged with the
 * sparse mobile overrides on top.
 */
export function effectiveProps(
  block: Block,
  device: LandingPageDevice,
): Record<string, unknown> {
  if (device === 'desktop' || !block.mobileProps) return block.props;
  return { ...block.props, ...block.mobileProps };
}

/** True when THIS block (not its descendants) has at least one
 *  mobile override. The public renderer uses this to decide whether
 *  to dual-render the block itself — descendants make their own
 *  decision recursively, so each subtree dual-renders at the deepest
 *  level it needs to and we avoid the N²-DOM trap of dual-rendering
 *  every ancestor of an overridden leaf. */
export function hasMobileOverrides(block: Block): boolean {
  return !!block.mobileProps && Object.keys(block.mobileProps).length > 0;
}

export interface LandingPageSettings {
  /** Outer page background (around the content container). */
  bodyBg: string;
  /** Content container background (the LP "card" / wrapper). */
  contentBg: string;
  /** Max content width in pixels — default 1140 for a typical
   *  marketing LP (wider than forms' default 640). */
  contentWidth: number;
  /** Inner padding of the content container, per-side, in px. */
  contentPaddingTop: number;
  contentPaddingRight: number;
  contentPaddingBottom: number;
  contentPaddingLeft: number;
  /** Outer margin around the content container, per-side, in px. */
  contentMarginTop: number;
  contentMarginRight: number;
  contentMarginBottom: number;
  contentMarginLeft: number;
  /** Corner radius of the content container, in px. 0 = edge-to-edge. */
  contentBorderRadius: number;
  /** Default font stack applied at the page root. */
  fontFamily: string;
  /** Default body text color. */
  textColor: string;
  /** Primary brand / accent color — used by Hero CTAs, buttons, etc.
   *  Defaults to a neutral indigo; users override per-page. */
  primaryColor: string;
}

export interface LandingPageTemplate {
  version: '1';
  title?: string;
  settings: LandingPageSettings;
  blocks: Block[];
}

export const DEFAULT_LP_SETTINGS: LandingPageSettings = {
  bodyBg: '#ffffff',
  contentBg: '#ffffff',
  contentWidth: 1140,
  contentPaddingTop: 0,
  contentPaddingRight: 0,
  contentPaddingBottom: 0,
  contentPaddingLeft: 0,
  contentMarginTop: 0,
  contentMarginRight: 0,
  contentMarginBottom: 0,
  contentMarginLeft: 0,
  contentBorderRadius: 0,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  textColor: '#1a1a1a',
  primaryColor: '#6366f1',
};

export function isV1LandingPageTemplate(content: unknown): content is LandingPageTemplate {
  if (!content || typeof content !== 'object') return false;
  const c = content as Record<string, unknown>;
  return c.version === '1' && Array.isArray(c.blocks) && typeof c.settings === 'object';
}

export function parseLandingPageTemplate(raw: unknown): LandingPageTemplate | null {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return isV1LandingPageTemplate(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isV1LandingPageTemplate(raw) ? raw : null;
}

export function emptyLandingPageTemplate(): LandingPageTemplate {
  return {
    version: '1',
    settings: { ...DEFAULT_LP_SETTINGS },
    blocks: [],
  };
}

/**
 * Walk a landing page template and return every embedded-form block
 * (type === 'embedded_form'). Used by the public renderer to fetch
 * the referenced Form schemas in a single Prisma round-trip.
 */
export function collectEmbeddedFormIds(template: LandingPageTemplate): string[] {
  const ids = new Set<string>();
  const walk = (blocks: Block[]) => {
    for (const block of blocks) {
      if (block.type === 'embedded_form') {
        const formId = block.props?.formId;
        if (typeof formId === 'string' && formId.length > 0) ids.add(formId);
      }
      if (block.children?.length) walk(block.children);
    }
  };
  walk(template.blocks);
  return Array.from(ids);
}
