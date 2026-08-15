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
import { asFileValues } from './types';
import { readSubmissionMetadata } from './embed-params';

export class LeadNotificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeadNotificationError';
  }
}

/**
 * Split a stored comma-separated `Form.notificationEmail` value into
 * clean, de-duplicated addresses. Shared with the settings PATCH
 * validation in `@/lib/services/forms` so parsing can't drift between
 * what's accepted at write time and what's sent to at submit time.
 */
export function parseNotificationEmails(value: string | null | undefined): string[] {
  return [
    ...new Set(
      (value || '')
        .split(',')
        .map((addr) => addr.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Deliver to each recipient independently — one bad address (typo'd
 * domain, provider 4xx) must not block the remaining recipients. Throws
 * only when every send failed, so a total outage still surfaces in the
 * caller's log while a partial failure just logs the addresses missed.
 */
async function deliverToEach(
  recipients: string[],
  send: (rcpt: string) => Promise<unknown>,
): Promise<void> {
  const failed: string[] = [];
  for (const rcpt of recipients) {
    try {
      await send(rcpt);
    } catch (err) {
      failed.push(rcpt);
      console.error(`[forms/notify] lead notification send failed for ${rcpt}`, err);
    }
  }
  if (failed.length > 0 && failed.length === recipients.length) {
    throw new LeadNotificationError(
      `Lead notification failed for all recipients (${failed.join(', ')})`,
    );
  }
}

/**
 * Escape for both element text and attribute values. Quotes are in the
 * set on purpose: `formatValueHtml` interpolates a file URL straight
 * into an `href="…"`, and submissions can now also carry embed metadata
 * lifted from a third-party page's query string.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatValue(value: unknown): string {
  const files = asFileValues(value);
  if (files.length > 0) return files.map((f) => `${f.name} (${f.url})`).join(', ');
  if (Array.isArray(value)) return value.join(', ');
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

/** HTML cell body — renders uploaded files as clickable links. */
function formatValueHtml(value: unknown): string {
  const files = asFileValues(value);
  if (files.length > 0) {
    return files
      .map((f) => `<a href="${escapeHtml(f.url)}">${escapeHtml(f.name)}</a>`)
      .join('<br>');
  }
  return escapeHtml(formatValue(value));
}

function row(key: string, valueHtml: string): string {
  return `<tr><td style="padding:4px 12px 4px 0;color:#666;font-family:sans-serif;font-size:13px;vertical-align:top;white-space:nowrap">${escapeHtml(key)}</td><td style="padding:4px 0;font-family:sans-serif;font-size:13px">${valueHtml}</td></tr>`;
}

/** `meta_*` params captured from the host page the form was embedded
 *  in. Sorted for a stable read; escaped like everything else — this is
 *  third-party input, and it lands in someone's inbox. */
function metaEntries(submission: FormSubmission): [string, string][] {
  return Object.entries(readSubmissionMetadata(submission.metadata)).sort(([a], [b]) =>
    a.localeCompare(b),
  );
}

/** Exported for tests — the escaping here is the last line of defense
 *  before untrusted submission content lands in someone's inbox. */
export function buildHtml(form: Form, submission: FormSubmission): string {
  const data = (submission.data ?? {}) as Record<string, unknown>;
  const rows = Object.entries(data)
    .map(([key, value]) => row(key, formatValueHtml(value)))
    .join('');

  const meta = metaEntries(submission);
  const metaTable = meta.length
    ? `<h3 style="font-size:13px;margin:20px 0 8px;color:#666">Page context</h3>
    <table style="border-collapse:collapse">${meta
      .map(([key, value]) => row(key, escapeHtml(value)))
      .join('')}</table>`
    : '';

  return `<div style="font-family:sans-serif">
    <h2 style="font-size:16px;margin:0 0 12px">New submission — ${escapeHtml(form.name)}</h2>
    <table style="border-collapse:collapse">${rows}</table>
    ${metaTable}
  </div>`;
}

/** Exported for tests — see {@link buildHtml}. */
export function buildText(form: Form, submission: FormSubmission): string {
  const data = (submission.data ?? {}) as Record<string, unknown>;
  const lines = Object.entries(data).map(([key, value]) => `${key}: ${formatValue(value)}`);
  const meta = metaEntries(submission);
  if (meta.length) {
    lines.push('', 'Page context:', ...meta.map(([key, value]) => `${key}: ${value}`));
  }
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
  const recipients = parseNotificationEmails(form.notificationEmail);
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
    await deliverToEach(recipients, (rcpt) =>
      sendEmailViaSendGrid({
        apiKey: sg.apiKey,
        from: { email: senderEmail, name: senderName || undefined },
        replyTo: account?.replyToEmail ? { email: account.replyToEmail } : undefined,
        to: { email: rcpt },
        subject,
        text,
        html,
        categories: ['form-lead-notification'],
      }),
    );
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

  await deliverToEach(recipients, (rcpt) =>
    transporter.sendMail({
      from: formatFrom(smtpFrom, senderName),
      to: rcpt,
      ...(account?.replyToEmail ? { replyTo: account.replyToEmail } : {}),
      subject,
      text,
      html,
    }),
  );
}
