/**
 * Send an ADF lead as an email through the account's sending identity.
 *
 * Mirrors the SendGrid-or-SMTP routing the campaign worker uses, but kept
 * deliberately minimal: NO open/click tracking, NO unsubscribe footer —
 * this is a machine-readable lead to a CRM intake address, not marketing
 * mail. The ADF XML is sent as the text/plain body (what ADF parsers
 * read) with a <pre> HTML part for any human viewing the inbox.
 */
import nodemailer from 'nodemailer';
import { prisma } from '@/lib/prisma';
import { resolveSendGridConfig, sendEmailViaSendGrid } from '@/lib/sending/sendgrid';

export class LeadEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeadEmailError';
  }
}

function htmlWrap(xml: string): string {
  const escaped = xml
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<pre style="font-family:monospace;white-space:pre-wrap">${escaped}</pre>`;
}

function formatFrom(email: string, name: string | null): string {
  const n = (name || '').trim().replace(/["\\]/g, '');
  return n ? `"${n}" <${email}>` : email;
}

/**
 * Deliver the ADF document to `to`. Returns the provider message id.
 * Throws LeadEmailError when the account has no usable sender (neither a
 * SendGrid key + verified sender, nor SMTP env configured).
 */
export async function sendLeadEmail(args: {
  accountKey: string;
  to: string;
  subject: string;
  xml: string;
}): Promise<{ messageId: string }> {
  const { accountKey, to, subject, xml } = args;

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { senderEmail: true, senderName: true, replyToEmail: true },
  });
  const senderEmail = account?.senderEmail || null;
  const senderName = account?.senderName || null;

  // Prefer SendGrid when the account has a key AND a verified sender.
  const sg = await resolveSendGridConfig(accountKey);
  if (sg && senderEmail) {
    const result = await sendEmailViaSendGrid({
      apiKey: sg.apiKey,
      from: { email: senderEmail, name: senderName || undefined },
      replyTo: account?.replyToEmail ? { email: account.replyToEmail } : undefined,
      to: { email: to },
      subject,
      text: xml,
      html: htmlWrap(xml),
      categories: ['crm-lead'],
      // No `unsubscribe` → SendGrid skips subscription tracking; correct
      // for a transactional CRM lead.
    });
    return { messageId: result.messageId };
  }

  // SMTP fallback (nodemailer). Uses the same env the campaign worker reads.
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || '587');
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = senderEmail || process.env.SMTP_FROM || smtpUser;
  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
    throw new LeadEmailError(
      'No sender configured for this account (set up SendGrid or SMTP).',
    );
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number.isFinite(smtpPort) ? smtpPort : 587,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });

  const info = await transporter.sendMail({
    from: formatFrom(smtpFrom, senderName),
    to,
    ...(account?.replyToEmail ? { replyTo: account.replyToEmail } : {}),
    subject,
    text: xml,
    html: htmlWrap(xml),
  });

  return { messageId: info.messageId || 'smtp-sent' };
}
