import nodemailer from 'nodemailer';

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
}): Promise<void> {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || '587');
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM || smtpUser;

  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
    throw new Error(
      `${input.purpose} is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and optionally SMTP_FROM.`,
    );
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number.isFinite(smtpPort) ? smtpPort : 587,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  await transporter.sendMail({
    from: smtpFrom,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
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
