import { parseV2Template } from './types';

/**
 * Write a renamed title back into stored template content — the place the
 * library list reads it from (`api/templates`).
 *
 *  - v2 JSON → the doc's `title` field. Prefixing a `---` block here would
 *    stop the content parsing as v2, so the template would render its own
 *    JSON as text and drop out of the visual builder.
 *  - HTML    → a leading `title:` frontmatter line, added if absent. The block
 *    is metadata only; `compileTemplateContent` strips it before preview/send.
 */
export function updateLibraryTemplateTitle(raw: string, title: string): string {
  const v2 = parseV2Template(raw);
  if (v2) return JSON.stringify({ ...v2, title: title.trim() }, null, 2);

  const nextTitle = JSON.stringify(title.trim());
  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/);

  if (!frontmatterMatch) {
    return `---\ntitle: ${nextTitle}\n---\n\n${raw}`;
  }

  const existingFrontmatter = frontmatterMatch[1];
  const hasTitle = /^title:\s*.*$/m.test(existingFrontmatter);
  const updatedFrontmatter = hasTitle
    ? existingFrontmatter.replace(/^title:\s*.*$/m, `title: ${nextTitle}`)
    : `title: ${nextTitle}\n${existingFrontmatter}`;
  const rest = raw.slice(frontmatterMatch[0].length);

  return `---\n${updatedFrontmatter}\n---\n${rest}`;
}
