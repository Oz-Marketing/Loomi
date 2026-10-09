/**
 * Reading rendered email HTML the way a compliance rule needs to.
 *
 * Regex, not a DOM: the input is react-email's own output, whose shape is known
 * and flat enough (anchors never nest, styles are inline), and the rules have to
 * run anywhere `npm test` does without pulling a parser into the bundle.
 *
 * Pure.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  reg: '®',
  trade: '™',
  copy: '©',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * Characters that render as nothing. react-email pads the hidden preheader with
 * hundreds of them, and a copied disclaimer can carry a stray one.
 */
const INVISIBLE = /[\u00ad\u034f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufeff]/g;

/** Whitespace as a reader sees it: every run is one space. */
export function collapseWhitespace(s: string): string {
  return s.replace(INVISIBLE, '').replace(/[\s\u00a0]+/g, ' ').trim();
}

/** Markup → the text it displays. For a fragment (a block's text prop) or a document. */
export function stripTags(s: string): string {
  return collapseWhitespace(decodeEntities(s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ')));
}

/** Everything inside `<body>` a reader could see, as one collapsed string. */
export function visibleText(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ');
  return stripTags(body);
}

export interface Anchor {
  /** 1-based, in document order — "link 3" in a finding. */
  index: number;
  /** Entity-decoded, so it parses as a URL. */
  href: string;
  /** The text it shows. Empty for an image link. */
  text: string;
  /** The anchor's inline `style`, or ''. */
  style: string;
  /** The anchor's inner HTML, for spotting an image-only link. */
  inner: string;
}

function attr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  if (!m) return null;
  return decodeEntities(m[2] ?? m[3] ?? '');
}

/** Every `<a href>`, in order. Comments (the MSO conditionals) are dropped first. */
export function anchors(html: string): Anchor[] {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  const out: Anchor[] = [];
  for (const m of clean.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1], 'href');
    if (href === null) continue;
    out.push({
      index: out.length + 1,
      href: href.trim(),
      text: stripTags(m[2]),
      style: attr(m[1], 'style') ?? '',
      inner: m[2],
    });
  }
  return out;
}

/** An anchor that wraps an image and nothing a reader can see as text. */
export function isImageOnlyLink(a: Pick<Anchor, 'inner' | 'text'>): boolean {
  return a.text === '' && /<img\b/i.test(a.inner);
}

/** `prop: value` pairs of one inline style string, props lowercased. */
export function parseStyle(style: string): { prop: string; value: string }[] {
  return style
    .split(';')
    .map((decl) => {
      const i = decl.indexOf(':');
      if (i === -1) return null;
      return { prop: decl.slice(0, i).trim().toLowerCase(), value: decl.slice(i + 1).trim() };
    })
    .filter((d): d is { prop: string; value: string } => Boolean(d?.prop && d.value));
}

export interface StyleDeclaration {
  tag: string;
  prop: string;
  value: string;
}

/**
 * Every inline declaration in `<body>`, plus legacy `bgcolor` / `color`
 * attributes as if they were declarations.
 *
 * One exclusion: `color` on an image-only link. react-email's `Link` sets
 * `color:#067df7` on every anchor, including the one around a hero image, where
 * no text exists to take the color. Counting it would fail every Honda and Kia
 * draft on a blue nobody can see.
 */
export function styleDeclarations(html: string): StyleDeclaration[] {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ');

  // Offsets of the opening `<a` of every image-only link.
  const imageOnlyAt = new Set<number>();
  for (const m of body.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (isImageOnlyLink({ inner: m[1], text: stripTags(m[1]) })) imageOnlyAt.add(m.index ?? -1);
  }

  const out: StyleDeclaration[] = [];
  for (const m of body.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const style = attr(attrs, 'style');
    if (style) {
      const skipColor = tag === 'a' && imageOnlyAt.has(m.index ?? -2);
      for (const d of parseStyle(style)) {
        if (skipColor && d.prop === 'color') continue;
        out.push({ tag, ...d });
      }
    }
    const bgcolor = attr(attrs, 'bgcolor');
    if (bgcolor) out.push({ tag, prop: 'background-color', value: bgcolor });
    const color = tag === 'font' ? attr(attrs, 'color') : null;
    if (color) out.push({ tag, prop: 'color', value: color });
  }
  return out;
}
