/**
 * Title handling for HTML-only email templates.
 *
 * A v2 template keeps its title in the JSON doc. An HTML template may carry
 * one in a leading `---` frontmatter block, and the library list reads it from
 * there ahead of the `Template.title` column. Many HTML templates have no
 * block at all — for those the column is the only place a name can live.
 */

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/;
const TITLE_LINE = /^title:[ \t]*(.*)$/m;

/** The frontmatter title of an HTML template, if it has one. */
export function readHtmlTemplateTitle(code: string): string | undefined {
  const block = code.match(FRONTMATTER);
  if (!block) return undefined;
  const line = block[1].match(TITLE_LINE);
  if (!line) return undefined;
  const title = line[1].trim().replace(/^["']|["']$/g, '').trim();
  return title || undefined;
}

/**
 * Write `title` into the template's frontmatter block. Returns null when the
 * template has no block — adding one would put stray `---` text in front of
 * the `<!DOCTYPE>`, so callers store the name on the record instead.
 */
export function writeHtmlTemplateTitle(code: string, title: string): string | null {
  const block = code.match(FRONTMATTER);
  if (!block) return null;
  // Quoted, not escaped: every reader of this block strips one quote from
  // each end and nothing more, so an escaped `\"` would surface verbatim.
  const line = `title: "${title.replace(/[\r\n]+/g, ' ').trim()}"`;
  const body = TITLE_LINE.test(block[1])
    ? block[1].replace(TITLE_LINE, () => line)
    : `${line}\n${block[1]}`;
  return code.replace(block[1], () => body);
}
