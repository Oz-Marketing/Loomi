/**
 * Send a "new lead" notification email when a form submission comes in.
 *
 * Mirrors the SendGrid-or-SMTP routing in
 * `@/lib/integrations/crm/send-lead-email` (account sender identity first,
 * SMTP env as fallback), but renders the submitted field values as a
 * human-readable table rather than an ADF document — this lands in a
 * person's inbox, not a CRM intake parser.
 */
import nodemailer from 'nodemailer';
import type { Form, FormSubmission } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolveSendGridConfig, sendEmailViaSendGrid } from '@/lib/sending/sendgrid';

export class LeadNotificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeadNotificationError';
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function buildHtml(form: Form, submission: FormSubmission): string {
  const data = (submission.data ?? {}) as Record<string, unknown>;
  const rows = Object.entries(data)
    .map(
      ([key, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#666;font-family:sans-serif;font-size:13px;vertical-align:top;white-space:nowrap">${escapeHtml(key)}</td><td style="padding:4px 0;font-family:sans-serif;font-size:13px">${escapeHtml(formatValue(value))}</td></tr>`,
    )
    .join('');
  return `<div style="font-family:sans-serif">
    <h2 style="font-size:16px;margin:0 0 12px">New submission — ${escapeHtml(form.name)}</h2>
    <table style="border-collapse:collapse">${rows}</table>
  </div>`;
}

function buildText(form: Form, submission: FormSubmission): string {
  const data = (submission.data ?? {}) as Record<string, unknown>;
  const lines = Object.entries(data).map(([key, value]) => `${key}: ${formatValue(value)}`);
  return [`New submission — ${form.name}`, '', ...lines].join('\n');
}

function formatFrom(email: string, name: string | null): string {
  const n = (name || '').trim().replace(/["\\]/g, '');
  return n ? `"${n}" <${email}>` : email;
}

/**
 * No-ops when the form has no notification email configured. Throws
 * `LeadNotificationError` when recipients are configured but the account
 * has no usable sender — callers should catch this rather than let it
 * roll back the submission.
 */
export async function sendLeadNotificationEmail(args: {
  form: Form;
  submission: FormSubmission;
}): Promise<void> {
  const { form, submission } = args;
  const recipients = (form.notificationEmail || '')
    .split(',')
    .map((addr) => addr.trim())
    .filter(Boolean);
  if (recipients.length === 0 || !form.accountKey) return;

  const accountKey = form.accountKey;
  const subject = `New lead: ${form.name}`;
  const html = buildHtml(form, submission);
  const text = buildText(form, submission);

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { senderEmail: true, senderName: true, replyToEmail: true },
  });
  const senderEmail = account?.senderEmail || null;
  const senderName = account?.senderName || null;

  const sg = await resolveSendGridConfig(accountKey);
  if (sg && senderEmail) {
    for (const rcpt of recipients) {
      await sendEmailViaSendGrid({
        apiKey: sg.apiKey,
        from: { email: senderEmail, name: senderName || undefined },
        replyTo: account?.replyToEmail ? { email: account.replyToEmail } : undefined,
        to: { email: rcpt },
        subject,
        text,
        html,
        categories: ['form-lead-notification'],
      });
    }
    return;
  }

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || '587');
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = senderEmail || process.env.SMTP_FROM || smtpUser;
  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
    throw new LeadNotificationError(
      'No sender configured for this account (set up SendGrid or SMTP).',
    );
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number.isFinite(smtpPort) ? smtpPort : 587,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });

  for (const rcpt of recipients) {
    await transporter.sendMail({
      from: formatFrom(smtpFrom, senderName),
      to: rcpt,
      ...(account?.replyToEmail ? { replyTo: account.replyToEmail } : {}),
      subject,
      text,
      html,
    });
  }
}
