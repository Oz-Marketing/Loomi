import { escapeHtml, sendTransactionalEmail } from '@/lib/users/transactional-email';

const APP_LOGO_LIGHT_URL =
  'https://storage.googleapis.com/msgsndr/CVpny6EUSHRxlXfqAFb7/media/6995362fd614c941e221bb2e.png';

/**
 * Password-reset email. Deliberately the same chrome as the invite email
 * (`invite-email.ts`) so account-lifecycle mail reads as one family — light
 * logo on a light shell, dark gradient hairline around a white card.
 */
function renderPasswordResetEmailHtml(input: {
  recipientName: string;
  resetUrl: string;
  expiresAtLabel: string;
}): string {
  const recipientName = escapeHtml(input.recipientName);
  const resetUrl = escapeHtml(input.resetUrl);
  const expiresAtLabel = escapeHtml(input.expiresAtLabel);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Reset your Loomi Studio password</title>
  </head>
  <body style="margin:0;padding:0;background:#eff3f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eff3f9;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="620" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;">
            <tr>
              <td style="padding:0 0 14px 0;text-align:center;">
                <img src="${APP_LOGO_LIGHT_URL}" alt="Loomi Studio" width="172" style="display:inline-block;border:0;outline:none;text-decoration:none;height:auto;max-width:172px;" />
              </td>
            </tr>
            <tr>
              <td style="border-radius:18px;background:#0b1220;background-image:linear-gradient(140deg,#0b1220 0%,#101a2e 38%,#121f39 100%);padding:1px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:17px;background:#ffffff;">
                  <tr>
                    <td style="padding:34px 34px 10px 34px;">
                      <p style="margin:0 0 12px 0;font-size:12px;line-height:1.4;letter-spacing:0.08em;text-transform:uppercase;color:#4f46e5;font-weight:700;">
                        Password Reset
                      </p>
                      <h1 style="margin:0 0 14px 0;font-size:28px;line-height:1.15;color:#0f172a;font-weight:750;">
                        Reset your password
                      </h1>
                      <p style="margin:0 0 18px 0;font-size:15px;line-height:1.65;color:#334155;">
                        Hi ${recipientName}, we received a request to reset the password for your Loomi Studio account. Use the secure link below to choose a new one.
                      </p>
                      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 18px 0;">
                        <tr>
                          <td align="center" style="border-radius:12px;background:#4f46e5;">
                            <a href="${resetUrl}" style="display:inline-block;padding:13px 24px;font-size:14px;line-height:1;font-weight:700;color:#ffffff;text-decoration:none;">
                              Choose a New Password
                            </a>
                          </td>
                        </tr>
                      </table>
                      <p style="margin:0 0 2px 0;font-size:13px;line-height:1.5;color:#64748b;">
                        This link expires on <strong style="color:#334155;">${expiresAtLabel}</strong> and can only be used once.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 34px 34px 34px;">
                      <div style="border-radius:12px;border:1px solid #dbe5f4;background:#f8fbff;padding:14px;">
                        <p style="margin:0 0 8px 0;font-size:12px;line-height:1.45;color:#475569;">
                          If the button does not work, copy and paste this URL into your browser:
                        </p>
                        <p style="margin:0;font-size:12px;line-height:1.45;word-break:break-all;">
                          <a href="${resetUrl}" style="color:#4f46e5;text-decoration:none;">${resetUrl}</a>
                        </p>
                      </div>
                      <p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:#64748b;">
                        If you did not request a password reset, you can safely ignore this email — your current password stays active.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 6px 0 6px;text-align:center;">
                <p style="margin:0;font-size:11px;line-height:1.5;color:#64748b;">
                  Loomi Studio
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

export async function sendPasswordResetEmail(input: {
  to: string;
  recipientName: string;
  resetUrl: string;
  expiresAt: Date;
}): Promise<void> {
  const expiresAtLabel = input.expiresAt.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const safeRecipientName = input.recipientName.trim() || input.to;
  const html = renderPasswordResetEmailHtml({
    recipientName: safeRecipientName,
    resetUrl: input.resetUrl,
    expiresAtLabel,
  });
  const text = [
    `Hi ${safeRecipientName},`,
    '',
    'We received a request to reset your Loomi Studio password.',
    'Choose a new password using this secure link:',
    input.resetUrl,
    '',
    `This link expires on ${expiresAtLabel} and can only be used once.`,
    '',
    'If you did not request a password reset, you can safely ignore this email.',
  ].join('\n');

  await sendTransactionalEmail({
    to: input.to,
    subject: 'Reset your Loomi Studio password',
    html,
    text,
    purpose: 'Password reset email',
  });
}
