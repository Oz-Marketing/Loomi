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

function formatAddressLine(input: UnsubscribeFooterInput): string {
  const lineCity = [input.city, input.state].filter(Boolean).join(', ');
  return [input.address, lineCity, input.postalCode].filter(Boolean).join(' · ');
}

export interface BuildUnsubscribeFooterOptions {
  /**
   * Render the "Unsubscribe or manage your preferences" line. Pass false
   * when the template already wired its own {{unsubscribe_link}} — the
   * address still has to ship, but a second link next to the designer's
   * reads like a bug. Defaults to true.
   */
  includeUnsubscribeLink?: boolean;
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
  const dealerSafe = escapeHtml(input.dealer || 'This sender');
  const address = formatAddressLine(input);
  const addressSafe = escapeHtml(address);

  const html = [
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:32px;border-top:1px solid #e5e7eb;padding-top:16px;">',
    '<tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:#6b7280;text-align:center;padding:0 16px;">',
    `<p style="margin:0 0 6px;">You\'re receiving this email because you opted in with <strong>${dealerSafe}</strong>.</p>`,
    address
      ? `<p style="margin:0${includeLink ? ' 0 6px' : ''};">${addressSafe}</p>`
      : '',
    includeLink
      ? `<p style="margin:0;"><a href="${UNSUBSCRIBE_TOKEN}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a> or <a href="${UNSUBSCRIBE_TOKEN}" style="color:#6b7280;text-decoration:underline;">manage your preferences</a>.</p>`
      : '',
    '</td></tr></table>',
  ].filter(Boolean).join('');

  const text = [
    `You're receiving this email because you opted in with ${input.dealer || 'this sender'}.`,
    address || '',
    includeLink ? `Unsubscribe: ${UNSUBSCRIBE_TOKEN}` : '',
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
 */
export function injectUnsubscribeFooter(input: {
  html: string;
  text: string;
  account: UnsubscribeFooterInput;
}): { html: string; text: string } {
  const alreadyLinked =
    hasUnsubscribeToken(input.html) || hasUnsubscribeToken(input.text);
  const footer = buildUnsubscribeFooter(input.account, {
    includeUnsubscribeLink: !alreadyLinked,
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
