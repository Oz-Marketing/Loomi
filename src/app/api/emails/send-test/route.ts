import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  resolveSendGridConfig,
  sendEmailViaSendGrid,
  SendGridError,
} from '@/lib/sending/sendgrid';

interface SendTestBody {
  to: string;
  subject?: string;
  html: string;
  /** When set, we route through this sub-account's SendGrid key + sender
   *  identity. Falls back to global SMTP if the key isn't configured. */
  accountKey?: string;
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const body = (await req.json()) as SendTestBody;
    const to = body.to?.trim() || '';
    const subject = body.subject?.trim() || 'Test Email from Loomi Studio';
    const html = body.html;
    const accountKey = typeof body.accountKey === 'string' ? body.accountKey.trim() : '';

    if (!to) return NextResponse.json({ error: 'Recipient email is required' }, { status: 400 });
    if (!html) return NextResponse.json({ error: 'Email HTML content is required' }, { status: 400 });

    const recipients = to.split(',').map((e) => e.trim()).filter(Boolean);
    for (const email of recipients) {
      if (!EMAIL_RX.test(email)) {
        return NextResponse.json({ error: `Invalid email address: ${email}` }, { status: 400 });
      }
    }

    // ── Resolve sending identity ──
    // Prefer per-sub-account SendGrid config when present; fall back to
    // global SMTP env vars. Either path needs a usable "from" address,
    // so we pull senderEmail/senderName from the account too.
    const account = accountKey
      ? await prisma.account.findUnique({
          where: { key: accountKey },
          select: { senderEmail: true, senderName: true, replyToEmail: true, dealer: true },
        })
      : null;

    const sendgrid = accountKey ? await resolveSendGridConfig(accountKey) : null;

    if (sendgrid && account?.senderEmail) {
      // SendGrid path
      let lastMessageId = '';
      try {
        for (const recipient of recipients) {
          const result = await sendEmailViaSendGrid({
            apiKey: sendgrid.apiKey,
            from: { email: account.senderEmail, name: account.senderName || account.dealer || undefined },
            replyTo: account.replyToEmail ? { email: account.replyToEmail } : undefined,
            to: { email: recipient },
            subject: `[TEST] ${subject}`,
            html,
            categories: ['loomi', 'send-test'],
          });
          lastMessageId = result.messageId || lastMessageId;
        }
      } catch (err) {
        const msg = err instanceof SendGridError ? `SendGrid: ${err.message}` : err instanceof Error ? err.message : 'SendGrid send failed';
        return NextResponse.json({ error: msg }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        provider: 'sendgrid',
        messageId: lastMessageId,
        recipients: recipients.length,
      });
    }

    // ── SMTP fallback ──
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom =
      (account?.senderEmail && formatFrom(account.senderEmail, account.senderName)) ||
      process.env.SMTP_FROM ||
      smtpUser;

    if (!smtpHost || !smtpUser || !smtpPass) {
      return NextResponse.json(
        {
          error: accountKey
            ? 'This sub-account has no SendGrid key configured and global SMTP isn\'t set up either. Add a SendGrid key in Email Settings.'
            : 'Email not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in your .env.local file.',
          hint: accountKey
            ? 'Open the sub-account Campaigns view and click the cog → SendGrid API Key.'
            : 'For Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USER=you@gmail.com, SMTP_PASS=your-app-password',
        },
        { status: 400 },
      );
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    const info = await transporter.sendMail({
      from: smtpFrom,
      ...(account?.replyToEmail ? { replyTo: account.replyToEmail } : {}),
      to: recipients.join(', '),
      subject: `[TEST] ${subject}`,
      html,
    });

    return NextResponse.json({
      success: true,
      provider: 'smtp',
      messageId: info.messageId,
      recipients: recipients.length,
    });
  } catch (err) {
    console.error('Send test email error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to send test email' },
      { status: 500 },
    );
  }
}

function formatFrom(email: string, name: string | null): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return email;
  const safe = trimmed.replace(/["\\]/g, '');
  return `"${safe}" <${email}>`;
}
