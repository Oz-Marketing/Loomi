/**
 * Markdown → HTML for doc articles.
 *
 * Hand-written rather than `react-markdown` + `remark-gfm` for one reason that
 * matters more than the dependency count: this renderer NEVER passes raw HTML
 * through. Every character of the source is escaped first, and the only tags in
 * the output are ones this file emits. Articles are editable in the app by
 * anyone with `agency.docs.manage`, so "the author is trusted" is an assumption
 * with a shelf life — this way there is no sanitizer to misconfigure.
 *
 * The supported subset is what the library actually uses:
 *
 *   #..#### headings          fenced ``` code blocks     > blockquotes
 *   - / * / 1. lists          | GFM | tables |           --- rules
 *   :::note / :::tip / :::warning callouts
 *   **bold**  *italic*  `code`  [text](url)
 *
 * Anything else renders as literal text, which is the honest failure: an author
 * sees their unsupported syntax on the page and fixes it, instead of it silently
 * disappearing.
 */

export interface RenderedDoc {
  html: string;
  /** Top-level headings, in order — the "on this page" rail. */
  headings: { id: string; text: string }[];
}

const CALLOUTS = {
  note: { label: 'Note', className: 'doc-callout-note' },
  tip: { label: 'Tip', className: 'doc-callout-tip' },
  warning: { label: 'Watch out', className: 'doc-callout-warning' },
} as const;

type CalloutKind = keyof typeof CALLOUTS;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** URL-safe anchor from heading text, deduped by the caller. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Only these schemes become links. A `javascript:` href is the one injection
 * this renderer would otherwise still admit, since the href is author-written
 * text rather than a tag.
 */
function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^https?:\/\//i.test(href)) return href;
  if (/^\/\//.test(href)) return href;
  if (/^\//.test(href)) return href; // in-app link, e.g. /docs/audiences
  if (/^#/.test(href)) return href; // same-page anchor
  if (/^mailto:/i.test(href)) return href;
  return null;
}

/**
 * A sentinel that cannot appear in escaped text — `<` and `&` are already gone
 * by the time it is inserted, and a NUL can't survive the file round-trip. Used
 * to hold code spans out of the way so `**` inside backticks stays literal.
 */
const CODE_MARK = '\u0000';

/** Inline formatting. Runs on ALREADY-ESCAPED text. */
function inline(text: string): string {
  const codes: string[] = [];
  let out = escapeHtml(text).replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(code);
    return `${CODE_MARK}${codes.length - 1}${CODE_MARK}`;
  });

  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
    const safe = safeHref(href);
    if (!safe) return label;
    const external = /^(https?:)?\/\//i.test(safe);
    const attrs = external ? ' target="_blank" rel="noreferrer noopener"' : '';
    return `<a href="${safe}"${attrs}>${label}</a>`;
  });

  out = out
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:)!?]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:)!?]|$)/g, '$1<em>$2</em>');

  return out.replace(
    new RegExp(`${CODE_MARK}(\\d+)${CODE_MARK}`, 'g'),
    (_m, i: string) => `<code>${escapeHtml(codes[Number(i)])}</code>`,
  );
}

const HEADING_RE = /^(#{1,4})\s+(.*)$/;
const FENCE_RE = /^```([a-zA-Z0-9_-]*)\s*$/;
const CALLOUT_OPEN_RE = /^:::(note|tip|warning)\s*$/;
const CALLOUT_CLOSE_RE = /^:::\s*$/;
const RULE_RE = /^\s*(?:-{3,}|\*{3,})\s*$/;
const UL_RE = /^(\s*)[-*]\s+(.*)$/;
const OL_RE = /^(\s*)\d+[.)]\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
const TABLE_DIVIDER_RE = /^\s*\|[\s:|-]+\|\s*$/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function renderMarkdown(markdown: string): RenderedDoc {
  const lines = (markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  const headings: { id: string; text: string }[] = [];
  const usedIds = new Set<string>();
  const paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph.length = 0;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      flushParagraph();
      i++;
      continue;
    }

    // ── fenced code ──
    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushParagraph();
      const lang = fence[1];
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // closing fence
      const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
      html.push(`<pre${langAttr}><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    // ── callout ──
    const callout = CALLOUT_OPEN_RE.exec(line);
    if (callout) {
      flushParagraph();
      const kind = callout[1] as CalloutKind;
      const inner: string[] = [];
      i++;
      while (i < lines.length && !CALLOUT_CLOSE_RE.test(lines[i])) {
        inner.push(lines[i]);
        i++;
      }
      i++; // closing :::
      // Recursion is what lets a callout hold a list or a table, which the
      // "watch out" boxes in the pacing articles need.
      const body = renderMarkdown(inner.join('\n')).html;
      const meta = CALLOUTS[kind];
      html.push(
        `<div class="doc-callout ${meta.className}">` +
          `<p class="doc-callout-label">${meta.label}</p>${body}</div>`,
      );
      continue;
    }

    // ── heading ──
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      const depth = heading[1].length;
      const text = heading[2].trim();
      const base = slugifyHeading(text) || `section-${headings.length + 1}`;
      let id = base;
      let n = 2;
      while (usedIds.has(id)) id = `${base}-${n++}`;
      usedIds.add(id);

      // The page renders the article title as <h1>, so `#` in the body starts at
      // <h2> — otherwise every article has two competing top-level headings.
      const tag = `h${Math.min(depth + 1, 6)}`;
      if (depth === 1) headings.push({ id, text });
      html.push(`<${tag} id="${id}">${inline(text)}</${tag}>`);
      i++;
      continue;
    }

    // ── horizontal rule ──
    if (RULE_RE.test(line)) {
      flushParagraph();
      html.push('<hr />');
      i++;
      continue;
    }

    // ── table ──
    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length && TABLE_DIVIDER_RE.test(lines[i + 1])) {
      flushParagraph();
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map(
          (row) => `<tr>${head.map((_, idx) => `<td>${inline(row[idx] ?? '')}</td>`).join('')}</tr>`,
        )
        .join('')}</tbody>`;
      // Wrapped so a wide table scrolls inside the article instead of widening
      // the page.
      html.push(`<div class="doc-table-wrap"><table>${thead}${tbody}</table></div>`);
      continue;
    }

    // ── blockquote ──
    if (QUOTE_RE.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        quoted.push(QUOTE_RE.exec(lines[i])![1]);
        i++;
      }
      html.push(`<blockquote>${renderMarkdown(quoted.join('\n')).html}</blockquote>`);
      continue;
    }

    // ── list ──
    if (UL_RE.test(line) || OL_RE.test(line)) {
      flushParagraph();
      i = renderList(lines, i, html);
      continue;
    }

    paragraph.push(line.trim());
    i++;
  }

  flushParagraph();
  return { html: html.join('\n'), headings };
}

/**
 * One list, including nested sub-lists, starting at `start`. Returns the index
 * of the first line that isn't part of it.
 *
 * Nesting is measured against the list's OWN first item rather than a fixed
 * width, so a doc indented with two spaces and one indented with four both nest
 * a single level — the thing hand-written renderers usually get wrong.
 */
function renderList(lines: string[], start: number, out: string[]): number {
  const first = UL_RE.exec(lines[start]) ?? OL_RE.exec(lines[start])!;
  const baseIndent = first[1].length;
  const ordered = !UL_RE.test(lines[start]);

  const items: string[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      // A blank line ends the list unless the next line continues it.
      const next = lines[i + 1] ?? '';
      if (!UL_RE.test(next) && !OL_RE.test(next)) break;
      i++;
      continue;
    }

    const match = UL_RE.exec(line) ?? OL_RE.exec(line);
    if (!match) {
      // A lazy continuation: the wrapped remainder of the item above. Blank
      // lines are handled before this, so any non-blank line reaching here
      // directly follows an item and belongs to it.
      //
      // Without this, every list item long enough to wrap in the source ends up
      // as a bullet followed by an orphaned paragraph — which is most of them,
      // since the articles are hard-wrapped.
      // …except for the block openers that unambiguously start something else
      // even without a blank line before them.
      if (items.length === 0) break;
      if (HEADING_RE.test(line) || FENCE_RE.test(line) || CALLOUT_OPEN_RE.test(line)) break;
      items[items.length - 1] += ` ${inline(line.trim())}`;
      i++;
      continue;
    }

    const indent = match[1].length;
    if (indent < baseIndent) break;

    if (indent > baseIndent) {
      // Nested — render into the item already open above it.
      const nested: string[] = [];
      i = renderList(lines, i, nested);
      if (items.length > 0) items[items.length - 1] += nested.join('');
      else items.push(nested.join(''));
      continue;
    }

    items.push(inline(match[2].trim()));
    i++;
  }

  const tag = ordered ? 'ol' : 'ul';
  out.push(`<${tag}>${items.map((item) => `<li>${item}</li>`).join('')}</${tag}>`);
  return i;
}
