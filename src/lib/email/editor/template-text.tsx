// Pure helpers for pulling user-visible text out of a v2 EmailTemplate.
//
// Used by:
//   - EmailSettings → feeds the subject/preview-text AI generator with
//     the email's body copy so suggestions stay on-topic.
//   - BlockProperties → feeds the block copywriter with surrounding
//     blocks' text (excluding the block being rewritten) so suggestions
//     stay consistent with the rest of the email.
//
// Strips HTML tags (the `text` block's content is stored as HTML for
// the formatting toolbar) and collapses whitespace so the AI gets
// clean prose, not markup.

import type { Block, EmailTemplate } from '@/lib/email/types';

/** Block types whose `text` / `content` props are user-visible body
 *  copy worth feeding to the AI. Image alt text, button labels, and
 *  heading text all qualify; image src URLs, hex colors, and spacer
 *  heights do not. */
const TEXT_BEARING_TYPES: ReadonlySet<string> = new Set([
  'heading',
  'text',
  'button',
]);

/** Pull the user-visible string out of a single block. Returns null
 *  for blocks that don't carry rewrite-worthy text. */
export function textForBlock(block: Block): string | null {
  if (!TEXT_BEARING_TYPES.has(block.type)) return null;
  const raw = block.props.text;
  if (typeof raw !== 'string') return null;
  const cleaned = stripHtmlToText(raw);
  return cleaned || null;
}

/**
 * Walk the template (depth-first into section/columns children) and
 * return the visible body text from each block in document order.
 *
 * Optional `excludeBlockId` skips a single block — used when feeding
 * "context" to the block-copywriter so the block being rewritten
 * doesn't appear in its own context list.
 */
export function extractTemplateText(
  template: EmailTemplate,
  excludeBlockId?: string,
): string[] {
  const out: string[] = [];
  const visit = (block: Block): void => {
    if (excludeBlockId && block.id === excludeBlockId) {
      // Still descend into children — only the named block itself is
      // skipped, not its subtree (which is rare for text blocks
      // anyway since text blocks don't have children).
    } else {
      const text = textForBlock(block);
      if (text) out.push(text);
    }
    if (block.children) {
      for (const child of block.children) visit(child);
    }
  };
  for (const block of template.blocks) visit(block);
  return out;
}

/** Strip HTML tags + decode common entities + collapse whitespace.
 *  Stays SSR-safe (no DOMParser) since we may be called from server
 *  routes that import this module indirectly. */
function stripHtmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}
