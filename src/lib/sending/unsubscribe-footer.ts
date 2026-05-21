// Build the CAN-SPAM-compliant unsubscribe footer for a sub-account.
//
// CAN-SPAM (US) + CASL (Canada) require:
//   1. A working unsubscribe mechanism that lives through every send.
//   2. The sender's valid physical mailing address.
//   3. Clear "from" identity (handled at the from-header level).
//
// SendGrid handles the unsubscribe link mechanics — they swap a
// substitution tag for a hosted unsubscribe URL. Our job is to:
//   - Render the surrounding footer copy + physical address
//   - Place the [%unsubscribe_url%] token where the link should go
//   - Provide both HTML and text/plain variants
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

const UNSUBSCRIBE_TOKEN = '[%unsubscribe_url%]';

function formatAddressLine(input: UnsubscribeFooterInput): string {
  const lineCity = [input.city, input.state].filter(Boolean).join(', ');
  return [input.address, lineCity, input.postalCode].filter(Boolean).join(' · ');
}

/**
 * Build the footer for a given sub-account. Always returns a footer
 * (even when the address fields are missing) so the unsubscribe link
 * is guaranteed to render; missing-address mode shows just the dealer
 * name + unsubscribe line and warrants a settings nag elsewhere.
 */
export function buildUnsubscribeFooter(
  input: UnsubscribeFooterInput,
): UnsubscribeFooter {
  const dealerSafe = escapeHtml(input.dealer || 'This sender');
  const address = formatAddressLine(input);
  const addressSafe = escapeHtml(address);

  const html = [
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:32px;border-top:1px solid #e5e7eb;padding-top:16px;">',
    '<tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:#6b7280;text-align:center;padding:0 16px;">',
    `<p style="margin:0 0 6px;">You\'re receiving this email because you opted in with <strong>${dealerSafe}</strong>.</p>`,
    address
      ? `<p style="margin:0 0 6px;">${addressSafe}</p>`
      : '',
    `<p style="margin:0;"><a href="${UNSUBSCRIBE_TOKEN}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a> or <a href="${UNSUBSCRIBE_TOKEN}" style="color:#6b7280;text-decoration:underline;">manage your preferences</a>.</p>`,
    '</td></tr></table>',
  ].filter(Boolean).join('');

  const text = [
    `You're receiving this email because you opted in with ${input.dealer || 'this sender'}.`,
    address || '',
    `Unsubscribe: ${UNSUBSCRIBE_TOKEN}`,
  ].filter(Boolean).join('\n');

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
