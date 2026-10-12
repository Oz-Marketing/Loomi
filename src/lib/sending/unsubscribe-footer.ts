// Build the CAN-SPAM-compliant unsubscribe footer for a sub-account.
//
// CAN-SPAM (US) + CASL (Canada) require:
//   1. A working unsubscribe mechanism that lives through every send.
//   2. The sender's valid physical mailing address.
//   3. Clear "from" identity (handled at the from-header level).
//
// SendGrid handles only the LINK mechanics — it swaps a substitution tag
// for a hosted unsubscribe URL at delivery. It does NOT append this footer
// for us: subscription_tracking's documented behaviour is that supplying
// `substitution_tag` OVERRIDES the `text`/`html` append entirely. We passed
// all three for months, so the append never happened and the postal address
// never reached an inbox. So injecting the footer into the body is OUR job,
// via injectUnsubscribeFooter() below, and SendGrid is left responsible for
// exactly one thing: turning [%unsubscribe_url%] into a real URL.
//
// The footer is intentionally plain: any branding/styling that conflicts
// with a campaign's design template is a deliverability + UX risk.

export interface UnsubscribeFooterInput {
  /** Sub-account display name; shown above the address. */
  dealer: string;
  /** Street address (e.g. "123 Main St"). */
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

export interface UnsubscribeFooter {
  /** HTML to inject into the email's body (e.g. via a footer block). */
  html: string;
  /** Plain-text equivalent for the text/plain part. */
  text: string;
}

/**
 * SendGrid's substitution tag for the hosted, per-recipient unsubscribe URL.
 * Must match the `substitution_tag` passed in lib/sending/sendgrid.ts and
 * whatever {{unsubscribe_link}} resolves to in lib/sending/blast-mergetags.ts.
 */
export const UNSUBSCRIBE_TOKEN = '[%unsubscribe_url%]';

/** Does this body already carry an unsubscribe link the designer placed? */
export function hasUnsubscribeToken(body: string): boolean {
  return body.includes(UNSUBSCRIBE_TOKEN);
}

// ── Per-account styling ────────────────────────────────────────────────
//
// Accounts style this block, but they do NOT author it. The dealer name,
// the postal address, and the unsubscribe link are emitted by the renderer
// and cannot be configured away — a free-text HTML box here would be one
// paste away from re-creating the exact non-compliance this module was
// written to fix. So the config carries presentation plus two copy strings,
// and nothing that can drop a required element.
//
// Values arrive from the database (and eventually a settings form), so
// treat every field as untrusted: resolveFooterConfig() clamps and
// validates, and renderers escape the copy.

export type FooterAlign = 'left' | 'center' | 'right';

export interface UnsubscribeFooterConfig {
  fontFamily: string;
  fontSizePx: number;
  textColor: string;
  linkColor: string;
  /** null renders transparent, inheriting the template's background. */
  backgroundColor: string | null;
  align: FooterAlign;
  showTopBorder: boolean;
  borderColor: string;
  spacingTopPx: number;
  paddingXPx: number;
  /** Opt-in sentence. `{dealer}` is replaced with the account name. */
  optInLine: string;
  /** Anchor text for the unsubscribe link. */
  unsubscribeLabel: string;
}

/** Today's shipped appearance. Any account with no config renders this. */
export const DEFAULT_FOOTER_CONFIG: UnsubscribeFooterConfig = {
  fontFamily: 'Helvetica,Arial,sans-serif',
  fontSizePx: 11,
  textColor: '#6b7280',
  linkColor: '#6b7280',
  backgroundColor: null,
  align: 'center',
  showTopBorder: true,
  borderColor: '#e5e7eb',
  spacingTopPx: 32,
  paddingXPx: 16,
  optInLine: "You're receiving this email because you opted in with {dealer}.",
  unsubscribeLabel: 'Unsubscribe',
};

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
/** Font stacks reach a `style` attribute, so allow only name-ish characters. */
const FONT_STACK = /^[a-zA-Z0-9 ,'"-]+$/;
const ALIGNS: FooterAlign[] = ['left', 'center', 'right'];

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR.test(value.trim())
    ? value.trim()
    : fallback;
}

function px(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function copyLine(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

/**
 * Merge a stored (partial, possibly hostile) config over the defaults.
 *
 * Every field is validated rather than trusted: a bad hex value, a font
 * stack carrying a quote that would break out of the style attribute, or a
 * 900px font size all fall back to the default instead of shipping. Callers
 * can therefore render the result without further checks.
 */
export function resolveFooterConfig(
  stored?: Partial<UnsubscribeFooterConfig> | null,
): UnsubscribeFooterConfig {
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_FOOTER_CONFIG };
  const d = DEFAULT_FOOTER_CONFIG;

  const fontFamily =
    typeof stored.fontFamily === 'string' && FONT_STACK.test(stored.fontFamily.trim())
      ? stored.fontFamily.trim()
      : d.fontFamily;

  const backgroundColor =
    stored.backgroundColor === null
      ? null
      : typeof stored.backgroundColor === 'string'
          && HEX_COLOR.test(stored.backgroundColor.trim())
        ? stored.backgroundColor.trim()
        : d.backgroundColor;

  return {
    fontFamily,
    fontSizePx: px(stored.fontSizePx, d.fontSizePx, 8, 24),
    textColor: color(stored.textColor, d.textColor),
    linkColor: color(stored.linkColor, d.linkColor),
    backgroundColor,
    align:
      typeof stored.align === 'string' && ALIGNS.includes(stored.align as FooterAlign)
        ? (stored.align as FooterAlign)
        : d.align,
    showTopBorder:
      typeof stored.showTopBorder === 'boolean' ? stored.showTopBorder : d.showTopBorder,
    borderColor: color(stored.borderColor, d.borderColor),
    spacingTopPx: px(stored.spacingTopPx, d.spacingTopPx, 0, 96),
    paddingXPx: px(stored.paddingXPx, d.paddingXPx, 0, 48),
    optInLine: copyLine(stored.optInLine, d.optInLine, 300),
    unsubscribeLabel: copyLine(stored.unsubscribeLabel, d.unsubscribeLabel, 60),
  };
}

// ── Legibility ─────────────────────────────────────────────────────────
//
// resolveFooterConfig() only checks that a color is well-formed hex, so a
// footer could be configured with its text color equal to its background —
// a valid config that renders the postal address and the unsubscribe link
// invisible, which is a CAN-SPAM problem wearing a style setting. The colors
// are therefore checked against the background at RENDER time: below the
// minimum contrast the default colors are used instead, and preflight warns
// (footerContrastProblems) so the account can fix the setting.

/** WCAG's floor for large or bold text; footer copy must clear at least this. */
export const MIN_FOOTER_CONTRAST = 3;

/** A transparent footer sits on the template, which is assumed light. */
const ASSUMED_BACKGROUND = '#ffffff';

function hexToRgb(hex: string): [number, number, number] | null {
  const value = hex.trim().replace(/^#/, '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two hex colors (1–21); null when unreadable. */
export function contrastRatio(foreground: string, background: string): number | null {
  const fg = hexToRgb(foreground);
  const bg = hexToRgb(background);
  if (!fg || !bg) return null;
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function legibleColor(color: string, fallback: string, background: string): string {
  if ((contrastRatio(color, background) ?? 0) >= MIN_FOOTER_CONTRAST) return color;
  if ((contrastRatio(fallback, background) ?? 0) >= MIN_FOOTER_CONTRAST) return fallback;
  // Even the default disappears on this background: pick whichever of black
  // and white reads.
  return (contrastRatio('#000000', background) ?? 0) >= (contrastRatio('#ffffff', background) ?? 0)
    ? '#000000'
    : '#ffffff';
}

export interface FooterContrastProblem {
  field: 'textColor' | 'linkColor';
  color: string;
  background: string;
  ratio: number;
}

/**
 * The footer colors that are too close to their background to read. Empty
 * when the config is legible. Takes a stored (partial) config or a resolved
 * one.
 */
export function footerContrastProblems(
  stored?: Partial<UnsubscribeFooterConfig> | null,
): FooterContrastProblem[] {
  const cfg = resolveFooterConfig(stored);
  const background = cfg.backgroundColor ?? ASSUMED_BACKGROUND;
  const problems: FooterContrastProblem[] = [];
  for (const field of ['textColor', 'linkColor'] as const) {
    const ratio = contrastRatio(cfg[field], background);
    if (ratio !== null && ratio < MIN_FOOTER_CONTRAST) {
      problems.push({ field, color: cfg[field], background, ratio: Math.round(ratio * 100) / 100 });
    }
  }
  return problems;
}

function formatAddressLine(input: UnsubscribeFooterInput): string {
  const lineCity = [input.city, input.state].filter(Boolean).join(', ');
  return [input.address, lineCity, input.postalCode].filter(Boolean).join(' · ');
}

export interface BuildUnsubscribeFooterOptions {
  /**
   * Render the unsubscribe line. Pass false when the template already
   * wired its own {{unsubscribe_link}} — the address still has to ship,
   * but a second link next to the designer's reads like a bug. Defaults
   * to true.
   */
  includeUnsubscribeLink?: boolean;
  /**
   * The same decision for the text/plain part, which can differ: a designer
   * who placed an unsubscribe button in the HTML has not necessarily put the
   * URL in the text part. Defaults to `includeUnsubscribeLink`.
   */
  includeTextUnsubscribeLink?: boolean;
  /**
   * Per-account styling. Omit for the default appearance; a partial is
   * merged over the defaults and validated by resolveFooterConfig().
   */
  config?: Partial<UnsubscribeFooterConfig> | null;
}

/**
 * Build the footer for a given sub-account. Always returns a footer
 * (even when the address fields are missing) so the unsubscribe link
 * is guaranteed to render; missing-address mode shows just the dealer
 * name + unsubscribe line and warrants a settings nag elsewhere.
 */
export function buildUnsubscribeFooter(
  input: UnsubscribeFooterInput,
  options: BuildUnsubscribeFooterOptions = {},
): UnsubscribeFooter {
  const includeLink = options.includeUnsubscribeLink !== false;
  const includeTextLink = options.includeTextUnsubscribeLink ?? includeLink;
  const cfg = resolveFooterConfig(options.config);
  const background = cfg.backgroundColor ?? ASSUMED_BACKGROUND;
  const textColor = legibleColor(cfg.textColor, DEFAULT_FOOTER_CONFIG.textColor, background);
  const linkColor = legibleColor(cfg.linkColor, DEFAULT_FOOTER_CONFIG.linkColor, background);
  const dealer = input.dealer || 'This sender';
  const dealerSafe = escapeHtml(dealer);
  const address = formatAddressLine(input);
  const addressSafe = escapeHtml(address);

  // The opt-in line is account-authored, so escape it BEFORE substituting
  // {dealer} — otherwise an apostrophe in the copy is fine but a stray
  // angle bracket would break the markup.
  const optInHtml = escapeHtml(cfg.optInLine).replace(
    /\{dealer\}/g,
    `<strong>${dealerSafe}</strong>`,
  );
  const optInText = cfg.optInLine.replace(/\{dealer\}/g, dealer);
  const labelSafe = escapeHtml(cfg.unsubscribeLabel);

  const tableStyle = [
    `margin-top:${cfg.spacingTopPx}px`,
    cfg.showTopBorder ? `border-top:1px solid ${cfg.borderColor}` : '',
    'padding-top:16px',
    cfg.backgroundColor ? `background-color:${cfg.backgroundColor}` : '',
  ].filter(Boolean).join(';');

  const cellStyle = [
    `font-family:${cfg.fontFamily}`,
    `font-size:${cfg.fontSizePx}px`,
    'line-height:1.6',
    `color:${textColor}`,
    `text-align:${cfg.align}`,
    `padding:0 ${cfg.paddingXPx}px`,
  ].join(';');

  const html = [
    `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="${tableStyle};">`,
    `<tr><td style="${cellStyle};">`,
    `<p style="margin:0 0 6px;">${optInHtml}</p>`,
    address
      ? `<p style="margin:0${includeLink ? ' 0 6px' : ''};">${addressSafe}</p>`
      : '',
    // ONE link, and it says exactly what it does. This used to read
    // "Unsubscribe or manage your preferences" with both anchors pointing at
    // the same token — so "manage your preferences" dumped the recipient
    // straight onto SendGrid's one-click unsubscribe page. There is no
    // preference center yet (that needs either SendGrid ASM groups or a
    // hosted page of our own); promising one in the footer is worse than
    // not having it.
    includeLink
      ? `<p style="margin:0;"><a href="${UNSUBSCRIBE_TOKEN}" style="color:${linkColor};text-decoration:underline;">${labelSafe}</a></p>`
      : '',
    '</td></tr></table>',
  ].filter(Boolean).join('');

  const text = [
    optInText,
    address || '',
    includeTextLink ? `${cfg.unsubscribeLabel}: ${UNSUBSCRIBE_TOKEN}` : '',
  ].filter(Boolean).join('\n');

  return { html, text };
}

/**
 * Append the compliance footer to a rendered message body.
 *
 * This is the ONLY thing that puts the postal address in front of a
 * recipient — see the note at the top of this file about why SendGrid's
 * own append never fires. Call it on the final, mergetag-substituted body
 * so the "did the designer already place a link?" check sees the same
 * `[%unsubscribe_url%]` the recipient will get.
 *
 * The HTML footer goes inside </body> when there is one, so it lands within
 * the document rather than after it.
 *
 * The two parts are decided SEPARATELY. A designer's {{unsubscribe_link}}
 * button lives in the HTML; whether the text part carries the URL depends on
 * how that part was made. Deciding both from "either part has the token"
 * used to leave a text part with no unsubscribe URL at all whenever the
 * designer placed the link — so the text part now gets the footer's link
 * unless it already has the token itself.
 */
export function injectUnsubscribeFooter(input: {
  html: string;
  text: string;
  account: UnsubscribeFooterInput;
  /** Per-account styling; omit for the default appearance. */
  config?: Partial<UnsubscribeFooterConfig> | null;
  /**
   * Force the unsubscribe line off.
   *
   * Only for transports that cannot turn [%unsubscribe_url%] into a real
   * URL. SendGrid does it with subscription_tracking's substitution_tag;
   * the SMTP fallback has no equivalent, so the link would reach the inbox
   * as literal token text. The postal address still ships either way.
   *
   * Omit for the default, which is what blasts and flows want: render the
   * link unless the designer already placed their own. Passing true behaves
   * like omitting it — the override can only ever REMOVE the link, never
   * add a second one beside the designer's.
   */
  includeUnsubscribeLink?: boolean;
}): { html: string; text: string } {
  const forcedOff = input.includeUnsubscribeLink === false;
  const footer = buildUnsubscribeFooter(input.account, {
    includeUnsubscribeLink: !forcedOff && !hasUnsubscribeToken(input.html),
    includeTextUnsubscribeLink: !forcedOff && !hasUnsubscribeToken(input.text),
    config: input.config,
  });

  const closingBody = input.html.toLowerCase().lastIndexOf('</body>');
  const html =
    closingBody === -1
      ? input.html + footer.html
      : input.html.slice(0, closingBody)
        + footer.html
        + input.html.slice(closingBody);

  const text = input.text
    ? `${input.text}\n\n${footer.text}`
    : footer.text;

  return { html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
