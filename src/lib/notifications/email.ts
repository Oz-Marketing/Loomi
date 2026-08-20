import nodemailer, { type Transporter } from 'nodemailer';


function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getTransporter(): { transporter: Transporter; from: string } | null {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || '587');
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM || smtpUser;

  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) return null;

  return {
    transporter: nodemailer.createTransport({
      host: smtpHost,
      port: Number.isFinite(smtpPort) ? smtpPort : 587,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    }),
    from: smtpFrom,
  };
}

export interface NotificationEmailItem {
  title: string;
  body?: string | null;
  link?: string | null;
  severity?: 'info' | 'warning' | 'critical';
}

const SEVERITY_LABEL_COLOR: Record<NonNullable<NotificationEmailItem['severity']>, string> = {
  info: '#3b82f6',
  warning: '#f59e0b',
  critical: '#ef4444',
};

const SEVERITY_LABEL_TEXT: Record<NonNullable<NotificationEmailItem['severity']>, string> = {
  info: 'Update',
  warning: 'Heads up',
  critical: 'Urgent',
};

function renderItemBlock(item: NotificationEmailItem, baseUrl: string): string {
  const severity = item.severity ?? 'info';
  const linkHref = item.link ? `${baseUrl}${item.link}` : null;
  const titleHtml = escapeHtml(item.title);
  const bodyHtml = item.body ? escapeHtml(item.body).replace(/\n/g, '<br />') : '';
  const labelColor = SEVERITY_LABEL_COLOR[severity];
  const labelText = SEVERITY_LABEL_TEXT[severity];

  return `
    <tr>
      <td style="padding:0 0 14px 0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;">
          <tr>
            <td style="padding:14px 18px;">
              <p style="margin:0 0 6px 0;font-size:11px;line-height:1.4;letter-spacing:0.08em;text-transform:uppercase;color:${labelColor};font-weight:700;">
                ${labelText}
              </p>
              <p style="margin:0 0 6px 0;font-size:15px;line-height:1.4;color:#0f172a;font-weight:650;">
                ${titleHtml}
              </p>
              ${bodyHtml ? `<p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#475569;">${bodyHtml}</p>` : ''}
              ${
                linkHref
                  ? `<p style="margin:6px 0 0 0;font-size:12px;line-height:1.4;"><a href="${linkHref}" style="color:#3b82f6;text-decoration:none;">Open in Loomi Studio →</a></p>`
                  : ''
              }
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderShellHtml(opts: {
  preheader: string;
  heading: string;
  intro: string;
  itemsHtml: string;
  ctaHref?: string;
  ctaText?: string;
}): string {
  // Absolute, because a mail client cannot resolve a root-relative path — and
  // self-hosted, because this used to hotlink a GoHighLevel CDN asset on a
  // domain unrelated to the sender (a mild spam signal, on an account we no
  // longer control). `/brand/*` is on the proxy's public passthrough list so it
  // loads for a recipient with no session; PNG because Outlook cannot render
  // WebP. See src/lib/users/transactional-email.ts, which does the same.
  const logoUrl = `${getAppBaseUrl()}/brand/loomi-studio-black.png`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(opts.heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:#eff3f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(opts.preheader)}</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eff3f9;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="620" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;">
            <tr>
              <td style="padding:0 0 14px 0;text-align:center;">
                <img src="${logoUrl}" alt="Loomi Studio" width="172" style="display:inline-block;border:0;outline:none;text-decoration:none;height:auto;max-width:172px;" />
              </td>
            </tr>
            <tr>
              <td style="border-radius:18px;background:#ffffff;padding:30px 30px 18px 30px;">
                <h1 style="margin:0 0 8px 0;font-size:22px;line-height:1.2;color:#0f172a;font-weight:700;">
                  ${escapeHtml(opts.heading)}
                </h1>
                <p style="margin:0 0 20px 0;font-size:14px;line-height:1.55;color:#475569;">
                  ${escapeHtml(opts.intro)}
                </p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  ${opts.itemsHtml}
                </table>
                ${
                  opts.ctaHref && opts.ctaText
                    ? `<p style="margin:14px 0 0 0;text-align:center;"><a href="${opts.ctaHref}" style="display:inline-block;background:#0f172a;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">${escapeHtml(opts.ctaText)}</a></p>`
                    : ''
                }
              </td>
            </tr>
            <tr>
              <td style="padding:14px 6px 0 6px;text-align:center;">
                <p style="margin:0;font-size:11px;line-height:1.5;color:#64748b;">
                  Loomi Studio · You're receiving this because you're tagged on a Meta Ads Planner item.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function getAppBaseUrl(): string {
  return (process.env.NEXTAUTH_URL || process.env.APP_BASE_URL || 'https://studio.loomilm.com').replace(/\/$/, '');
}

/** Send a single immediate notification email. */
export async function sendImmediateNotificationEmail(input: {
  to: string;
  recipientName: string;
  item: NotificationEmailItem;
}): Promise<void> {
  const setup = getTransporter();
  if (!setup) {
    // eslint-disable-next-line no-console
    console.warn('[notifications] SMTP not configured — skipping email');
    return;
  }

  const baseUrl = getAppBaseUrl();
  const heading = input.item.title;
  const intro = `Hi ${input.recipientName.trim() || input.to}, here's a Loomi Studio update.`;
  const html = renderShellHtml({
    preheader: heading,
    heading,
    intro,
    itemsHtml: renderItemBlock(input.item, baseUrl),
  });
  const subject = `[Loomi Studio] ${heading}`;
  const textParts = [
    `Hi ${input.recipientName.trim() || input.to},`,
    '',
    heading,
  ];
  if (input.item.body) textParts.push('', input.item.body);
  if (input.item.link) textParts.push('', `${baseUrl}${input.item.link}`);
  const text = textParts.join('\n');

  await setup.transporter.sendMail({
    from: setup.from,
    to: input.to,
    subject,
    html,
    text,
  });
}

/** Send a digest email summarising multiple notifications. */
export async function sendDigestNotificationEmail(input: {
  to: string;
  recipientName: string;
  items: NotificationEmailItem[];
}): Promise<void> {
  if (input.items.length === 0) return;
  const setup = getTransporter();
  if (!setup) {
    // eslint-disable-next-line no-console
    console.warn('[notifications] SMTP not configured — skipping digest email');
    return;
  }

  const baseUrl = getAppBaseUrl();
  const count = input.items.length;
  const heading = `${count} update${count !== 1 ? 's' : ''} for you in Loomi Studio`;
  const intro = `Here's what's new on your Meta Ads Planner items today.`;
  const itemsHtml = input.items.map((it) => renderItemBlock(it, baseUrl)).join('\n');
  const html = renderShellHtml({
    preheader: heading,
    heading,
    intro,
    itemsHtml,
    ctaHref: `${baseUrl}/tools/meta-ads-pacer`,
    ctaText: 'Open Meta Ads Planner',
  });
  const subject = `[Loomi Studio] Daily digest — ${count} update${count !== 1 ? 's' : ''}`;
  const text = [
    `Hi ${input.recipientName.trim() || input.to},`,
    '',
    heading,
    '',
    ...input.items.flatMap((it) =>
      [`• ${it.title}`, it.body ? `  ${it.body}` : null, it.link ? `  ${baseUrl}${it.link}` : null]
        .filter((line): line is string => Boolean(line)),
    ),
  ].join('\n');

  await setup.transporter.sendMail({
    from: setup.from,
    to: input.to,
    subject,
    html,
    text,
  });
}
