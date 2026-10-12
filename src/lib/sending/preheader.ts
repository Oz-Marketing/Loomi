// The inbox preview snippet ("preheader") of an email.
//
// WHY THIS EXISTS
// ───────────────
// A blast's own preview text used to be injected right after <body> as a
// second hidden <div>, without escaping, while the template's react-email
// <Preview> block (lib/email/Document.tsx) was left in place. The inbox shows
// the first text it finds, so the snippet read "<blast preview text>
// <template preheader>" and an apostrophe or `&` in the copy went out raw.
// applyPreviewText() REPLACES the template's preheader when there is one and
// only injects when there isn't, always escaped and padded.
//
// Pure and client-safe — Document.tsx renders through truncatePreheader().

import { escapeHtml } from '@/lib/sending/html-entities';

/** react-email's own cap; its <Preview> pads up to this length. */
export const PREHEADER_MAX_LENGTH = 150;

/**
 * react-email's padding unit: no-break space, ZWNJ, ZWSP, ZWJ, LRM, RLM, BOM.
 * Invisible in the inbox, but it fills the snippet so the client doesn't
 * pull the first lines of the body in after the preview text.
 */
export const PREHEADER_SPACER_UNIT = '\u{a0}\u{200c}\u{200b}\u{200d}\u{200e}\u{200f}\u{feff}';

/** A merge tag counts as roughly what it renders to, not as its source. */
const ASSUMED_TAG_LENGTH = 10;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Cap a preheader at `max` UTF-16 units without breaking it.
 *
 * react-email's <Preview> cuts at 150 with a plain substring, and the
 * template is rendered BEFORE merge tags are filled — so a long preheader
 * could be cut mid-`{{contact.first_name}}` (leaving `{{contact.fir` to ship
 * literally) or between the two halves of an emoji. This cuts before a tag
 * that would straddle the limit and never between a surrogate pair. Passing
 * the result to <Preview> makes its own cut a no-op.
 */
export function truncatePreheader(text: string, max: number = PREHEADER_MAX_LENGTH): string {
  if (!text || text.length <= max) return text;
  let cut = max;
  if (isHighSurrogate(text.charCodeAt(cut - 1))) cut -= 1;
  const open = text.lastIndexOf('{{', cut - 1);
  if (open !== -1) {
    const close = text.indexOf('}}', open);
    if (close === -1 || close + 2 > cut) cut = open;
  }
  return text.slice(0, cut).trimEnd();
}

function spacerFor(text: string): string {
  const visible = text.replace(/\{\{[^{}]*\}\}/g, 'x'.repeat(ASSUMED_TAG_LENGTH)).length;
  return PREHEADER_SPACER_UNIT.repeat(Math.max(0, PREHEADER_MAX_LENGTH - visible));
}

/** react-email's <Preview>: `<div … data-skip-in-text="true">TEXT<div>PAD</div></div>`. */
const REACT_EMAIL_PREVIEW =
  /(<div\b[^>]*\bdata-skip-in-text\s*=\s*(["'])true\2[^>]*>)([^<]*)(?:<div\b[^>]*>[^<]*<\/div>)?(\s*<\/div>)/i;

/** A hand-built preheader in an HTML template: `<span class="preheader">…</span>`. */
const CLASS_PREHEADER =
  /(<(div|span|p)\b[^>]*\bclass\s*=\s*(["'])(?:[^"']*\s)?preheader(?:\s[^"']*)?\3[^>]*>)([^<]*)(<\/\2>)/i;

/**
 * Put `previewText` in the inbox snippet.
 *
 * An empty preview text leaves the template's own preheader alone. The text is
 * HTML-escaped; merge tags inside it survive (their quotes are decoded again
 * when the tags are parsed) and are filled per recipient like the body.
 */
export function applyPreviewText(
  html: string,
  previewText: string | null | undefined,
): string {
  const text = (previewText ?? '').replace(/\s+/g, ' ').trim();
  if (!html || !text) return html;

  const escaped = escapeHtml(text);
  const spacer = spacerFor(text);

  if (REACT_EMAIL_PREVIEW.test(html)) {
    return html.replace(
      REACT_EMAIL_PREVIEW,
      (_match, open: string, _quote: string, _old: string, close: string) =>
        `${open}${escaped}${spacer ? `<div>${spacer}</div>` : ''}${close}`,
    );
  }

  if (CLASS_PREHEADER.test(html)) {
    return html.replace(
      CLASS_PREHEADER,
      (_match, open: string, _tag: string, _quote: string, _old: string, close: string) =>
        `${open}${escaped}${spacer}${close}`,
    );
  }

  // `mso-hide:all` because older Outlook ignores display:none on a div.
  const block =
    '<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;mso-hide:all" data-skip-in-text="true">'
    + `${escaped}${spacer ? `<div>${spacer}</div>` : ''}</div>`;
  if (/<body\b[^>]*>/i.test(html)) {
    return html.replace(/<body\b[^>]*>/i, (bodyTag) => `${bodyTag}${block}`);
  }
  return `${block}${html}`;
}
