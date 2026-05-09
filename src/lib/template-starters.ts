/**
 * Default starter templates for new email template creation.
 *
 * Visual (Drag & Drop): Rich multi-component Maizzle template
 * Code (HTML): Custom email-safe HTML starter for direct editing
 */

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Rich block-based starter for visual (Drag & Drop) mode — emits v2 JSON. */
function visualStarter(title: string) {
  const id = (suffix: string) => `b-${suffix}-${Math.random().toString(36).slice(2, 8)}`;
  const template = {
    version: '2',
    subject: title,
    preheader: '',
    settings: {
      bodyBg: '#f5f5f5',
      contentBg: '#ffffff',
      contentWidth: 600,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
      textColor: '#1a1a1a',
    },
    blocks: [
      {
        id: id('hero'),
        type: 'section',
        props: {
          bgColor: '#1a1a2e',
          paddingTop: 64,
          paddingBottom: 64,
          paddingLeft: 40,
          paddingRight: 40,
          align: 'center',
        },
        children: [
          {
            id: id('h1'),
            type: 'heading',
            props: {
              text: 'Your Headline Goes Here',
              level: 1,
              color: '#ffffff',
              fontSize: 36,
              fontWeight: 700,
              align: 'center',
              marginBottom: 12,
            },
          },
          {
            id: id('sub'),
            type: 'text',
            props: {
              text: "Add a brief description that captures your audience's attention.",
              color: '#e0e0e0',
              fontSize: 16,
              align: 'center',
              marginBottom: 24,
            },
          },
          {
            id: id('cta'),
            type: 'button',
            props: {
              text: 'Get Started',
              url: '#',
              bgColor: '#4f46e5',
              textColor: '#ffffff',
              align: 'center',
              borderRadiusTopLeft: 8,
              borderRadiusTopRight: 8,
              borderRadiusBottomRight: 8,
              borderRadiusBottomLeft: 8,
            },
          },
        ],
      },
      {
        id: id('body'),
        type: 'section',
        props: { paddingTop: 40, paddingBottom: 40, paddingLeft: 40, paddingRight: 40 },
        children: [
          {
            id: id('greeting'),
            type: 'heading',
            props: { text: 'Hi {{contact.first_name}},', level: 2, fontSize: 22, marginBottom: 16 },
          },
          {
            id: id('body-text'),
            type: 'text',
            props: {
              text: 'Thank you for being a valued member of our community. Replace this with your message.',
              fontSize: 15,
              lineHeight: '1.6',
              marginBottom: 0,
            },
          },
        ],
      },
    ],
  };
  return JSON.stringify(template, null, 2);
}

/** Custom raw-HTML starter for code (HTML) editing mode */
function codeStarter(title: string) {
  const safeTitle = escapeHtml(title);

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="x-ua-compatible" content="ie=edge">
  <title>${safeTitle}</title>
</head>
<body style="margin:0; padding:0; background-color:#eef2f7;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">
    Add your preview text for ${safeTitle} here.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; border-collapse:collapse; background-color:#eef2f7;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; max-width:600px; border-collapse:separate; background-color:#ffffff; border:1px solid #dbe4f0; border-radius:18px;">
          <tr>
            <td style="padding:32px 40px 12px; font-family:Arial, Helvetica, sans-serif; font-size:13px; line-height:18px; letter-spacing:0.08em; text-transform:uppercase; color:#4f46e5;">
              {{location.name}}
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 12px; font-family:Arial, Helvetica, sans-serif; font-size:32px; line-height:40px; font-weight:700; color:#111827;">
              Your headline goes here
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 16px; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:26px; color:#4b5563;">
              Hi {{contact.first_name}},
              <br><br>
              Start with a clear summary of the message, the offer, or the update. Replace this starter with your own custom HTML layout, sections, images, and copy.
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
                <tr>
                  <td align="center" bgcolor="#4f46e5" style="border-radius:999px;">
                    <a href="#" style="display:inline-block; padding:14px 28px; font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:14px; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:#ffffff; text-decoration:none;">
                      Take Action
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 32px; font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:22px; color:#6b7280;">
              Add supporting details, deadlines, disclaimers, or secondary links here.
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px 32px; border-top:1px solid #e5e7eb; font-family:Arial, Helvetica, sans-serif; font-size:13px; line-height:22px; color:#6b7280;">
              <strong style="color:#111827;">{{location.name}}</strong><br>
              {{location.address}}<br>
              {{location.city}}, {{location.state}} {{location.postal_code}}<br>
              {{location.phone}}<br>
              <a href="{{location.website}}" style="color:#4f46e5; text-decoration:none;">{{location.website}}</a><br><br>
              <a href="{{unsubscribe_link}}" style="color:#6b7280; text-decoration:underline;">Unsubscribe</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

/**
 * Get the appropriate starter template for the given editor mode.
 */
export function getStarterTemplate(mode: 'visual' | 'code', title = 'Untitled Template'): string {
  return mode === 'code' ? codeStarter(title) : visualStarter(title);
}
