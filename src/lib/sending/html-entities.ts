// HTML entity encode/decode shared by the send-time content pipeline.
//
// react-email (like every HTML serializer) writes `&` as `&amp;` inside
// attributes and escapes quotes in text, so anything that reads a URL or a
// merge tag back OUT of rendered HTML has to decode first — the UTM tagger
// once parsed `?make=Honda&amp;model=Accord` as a parameter named
// `amp;model`. Pure and client-safe.
//
// Code points are written as escapes on purpose: several of these characters
// are invisible, and an invisible character in source is one nobody can
// review.

/** Named entities that realistically appear in marketing email HTML. */
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u{a0}',
  ensp: '\u{2002}',
  emsp: '\u{2003}',
  thinsp: '\u{2009}',
  hairsp: '\u{200a}',
  zwnj: '\u{200c}',
  zwj: '\u{200d}',
  lrm: '\u{200e}',
  rlm: '\u{200f}',
  shy: '\u{ad}',
  copy: '\u{a9}',
  reg: '\u{ae}',
  trade: '\u{2122}',
  mdash: '\u{2014}',
  ndash: '\u{2013}',
  hellip: '\u{2026}',
  lsquo: '\u{2018}',
  rsquo: '\u{2019}',
  sbquo: '\u{201a}',
  ldquo: '\u{201c}',
  rdquo: '\u{201d}',
  bdquo: '\u{201e}',
  laquo: '\u{ab}',
  raquo: '\u{bb}',
  bull: '\u{2022}',
  middot: '\u{b7}',
  deg: '\u{b0}',
  plusmn: '\u{b1}',
  times: '\u{d7}',
  divide: '\u{f7}',
  cent: '\u{a2}',
  pound: '\u{a3}',
  euro: '\u{20ac}',
  yen: '\u{a5}',
  sect: '\u{a7}',
  para: '\u{b6}',
  dagger: '\u{2020}',
  Dagger: '\u{2021}',
  permil: '\u{2030}',
  prime: '\u{2032}',
  Prime: '\u{2033}',
  larr: '\u{2190}',
  rarr: '\u{2192}',
  uarr: '\u{2191}',
  darr: '\u{2193}',
  frac12: '\u{bd}',
  frac14: '\u{bc}',
  frac34: '\u{be}',
  sup1: '\u{b9}',
  sup2: '\u{b2}',
  sup3: '\u{b3}',
  iexcl: '\u{a1}',
  iquest: '\u{bf}',
  aacute: '\u{e1}',
  eacute: '\u{e9}',
  iacute: '\u{ed}',
  oacute: '\u{f3}',
  uacute: '\u{fa}',
  Aacute: '\u{c1}',
  Eacute: '\u{c9}',
  Iacute: '\u{cd}',
  Oacute: '\u{d3}',
  Uacute: '\u{da}',
  ntilde: '\u{f1}',
  Ntilde: '\u{d1}',
  uuml: '\u{fc}',
  Uuml: '\u{dc}',
  ouml: '\u{f6}',
  auml: '\u{e4}',
  ccedil: '\u{e7}',
  agrave: '\u{e0}',
  egrave: '\u{e8}',
};

/** U+FFFD, what HTML substitutes for an unusable character reference. */
const REPLACEMENT_CHARACTER = '\u{fffd}';

function fromCodePoint(code: number): string {
  // NUL, surrogates and out-of-range values are parse errors in HTML and
  // become U+FFFD, rather than a lone surrogate that later throws in
  // encodeURIComponent.
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return REPLACEMENT_CHARACTER;
  if (code >= 0xd800 && code <= 0xdfff) return REPLACEMENT_CHARACTER;
  return String.fromCodePoint(code);
}

/**
 * Decode character references. Only the `;`-terminated forms are decoded —
 * a bare `&copy=2` in a hand-written query string is left alone, which is
 * how a browser reads it inside an attribute too. Unknown names survive.
 */
export function decodeHtmlEntities(value: string): string {
  if (!value || !value.includes('&')) return value;
  return value.replace(
    /&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));/g,
    (match, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (dec !== undefined) return fromCodePoint(Number.parseInt(dec, 10));
      if (hex !== undefined) return fromCodePoint(Number.parseInt(hex, 16));
      if (name !== undefined && Object.prototype.hasOwnProperty.call(NAMED, name)) {
        return NAMED[name];
      }
      return match;
    },
  );
}

/** Escape text for an HTML text node or a quoted attribute value. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
