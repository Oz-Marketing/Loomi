/**
 * Turn stored `Template.content` into the HTML a recipient (or a preview
 * iframe) actually sees. Every surface that renders or sends a template goes
 * through here, so the rules live in one place:
 *
 *  - v2 JSON  → react-email render
 *  - HTML     → returned as-is, minus any leading frontmatter block
 *
 * HTML-only templates can start with a YAML-style block —
 *
 *   ---
 *   title: "Young Mazda conquest trade"
 *   ---
 *
 * — written by the library's rename and read back as the template's display
 * name (`api/templates`). It is metadata, never email body: passed through
 * verbatim it renders as visible text above the email. Strip it on the way
 * OUT, never from stored content, or the template loses its name.
 *
 * Legacy Maizzle <x-base> templates are no longer supported; they fall through
 * to the HTML path and render unmodified (raw markup visible).
 */
import { isV2Template, parseV2Template } from './types';
import { renderEmailTemplate } from './render';

const LEADING_FRONTMATTER = /^﻿?\s*---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)\s*/;

/** Remove a leading `---` … `---` frontmatter block. Anything else is untouched. */
export function stripFrontmatter(content: string): string {
  return content.replace(LEADING_FRONTMATTER, '');
}

export async function compileTemplateContent(
  content: string,
  opts: { pretty?: boolean } = {},
): Promise<string> {
  if (isV2Template(content)) {
    const tpl = parseV2Template(content);
    if (!tpl) throw new Error('Invalid v2 template JSON');
    return renderEmailTemplate(tpl, { pretty: opts.pretty ?? false });
  }
  return stripFrontmatter(content);
}
