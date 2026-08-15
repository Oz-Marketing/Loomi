import {
  escapeHtml,
  resolveEmailLogoUrl,
  sendTransactionalEmail,
} from '@/lib/users/transactional-email';

function renderInviteEmailHtml(input: {
  recipientName: string;
  invitedByName: string;
  inviteUrl: string;
  expiresAtLabel: string;
  role: string;
}): string {
  const recipientName = escapeHtml(input.recipientName);
  const invitedByName = escapeHtml(input.invitedByName);
  const inviteUrl = escapeHtml(input.inviteUrl);
  const expiresAtLabel = escapeHtml(input.expiresAtLabel);
  const role = escapeHtml(input.role);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Loomi Studio Invite</title>
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
                      <p style="margin:0 0 12px 0;font-size:12px;line-height:1.4;letter-spacing:0.08em;text-transform:uppercase;color:#2563eb;font-weight:700;">
                        Team Access Invite
                      </p>
                      <h1 style="margin:0 0 14px 0;font-size:28px;line-height:1.15;color:#0f172a;font-weight:750;">
                        You are invited to Loomi Studio
                      </h1>
                      <p style="margin:0 0 18px 0;font-size:15px;line-height:1.65;color:#334155;">
                        Hi ${recipientName}, ${invitedByName} added you as a <strong style="color:#0f172a;">${role}</strong>. Use the secure link below to create your password and activate your account.
                      </p>
                      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 18px 0;">
                        <tr>
                          <td align="center" style="border-radius:12px;background:#2563eb;">
                            <a href="${inviteUrl}" style="display:inline-block;padding:13px 24px;font-size:14px;line-height:1;font-weight:700;color:#ffffff;text-decoration:none;">
                              Create Your Password
                            </a>
                          </td>
                        </tr>
                      </table>
                      <p style="margin:0 0 2px 0;font-size:13px;line-height:1.5;color:#64748b;">
                        This invitation expires on <strong style="color:#334155;">${expiresAtLabel}</strong>.
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
                          <a href="${inviteUrl}" style="color:#2563eb;text-decoration:none;">${inviteUrl}</a>
                        </p>
                      </div>
                      <p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:#64748b;">
                        If you did not expect this invite, you can safely ignore this email.
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

export async function sendUserInviteEmail(input: {
  to: string;
  recipientName: string;
  invitedByName: string;
  inviteUrl: string;
  expiresAt: Date;
  role: string;
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
  const subject = 'You are invited to Loomi Studio';
  const html = renderInviteEmailHtml({
    recipientName: safeRecipientName,
    invitedByName: input.invitedByName,
    inviteUrl: input.inviteUrl,
    expiresAtLabel,
    role: input.role,
  });
  const text = [
    `Hi ${safeRecipientName},`,
    '',
    `${input.invitedByName} invited you to Loomi Studio as a ${input.role}.`,
    'Create your password using this secure link:',
    input.inviteUrl,
    '',
    `This invitation expires on ${expiresAtLabel}.`,
  ].join('\n');

  await sendTransactionalEmail({
    to: input.to,
    subject,
    html,
    text,
    purpose: 'Invite email',
  });
}
