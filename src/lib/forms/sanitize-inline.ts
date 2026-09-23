import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitize author-supplied inline HTML for form text — the Consent
 * field body and the Text block's "Allow HTML" mode. Lets form builders
 * embed links (e.g. Privacy Policy / Terms) and light inline formatting
 * while blocking every injection vector before it reaches the public
 * /f/[slug] page.
 *
 * Uses isomorphic-dompurify so the same call works in the browser
 * (editor preview) and in the Node render path (public page, jsdom).
 *
 * Scope is deliberately inline-only: anchors + basic emphasis, no block
 * or embed tags. ALLOWED_URI_REGEXP restricts hrefs to safe schemes so
 * `javascript:` / `data:` links can't slip through.
 *
 * `style` is allowed but filtered down to a handful of text properties
 * (color, weight, decoration…) — never `url()`, `position`, or anything
 * that could overlay the form or beacon out.
 *
 * Anchors get two defaults, because the app's CSS reset renders a bare
 * `<a>` as plain text (inherited color, no underline):
 *  - an underline, unless the author set their own text-decoration;
 *  - `target="_blank"` + `rel="noopener noreferrer"` on web links, so a
 *    Privacy Policy click doesn't navigate away from a half-filled form
 *    (or swap out the iframe on an embedded one).
 */
const SAFE_URI_REGEX = /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

const INLINE_TAGS = ['a', 'b', 'strong', 'i', 'em', 'u', 'br', 'span'];
const INLINE_ATTR = ['href', 'target', 'rel', 'style'];

const SAFE_STYLE_PROPS = new Set([
  'color',
  'background-color',
  'font-weight',
  'font-style',
  'text-decoration',
  'text-decoration-color',
  'text-decoration-line',
  'text-decoration-style',
  'text-decoration-thickness',
  'text-underline-offset',
]);

// Values are colors, keywords, and lengths — never functions other than
// rgb()/hsl() colors, and never anything that can escape the declaration.
const SAFE_STYLE_VALUE = /^(?:[#\w\s.,%-]|(?:rgba?|hsla?)\([\d\s.,%/]+\))+$/i;

/** Keep only whitelisted `prop: value` declarations; '' when none survive. */
export function filterInlineStyle(style: string): string {
  const kept: string[] = [];
  for (const decl of style.split(';')) {
    const colon = decl.indexOf(':');
    if (colon === -1) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (!SAFE_STYLE_PROPS.has(prop) || !value || !SAFE_STYLE_VALUE.test(value)) continue;
    kept.push(`${prop}: ${value}`);
  }
  return kept.join('; ');
}

function scrubStyle(node: Element) {
  const style = node.getAttribute('style');
  if (style == null) return;
  const filtered = filterInlineStyle(style);
  if (filtered) node.setAttribute('style', filtered);
  else node.removeAttribute('style');
}

function applyLinkDefaults(node: Element) {
  if (node.tagName !== 'A') return;
  const style = node.getAttribute('style') ?? '';
  if (!/text-decoration/i.test(style)) {
    node.setAttribute('style', style ? `${style}; text-decoration: underline` : 'text-decoration: underline');
  }
  const href = node.getAttribute('href') ?? '';
  if (/^https?:/i.test(href) && !node.hasAttribute('target')) {
    node.setAttribute('target', '_blank');
  }
  if (node.getAttribute('target') === '_blank' && !node.hasAttribute('rel')) {
    node.setAttribute('rel', 'noopener noreferrer');
  }
}

export interface SanitizeInlineOptions {
  /**
   * Add the underline / new-tab anchor defaults. On for rendering; the
   * editor's Text view turns it off so editing doesn't bake the defaults
   * into the saved markup.
   */
  linkDefaults?: boolean;
}

export function sanitizeInlineHtml(input: string, { linkDefaults = true }: SanitizeInlineOptions = {}): string {
  if (!input) return '';
  // Hooks are global on the shared DOMPurify instance (the Custom HTML
  // block uses it too), so scope ours to this synchronous call.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeType !== 1) return;
    scrubStyle(node as Element);
    if (linkDefaults) applyLinkDefaults(node as Element);
  });
  try {
    return DOMPurify.sanitize(input, {
      ALLOWED_TAGS: INLINE_TAGS,
      ALLOWED_ATTR: INLINE_ATTR,
      ALLOWED_URI_REGEXP: SAFE_URI_REGEX,
    });
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes');
  }
}
