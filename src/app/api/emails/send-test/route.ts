import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { resolveAccountFooter } from '@/lib/sending/account-footer';
import {
  injectUnsubscribeFooter,
  UNSUBSCRIBE_TOKEN,
  type UnsubscribeFooterConfig,
  type UnsubscribeFooterInput,
} from '@/lib/sending/unsubscribe-footer';
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

/** Same shape as the blast worker's: enough for a readable text/plain part. */
function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
    // so we pull senderEmail/senderName from the account too. The address
    // fields come along for the CAN-SPAM footer below.
    const account = accountKey
      ? await prisma.account.findUnique({
          where: { key: accountKey },
          select: {
            senderEmail: true,
            senderName: true,
            replyToEmail: true,
            dealer: true,
            address: true,
            city: true,
            state: true,
            postalCode: true,
          },
        })
      : null;

    const sendgrid = accountKey ? await resolveSendGridConfig(accountKey) : null;
    const useSendGrid = Boolean(sendgrid && account?.senderEmail);

    // ── CAN-SPAM footer ──
    // The editor hands us the raw design: no opt-in line, no postal
    // address, no unsubscribe link. Blasts and flows get all three from
    // injectUnsubscribeFooter(), so a test send that skips it is showing
    // the user a message no recipient will ever receive — which defeats
    // the point of testing. Styling resolves through the account chain
    // (rooftop → group → built-in default), same as a blast.
    //
    // The LINK is a SendGrid-only capability. buildUnsubscribeFooter emits
    // [%unsubscribe_url%] and only subscription_tracking's substitution_tag
    // turns it into a real URL; there is no Loomi-hosted unsubscribe page
    // to point at instead. On the SMTP fallback the token would arrive as
    // literal text, so we ship the address without the link and say so in
    // the response rather than mailing a broken one.
    const footerAccount: UnsubscribeFooterInput | null = account
      ? {
          dealer: account.dealer || '',
          address: account.address,
          city: account.city,
          state: account.state,
          postalCode: account.postalCode,
        }
      : null;

    let footerConfig: UnsubscribeFooterConfig | null = null;
    if (accountKey && footerAccount) {
      footerConfig = (await resolveAccountFooter(accountKey)).config;
    }

    // A text/plain part is what the footer's text half attaches to, and
    // its absence is an independent spam signal — blasts always send one.
    const baseText = stripHtml(html);

    const composed = footerAccount
      ? injectUnsubscribeFooter({
          html,
          text: baseText,
          account: footerAccount,
          config: footerConfig,
          // Only ever force the link OFF. Left undefined, the injector
          // keeps its own rule: skip the link when the designer already
          // placed one, so a template with its own doesn't get two.
          ...(useSendGrid ? {} : { includeUnsubscribeLink: false }),
        })
      : { html, text: baseText };

    const footerNote = !footerAccount
      ? 'No account was in scope, so no compliance footer was added. Open the template from an account to include it.'
      : useSendGrid
        ? null
        : 'Footer added without the unsubscribe link: this account has no SendGrid key, and the hosted unsubscribe URL only exists on the SendGrid path.';

    if (useSendGrid && sendgrid && account?.senderEmail) {
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
            html: composed.html,
            text: composed.text,
            categories: ['loomi', 'send-test'],
            // Swaps the token for a real hosted URL and sets the
            // List-Unsubscribe headers — the identical mechanism a blast
            // uses. The link is LIVE: clicking it suppresses that address
            // in SendGrid, exactly as it would for a real recipient.
            ...(footerAccount
              ? { unsubscribe: { substitutionTag: UNSUBSCRIBE_TOKEN } }
              : {}),
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
        from: account.senderEmail,
        messageId: lastMessageId,
        recipients: recipients.length,
        footerNote,
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
            ? 'This account has no SendGrid key configured and global SMTP isn\'t set up either. Add a SendGrid key in Email Settings.'
            : 'Email not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in your .env.local file.',
          hint: accountKey
            ? 'Open the account Campaigns view and click the cog → SendGrid API Key.'
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
      html: composed.html,
      text: composed.text,
    });

    // nodemailer only throws when EVERY recipient is refused; a partial
    // refusal resolves with the rest in `rejected`. Surfacing it keeps a
    // multi-address test from reporting a clean success for half a send.
    const rejected = (info.rejected || []).map(String);

    return NextResponse.json({
      success: true,
      provider: 'smtp',
      from: smtpFrom,
      messageId: info.messageId,
      recipients: recipients.length - rejected.length,
      rejected,
      footerNote,
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
