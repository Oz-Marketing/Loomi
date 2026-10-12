// The text/plain part of a blast, derived from its HTML.
//
// WHY THIS EXISTS
// ───────────────
// The text part used to come from a four-line stripHtml(): delete tags,
// collapse whitespace. On a react-email template that produced one unbroken
// line that opened with the <title>, then the hidden preheader, then ~1,000
// zero-width padding characters, with literal `&#x27;` / `&amp;` / `&#8202;`
// entities throughout and not a single URL — so a reader on a text-only
// client got a wall of noise with no way to act on any button. A text part
// that bad is itself a spam signal.
//
// This walks the markup instead: <head>, <style>, <script>, Outlook
// conditional comments and hidden blocks (the preheader, display:none) are
// dropped; entities are decoded; invisible characters go; block elements
// become line breaks; links keep their URL as "text (url)"; images
// contribute their alt text. Merge tags and SendGrid substitution tokens
// (`[%unsubscribe_url%]`) pass through untouched, so the result can be
// personalized per recipient like the HTML.
//
// Pure: no DOM, no dependencies — it runs in the send worker.

import { decodeHtmlEntities } from '@/lib/sending/html-entities';

/** Never rendered as text, content included. */
const SKIPPED_ELEMENTS = new Set([
  'head', 'title', 'style', 'script', 'noscript', 'template', 'svg', 'object', 'iframe',
]);

/** Content isn't markup — jump straight to the closing tag. */
const RAW_TEXT_ELEMENTS = new Set(['title', 'style', 'script', 'textarea', 'noscript', 'template']);

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

/** A blank line around these. */
const PARAGRAPH_ELEMENTS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'pre',
  'address', 'figure', 'hr', 'dl',
]);

/** A line break around these. Layout tables are most of an email. */
const LINE_ELEMENTS = new Set([
  'div', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'li', 'section',
  'article', 'aside', 'header', 'footer', 'main', 'nav', 'center', 'caption',
  'dt', 'dd', 'figcaption', 'form', 'fieldset', 'body', 'html',
]);

/**
 * Invisible characters: soft hyphen, zero-width space/non-joiner, direction
 * marks and embeddings, word joiners, the BOM. react-email pads every
 * preheader with ~1,000 of these, and the old stripper delivered all of them.
 * ZWJ (U+200D) is handled separately because it also glues emoji sequences
 * together (the family emoji is three people joined by ZWJ).
 */
const INVISIBLE =
  /[\u{ad}\u{34f}\u{61c}\u{115f}\u{1160}\u{17b4}\u{17b5}\u{180e}\u{200b}\u{200c}\u{200e}\u{200f}\u{202a}-\u{202e}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{feff}]/gu;
const ZWJ_OUTSIDE_EMOJI =
  /(?<![\p{Extended_Pictographic}\u{1f3fb}-\u{1f3ff}\u{fe0f}])\u{200d}|\u{200d}(?!\p{Extended_Pictographic})/gu;
/** Typographic spaces that should read as one ordinary space. */
const SPACE_LIKE = /[\u{a0}\u{2000}-\u{200a}\u{202f}\u{205f}\u{3000}]/gu;

interface OpenElement {
  name: string;
  /** This element starts a hidden/skipped region. */
  skip: boolean;
  /** For <a>: the decoded href and where its text began in the output. */
  href?: string;
  linkStart?: number;
}

interface RawTag {
  end: number;
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: string;
}

/** Read one tag starting at `start` (a '<'). Null when it isn't a tag. */
function readTag(html: string, start: number): RawTag | null {
  let i = start + 1;
  const closing = html[i] === '/';
  if (closing) i += 1;
  if (!/[A-Za-z]/.test(html[i] ?? '')) return null;
  let nameEnd = i;
  while (nameEnd < html.length && /[A-Za-z0-9:-]/.test(html[nameEnd])) nameEnd += 1;
  const name = html.slice(i, nameEnd).toLowerCase();

  let quote: string | null = null;
  let j = nameEnd;
  for (; j < html.length; j += 1) {
    const ch = html[j];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      break;
    }
  }
  if (j >= html.length) return null;
  const attrs = html.slice(nameEnd, j);
  return { end: j + 1, name, closing, selfClosing: /\/\s*$/.test(attrs), attrs };
}

function parseAttributes(attrs: string): Record<string, string> {
  // No prototype: an attribute named "constructor" must not collide with one.
  const out = Object.create(null) as Record<string, string>;
  const pattern = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of attrs.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (name in out) continue;
    out[name] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return out;
}

function isHiddenStyle(style: string): boolean {
  const s = style.toLowerCase().replace(/\s+/g, '');
  if (/(?:^|;)display:none/.test(s)) return true;
  if (/(?:^|;)visibility:hidden/.test(s)) return true;
  const zeroHeight = /(?:^|;)max-height:0(?:px)?(?:;|!|$)/.test(s);
  const zeroFont = /(?:^|;)font-size:0(?:px)?(?:;|!|$)/.test(s);
  if (zeroHeight && /(?:^|;)overflow:hidden/.test(s)) return true;
  if (/(?:^|;)opacity:0(?:;|!|$)/.test(s) && (zeroHeight || zeroFont)) return true;
  return false;
}

/** The preheader and anything else a reader never sees. */
function isHiddenElement(name: string, attrs: Record<string, string>): boolean {
  if (SKIPPED_ELEMENTS.has(name)) return true;
  // react-email marks its <Preview> block this way for exactly this purpose.
  if ('data-skip-in-text' in attrs && attrs['data-skip-in-text'] !== 'false') return true;
  if ('hidden' in attrs) return true;
  if (attrs['aria-hidden'] === 'true') return true;
  if (/(?:^|\s)preheader(?:\s|$)/i.test(attrs.class ?? '')) return true;
  return isHiddenStyle(attrs.style ?? '');
}

function normalizeForCompare(value: string): string {
  return value
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:www\.)?/, '')
    .replace(/\/+$/, '')
    .trim();
}

/**
 * What to print after a link's text. '' when the URL adds nothing: an
 * in-page or dead link, or text that already IS the URL / phone number.
 */
function linkTarget(href: string, text: string): string {
  if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return '';
  let shown = href;
  if (/^mailto:/i.test(href)) shown = href.slice(7).split('?')[0];
  else if (/^tel:/i.test(href)) shown = href.slice(4);
  if (!shown.trim()) return '';
  if (text) {
    const t = normalizeForCompare(text);
    if (t === normalizeForCompare(shown) || t === normalizeForCompare(href)) return '';
    if (/^tel:/i.test(href)) {
      const digits = shown.replace(/\D/g, '');
      if (digits.length >= 7 && text.replace(/\D/g, '').endsWith(digits.slice(-10))) return '';
    }
  }
  return shown;
}

/**
 * Convert email HTML into a readable text/plain body.
 *
 * Links render as "text (url)", so `<a href="https://x.com">Book now</a>`
 * becomes `Book now (https://x.com)`; a link whose text is the URL prints it
 * once. Images contribute their alt text. `[%unsubscribe_url%]` and
 * `{{…}}` tags are left exactly as written.
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  const lower = html.toLowerCase();
  const stack: OpenElement[] = [];
  let skipping = 0;
  let out = '';

  const trimTrailingSpaces = () => {
    let end = out.length;
    while (end > 0 && out[end - 1] === ' ') end -= 1;
    if (end !== out.length) out = out.slice(0, end);
  };

  const ensureNewlines = (count: number) => {
    trimTrailingSpaces();
    if (!out) return;
    let have = 0;
    while (have < out.length && out[out.length - 1 - have] === '\n') have += 1;
    for (let i = have; i < count; i += 1) out += '\n';
  };

  const pushText = (raw: string) => {
    let text = raw;
    if (!text) return;
    if (!out || out.endsWith('\n')) text = text.replace(/^ +/, '');
    else if (out.endsWith(' ') && text.startsWith(' ')) text = text.slice(1);
    out += text;
  };

  const handleText = (raw: string) => {
    if (skipping > 0) return;
    const text = decodeHtmlEntities(raw)
      .replace(INVISIBLE, '')
      .replace(ZWJ_OUTSIDE_EMOJI, '')
      .replace(SPACE_LIKE, ' ')
      .replace(/\s+/g, ' ');
    pushText(text);
  };

  const closeElement = (element: OpenElement) => {
    if (element.skip) {
      skipping -= 1;
      return;
    }
    if (skipping > 0) return;
    if (element.name === 'a' && element.linkStart !== undefined) {
      const linkText = out.slice(element.linkStart).replace(/\s+/g, ' ').trim();
      const target = linkTarget(element.href ?? '', linkText);
      if (target) pushText(linkText ? ` (${target})` : ` ${target}`);
      return;
    }
    if (PARAGRAPH_ELEMENTS.has(element.name)) ensureNewlines(2);
    else if (LINE_ELEMENTS.has(element.name)) ensureNewlines(1);
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      handleText(html.slice(i));
      break;
    }
    if (lt > i) handleText(html.slice(i, lt));

    // Comments, including Outlook's <!--[if mso]> … <![endif]--> blocks,
    // which carry VML buttons and hair-space padding nobody should read.
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    // <!DOCTYPE …>, <![CDATA[ … ]]>, <?xml … ?>
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    const tag = readTag(html, lt);
    if (!tag) {
      handleText('<');
      i = lt + 1;
      continue;
    }
    i = tag.end;

    if (tag.closing) {
      let index = -1;
      for (let s = stack.length - 1; s >= 0; s -= 1) {
        if (stack[s].name === tag.name) {
          index = s;
          break;
        }
      }
      // An element closed out of order closes everything opened inside it.
      if (index !== -1) {
        while (stack.length > index) closeElement(stack.pop()!);
      }
      continue;
    }

    const attrs = parseAttributes(tag.attrs);
    const hidden = isHiddenElement(tag.name, attrs);

    if (VOID_ELEMENTS.has(tag.name) || tag.selfClosing) {
      if (skipping > 0 || hidden) continue;
      if (tag.name === 'br') {
        trimTrailingSpaces();
        out += '\n';
      } else if (tag.name === 'hr') {
        ensureNewlines(2);
      } else if (tag.name === 'img') {
        const alt = (attrs.alt ?? '').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
        // Tracking pixels have no alt and a 1×1 box; either way, nothing to say.
        const pixel = attrs.width === '1' || attrs.height === '1' || attrs.width === '0';
        if (alt && !pixel) pushText(` ${alt} `);
      }
      continue;
    }

    const element: OpenElement = { name: tag.name, skip: hidden };
    stack.push(element);
    if (hidden) {
      skipping += 1;
    } else if (skipping === 0) {
      if (tag.name === 'a') {
        element.href = (attrs.href ?? '').trim();
        element.linkStart = out.length;
      } else if (tag.name === 'li') {
        ensureNewlines(1);
        pushText('- ');
      } else if (PARAGRAPH_ELEMENTS.has(tag.name)) {
        ensureNewlines(2);
      } else if (LINE_ELEMENTS.has(tag.name)) {
        ensureNewlines(1);
      }
    }

    // Raw-text elements can't contain markup; their closing tag is next.
    if (RAW_TEXT_ELEMENTS.has(tag.name)) {
      const close = lower.indexOf(`</${tag.name}`, i);
      if (close === -1) {
        i = html.length;
      } else {
        if (!hidden && skipping === 0) handleText(html.slice(i, close));
        i = close;
      }
    }
  }
  while (stack.length > 0) closeElement(stack.pop()!);

  return out
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
