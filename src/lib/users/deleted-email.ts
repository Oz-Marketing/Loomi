import {
  escapeHtml,
  resolveEmailLogoUrl,
  sendTransactionalEmail,
} from '@/lib/users/transactional-email';

function renderDeletedEmailHtml(recipientName: string): string {
  const name = escapeHtml(recipientName);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Loomi Studio Account Removed</title>
  </head>
  <body style="margin:0;padding:0;background:#eff3f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eff3f9;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="620" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;">
            <tr>
              <td style="padding:0 0 14px 0;text-align:center;">
                <img src="${resolveEmailLogoUrl()}" alt="Loomi Studio" width="172" style="display:inline-block;border:0;outline:none;text-decoration:none;height:auto;max-width:172px;" />
              </td>
            </tr>
            <tr>
              <td style="border-radius:18px;background:#0b1220;background-image:linear-gradient(140deg,#0b1220 0%,#101a2e 38%,#121f39 100%);padding:1px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:17px;background:#ffffff;">
                  <tr>
                    <td style="padding:34px 34px 10px 34px;">
                      <p style="margin:0 0 12px 0;font-size:12px;line-height:1.4;letter-spacing:0.08em;text-transform:uppercase;color:#ef4444;font-weight:700;">
                        Account Removed
                      </p>
                      <h1 style="margin:0 0 14px 0;font-size:28px;line-height:1.15;color:#0f172a;font-weight:750;">
                        Your account has been removed
                      </h1>
                      <p style="margin:0 0 18px 0;font-size:15px;line-height:1.65;color:#334155;">
                        Hi ${name}, your Loomi Studio account has been removed by an administrator. You will no longer be able to sign in.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 34px 34px 34px;">
                      <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;">
                        If you believe this was done in error, please contact your administrator.
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

export async function sendUserDeletedEmail(input: {
  to: string;
  recipientName: string;
}): Promise<void> {
  const safeRecipientName = input.recipientName.trim() || input.to;
  const subject = 'Your Loomi Studio account has been removed';
  const html = renderDeletedEmailHtml(safeRecipientName);
  const text = [
    `Hi ${safeRecipientName},`,
    '',
    'Your Loomi Studio account has been removed by an administrator. You will no longer be able to sign in.',
    '',
    'If you believe this was done in error, please contact your administrator.',
  ].join('\n');

  await sendTransactionalEmail({
    to: input.to,
    subject,
    html,
    text,
    purpose: 'Account removal email',
  });
}
