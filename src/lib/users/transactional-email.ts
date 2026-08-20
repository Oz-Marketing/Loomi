import nodemailer from 'nodemailer';

/**
 * Logo shown at the top of account-lifecycle mail.
 *
 * This used to default to a GoHighLevel CDN URL — a remote image on a domain
 * unrelated to the sender, which reads as a mild spam signal, and which we
 * stopped controlling when GHL was retired. It is now served from our own
 * origin, so the image and the sending domain finally agree.
 *
 * Mail clients cannot resolve a root-relative path, so this has to be absolute.
 * `/brand/*` is on the proxy's public passthrough list precisely so the image
 * loads for a recipient who has no session (see src/proxy.ts) — gate it and
 * every logo in every email renders as a broken-image icon.
 *
 * PNG, not WebP: Outlook desktop does not render WebP.
 *
 * EMAIL_LOGO_URL still overrides, for an install that wants its own asset.
 */
function appBaseUrl(): string {
  return (
    process.env.NEXTAUTH_URL ||
    process.env.APP_BASE_URL ||
    'https://studio.loomilm.com'
  ).replace(/\/$/, '');
}

export function resolveEmailLogoUrl(): string {
  const override = (process.env.EMAIL_LOGO_URL || '').trim();
  return override || `${appBaseUrl()}/brand/loomi-studio-black.png`;
}

type SmtpCredentials = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
};

/**
 * Account-lifecycle mail may send from a different domain than campaign mail.
 * SMTP_FROM doubles as the default sender for bulk blasts, form notifications
 * and CRM lead mail, so pointing it at the apex domain would stake root-domain
 * reputation on campaign sends. The SMTP_TRANSACTIONAL_* block keeps them apart.
 *
 * Switched as a unit on user+pass rather than per-variable: a half-populated
 * block would otherwise pair one sending domain's credentials with another's
 * host, and the mail would fail DKIM in a way that only shows up in headers.
 * When unset, everything falls back to SMTP_* and behaviour is unchanged.
 */
function resolveCredentials(): SmtpCredentials | null {
  const txUser = process.env.SMTP_TRANSACTIONAL_USER;
  const txPass = process.env.SMTP_TRANSACTIONAL_PASS;
  const useTransactional = Boolean(txUser && txPass);

  const host =
    (useTransactional ? process.env.SMTP_TRANSACTIONAL_HOST : undefined) || process.env.SMTP_HOST;
  const rawPort =
    (useTransactional ? process.env.SMTP_TRANSACTIONAL_PORT : undefined) ||
    process.env.SMTP_PORT ||
    '587';
  const user = useTransactional ? txUser : process.env.SMTP_USER;
  const pass = useTransactional ? txPass : process.env.SMTP_PASS;

  // Never cross domains on the From: falling back to the shared SMTP_FROM while
  // authenticated as the transactional user would sign one domain and address
  // the mail as another.
  const from = useTransactional
    ? process.env.SMTP_TRANSACTIONAL_FROM || txUser
    : process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!host || !user || !pass || !from) return null;

  const port = Number(rawPort);
  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    user,
    pass,
    from,
  };
}

/**
 * SMTP delivery for account-lifecycle mail (invites, password resets) — the
 * transactional messages that must go out regardless of a sub-account's
 * campaign sending setup, so they use the platform's own SMTP credentials
 * rather than a per-account provider.
 */
export async function sendTransactionalEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Named in the error thrown when SMTP isn't configured, e.g. "Invite email". */
  purpose: string;
  /** Overrides SMTP_TRANSACTIONAL_REPLY_TO for this message. */
  replyTo?: string;
}): Promise<void> {
  const credentials = resolveCredentials();

  if (!credentials) {
    throw new Error(
      `${input.purpose} is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and optionally ` +
        `SMTP_FROM — or the SMTP_TRANSACTIONAL_* equivalents to send lifecycle mail from a ` +
        `separate domain.`,
    );
  }

  const transporter = nodemailer.createTransport({
    host: credentials.host,
    port: credentials.port,
    secure: credentials.port === 465,
    auth: {
      user: credentials.user,
      pass: credentials.pass,
    },
  });

  const replyTo = input.replyTo || process.env.SMTP_TRANSACTIONAL_REPLY_TO || undefined;

  await transporter.sendMail({
    from: credentials.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    ...(replyTo ? { replyTo } : {}),
  });
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
