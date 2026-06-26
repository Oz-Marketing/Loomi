// Shared responsive email layout for the PJF campaign — styled to match
// pjfcorp.com (tagline "Quality. Integrity. Service.", 50+ yrs, healthcare
// proof, blue + gold system).
//
// Produces table-based, inline-CSS HTML (high-deliverability, flow-ready).
// The flow `email` node sends Template.content RAW — this is the final HTML.
//
// CAN-SPAM: no unsubscribe link / physical address is baked in — SendGrid
// auto-appends the account's footer on send (subscription_tracking). Adding
// one here would duplicate it.

import { BRAND, withUtm } from './brand';

const c = BRAND.colors;

export interface Cta {
  label: string;
  url: string; // raw destination (no UTM)
  utm: string; // utm_content descriptor
  variant?: 'primary' | 'secondary';
}

function renderButton(cta: Cta): string {
  const primary = (cta.variant ?? 'primary') === 'primary';
  const bg = primary ? c.primary : '#ffffff';
  const color = primary ? '#ffffff' : c.primary;
  const href = withUtm(cta.url, cta.utm);
  return `<a class="pjf-btn" href="${href}" target="_blank" style="display:inline-block;background:${bg};color:${color};border:2px solid ${c.primary};font-family:${BRAND.fonts.heading};font-size:15px;font-weight:bold;line-height:20px;text-decoration:none;padding:14px 30px;border-radius:6px;mso-padding-alt:0;">${cta.label}${primary ? ' &rarr;' : ''}</a>`;
}

/** 1–2 CTAs: side-by-side on desktop, full-width stacked on mobile. */
export function ctaRow(ctas: Cta[]): string {
  const cells = ctas
    .map((c2) => `<td class="pjf-btn-cell" style="padding:6px 10px 6px 0;" align="left">${renderButton(c2)}</td>`)
    .join('\n');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 4px;"><tr>${cells}</tr></table>`;
}

// ── Body content helpers ────────────────────────────────────────────
export function p(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${BRAND.fonts.body};color:${c.text};font-size:16px;line-height:25px;">${html}</p>`;
}
export function lead(html: string): string {
  return `<p style="margin:0 0 18px;font-family:${BRAND.fonts.body};color:${c.text};font-size:17px;line-height:26px;font-weight:bold;">${html}</p>`;
}
/** Section label with a gold underline (mirrors the site's heading style). */
export function sectionLabel(text: string): string {
  return `<p style="margin:22px 0 12px;font-family:${BRAND.fonts.heading};color:${c.primary};font-size:18px;line-height:24px;font-weight:bold;border-bottom:3px solid ${c.secondary};display:inline-block;padding-bottom:4px;">${text}</p>`;
}
/** Gold left-bar callout. */
export function callout(title: string, body: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr>
    <td style="background:${c.softBg};border-left:4px solid ${c.secondary};border-radius:4px;padding:16px 18px;font-family:${BRAND.fonts.body};">
      <span style="display:block;font-family:${BRAND.fonts.heading};color:${c.primary};font-weight:bold;font-size:15px;margin-bottom:4px;">${title}</span>
      <span style="color:${c.text};font-size:15px;line-height:23px;">${body}</span>
    </td></tr></table>`;
}
/** Check-style list (gold markers). */
export function bullets(items: string[]): string {
  const lis = items
    .map(
      (i) =>
        `<tr><td valign="top" style="padding:0 10px 11px 0;font-family:${BRAND.fonts.heading};color:${c.secondary};font-weight:bold;font-size:16px;line-height:24px;">&#10003;</td>
         <td valign="top" style="padding:0 0 11px;font-family:${BRAND.fonts.body};color:${c.text};font-size:16px;line-height:24px;">${i}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px;">${lis}</table>`;
}

export interface EmailLayoutInput {
  preheader: string;
  /** Gold uppercase kicker above the title (e.g. "CLINIC CONSTRUCTION"). */
  eyebrow: string;
  /** Headline shown in the brand-blue hero band. */
  title: string;
  /** Body HTML placed in the white card below the hero. */
  body: string;
}

/** Wrap body in the PJF shell: logo header → blue hero band → white card →
 *  credibility strip → footer. */
export function emailLayout({ preheader, eyebrow, title, body }: EmailLayoutInput): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${BRAND.company}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; background:#eef2f6; }
  table { border-collapse:collapse; } img { border:0; line-height:100%; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { color:${c.primary}; }
  .pjf-card { width:600px; }
  @media only screen and (max-width:620px) {
    .pjf-card { width:100% !important; }
    .pjf-pad { padding-left:24px !important; padding-right:24px !important; }
    .pjf-hpad { padding-left:24px !important; padding-right:24px !important; }
    .pjf-btn, .pjf-btn-cell { display:block !important; width:100% !important; box-sizing:border-box; padding:6px 0 !important; }
    .pjf-btn { text-align:center; }
    .pjf-h1 { font-size:23px !important; line-height:29px !important; }
    .pjf-hdr-right { display:block !important; width:100% !important; text-align:center !important; padding-top:8px !important; }
    .pjf-hdr-left { display:block !important; width:100% !important; text-align:center !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#eef2f6;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#eef2f6;opacity:0;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f6;">
  <tr><td align="center" style="padding:24px 12px 32px;">
    <table role="presentation" class="pjf-card" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${c.border};">
      <!-- Header: logo + tagline -->
      <tr><td class="pjf-hpad" style="padding:20px 32px;background:#ffffff;border-bottom:1px solid ${c.border};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td class="pjf-hdr-left" align="left" valign="middle"><a href="${withUtm(BRAND.website, 'logo')}" target="_blank"><img src="${BRAND.logoLight}" width="158" alt="${BRAND.company}" style="display:block;width:158px;max-width:64%;height:auto;"></a></td>
          <td class="pjf-hdr-right" align="right" valign="middle" style="font-family:${BRAND.fonts.heading};color:${c.secondary};font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;">Quality. Integrity. Service.</td>
        </tr></table>
      </td></tr>
      <!-- Hero band -->
      <tr><td class="pjf-pad" style="padding:30px 40px;background:${c.primary};border-bottom:4px solid ${c.secondary};">
        <p style="margin:0 0 8px;font-family:${BRAND.fonts.heading};color:${c.secondary};font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;">${eyebrow}</p>
        <h1 class="pjf-h1" style="margin:0;font-family:${BRAND.fonts.heading};color:#ffffff;font-size:27px;line-height:33px;font-weight:bold;">${title}</h1>
      </td></tr>
      <!-- Body -->
      <tr><td class="pjf-pad" style="padding:30px 40px 34px;font-family:${BRAND.fonts.body};color:${c.text};font-size:16px;line-height:25px;background:#ffffff;">
${body}
      </td></tr>
      <!-- Credibility strip -->
      <tr><td class="pjf-pad" style="padding:16px 40px;background:${c.softBg};border-top:1px solid ${c.border};font-family:${BRAND.fonts.body};color:${c.muted};font-size:12px;line-height:18px;" align="center">
        <strong style="color:${c.primary};">50+ years</strong> building Utah&rsquo;s clinics &nbsp;&middot;&nbsp; Trusted by Tanner Clinic, St. Mark&rsquo;s Hospital &amp; Alpine Dental
      </td></tr>
      <!-- Footer -->
      <tr><td class="pjf-pad" style="padding:22px 40px 8px;background:#ffffff;font-family:${BRAND.fonts.body};color:${c.muted};font-size:13px;line-height:20px;" align="center">
        <strong style="color:${c.text};font-size:14px;">${BRAND.company}</strong><br>
        <span style="color:${c.secondary};font-weight:bold;letter-spacing:1px;font-size:11px;text-transform:uppercase;">Quality. Integrity. Service.</span><br>
        <a href="${withUtm(BRAND.website, 'footer')}" target="_blank" style="color:${c.primary};text-decoration:none;">pjfcorp.com</a> &nbsp;&middot;&nbsp; ${BRAND.phoneDisplay} &nbsp;&middot;&nbsp; Northern Utah
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
