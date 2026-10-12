import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { canAccessAccount, getAccountScope, requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { resolveAccountFooter } from '@/lib/sending/account-footer';
import { compileTemplateContent, stripFrontmatter } from '@/lib/email/compile-template';
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
import { loadBlastAccountData } from '@/lib/sending/blast-account-data';
import {
  applyBlastMergetags,
  buildBlastMergetagContext,
} from '@/lib/sending/blast-mergetags';
import { applyUtmTags, type BlastUtmSettings } from '@/lib/sending/blast-utm';
import { applyPreviewText } from '@/lib/sending/preheader';
import { htmlToText } from '@/lib/sending/html-to-text';
import { SAMPLE_PREVIEW_CONTACT } from '@/lib/preview-variables';
import { clientErrorMessage } from '@/lib/api-errors';

interface SendTestBody {
  to: string;
  subject?: string;
  /**
   * The template SOURCE (v2 JSON or HTML), compiled here with its merge tags
   * intact. Preferred: the tags then resolve exactly as a blast's would.
   */
  content?: string;
  /**
   * Already-compiled HTML. Older callers send the editor's preview HTML,
   * whose tags the editor has already filled with sample values; any tag
   * left in it is still resolved below.
   */
  html?: string;
  /** The blast's inbox preview text, when testing a blast. */
  previewText?: string;
  /** The blast's UTM settings, when testing a blast. */
  utm?: Partial<BlastUtmSettings> | null;
  /** When set, we route through this sub-account's SendGrid key + sender
   *  identity. Falls back to global SMTP if the key isn't configured. */
  accountKey?: string;
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readUtm(raw: unknown): BlastUtmSettings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const utm = raw as Record<string, unknown>;
  return {
    enabled: Boolean(utm.enabled),
    source: String(utm.source ?? ''),
    medium: String(utm.medium ?? ''),
    campaign: String(utm.campaign ?? ''),
    term: String(utm.term ?? ''),
    content: String(utm.content ?? ''),
  };
}

/**
 * POST /api/emails/send-test — the editor's "Send test".
 *
 * A test is only useful if it is the email a recipient will get. This used to
 * mail the editor's PREVIEW HTML: sample values standing in for the account's
 * real phone numbers and logos, no blast preview text, no UTM tags, and a
 * text part made by stripping tags. It now runs the send pipeline — the
 * account's real merge values from the same loader and mapper the blast
 * worker uses, the blast's preview text and UTM settings when given, the
 * compliance footer, the generated text part — with one deliberate
 * difference: the recipient is the sample contact ("Alex Customer"), so
 * nobody mistakes a test for a message about a real customer.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  try {
    const body = (await req.json()) as SendTestBody;
    const to = body.to?.trim() || '';
    const rawSubject = body.subject?.trim() || 'Test Email from Loomi Studio';
    const accountKey = typeof body.accountKey === 'string' ? body.accountKey.trim() : '';

    if (!to) return NextResponse.json({ error: 'Recipient email is required' }, { status: 400 });

    // Sending through an account uses its SendGrid key and its sender
    // identity, and now reads its full merge data — so the caller has to be
    // allowed to act for that account.
    if (accountKey && !canAccessAccount(getAccountScope(session!), accountKey)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let html = '';
    if (typeof body.content === 'string' && body.content.trim()) {
      try {
        html = await compileTemplateContent(body.content);
      } catch (err) {
        return NextResponse.json(
          { error: clientErrorMessage(err, 'The template could not be compiled') },
          { status: 400 },
        );
      }
    } else if (typeof body.html === 'string') {
      // Callers compile through /api/preview, which already strips a
      // template's frontmatter — this catches any that hand us stored
      // content directly.
      html = stripFrontmatter(body.html);
    }
    if (!html.trim()) return NextResponse.json({ error: 'Email HTML content is required' }, { status: 400 });

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

    // ── The send pipeline, in the worker's order ──
    // Preview text and UTM tagging work on the template once; merge tags are
    // filled per recipient (here, the sample one); the footer goes in last,
    // after the tags, so it sees the unsubscribe link the designer placed.
    const mergeAccount = accountKey
      ? (await loadBlastAccountData([accountKey])).get(accountKey) ?? null
      : null;
    const base = applyUtmTags(applyPreviewText(html, body.previewText), readUtm(body.utm));
    const baseText = htmlToText(base);
    const mergeCtx = buildBlastMergetagContext({
      contact: SAMPLE_PREVIEW_CONTACT,
      account: mergeAccount,
      // On SendGrid a designer's {{unsubscribe_link}} becomes the same live,
      // per-recipient link a blast gets. SMTP has no way to mint one, so it
      // points nowhere rather than showing raw token text.
      unsubscribeToken: useSendGrid ? UNSUBSCRIBE_TOKEN : '#',
    });
    const mergedHtml = applyBlastMergetags(base, mergeCtx, { escape: true });
    const mergedText = applyBlastMergetags(baseText, mergeCtx, { escape: false });
    // Labeled, because a test now reads exactly like the real thing — real
    // dealership details, a working unsubscribe link — and gets forwarded.
    const subject = `[Test] ${applyBlastMergetags(rawSubject, mergeCtx, { escape: false })}`;

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

    const composed = footerAccount
      ? injectUnsubscribeFooter({
          html: mergedHtml,
          text: mergedText,
          account: footerAccount,
          config: footerConfig,
          // Only ever force the link OFF. Left undefined, the injector
          // keeps its own rule: skip the link when the designer already
          // placed one, so a template with its own doesn't get two.
          ...(useSendGrid ? {} : { includeUnsubscribeLink: false }),
        })
      : { html: mergedHtml, text: mergedText };

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
            subject,
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
        const msg = err instanceof SendGridError ? `SendGrid: ${err.message}` : clientErrorMessage(err, 'SendGrid send failed');
        return NextResponse.json({ error: msg }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        provider: 'sendgrid',
        from: account.senderEmail,
        messageId: lastMessageId,
        recipients: recipients.length,
        subject,
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
      subject,
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
      subject,
      footerNote,
    });
  } catch (err) {
    console.error('Send test email error:', err);
    return NextResponse.json(
      { error: clientErrorMessage(err, 'Failed to send test email') },
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
