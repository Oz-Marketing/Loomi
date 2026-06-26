// PJF Corporation — campaign brand + identity constants.
// Mirrors the values set on the live PJF Corp subaccount (Business Details,
// Brand Colors, Fonts) so the local-dev subaccount renders identically.
//
// Source of truth for everything the provisioning script + content modules
// reference. Change a value here, re-run `npx tsx scripts/pjf/provision.ts`.

export const ACCOUNT_KEY = 'pjfCorp';
export const ACCOUNT_SLUG = 'pjf-corp';

export const BRAND = {
  company: 'PJF Corporation',
  tagline: 'Commercial Contractor — Dental & Medical Clinic Construction',
  // Business details (from the live subaccount)
  email: 'rbarton@pjfcorp.com',
  phone: '8015466444',
  phoneDisplay: '(801) 546-6444',
  website: 'https://pjfcorp.com',
  address: '905 Marshall Way N Suite C',
  city: 'Layton',
  state: 'UT',
  postalCode: '84041',
  category: 'Construction',
  timezone: 'America/Denver', // Mountain (MT)

  // Brand colors
  colors: {
    primary: '#005696', // deep blue
    secondary: '#dfb817', // gold
    accent: '#0ea5e9', // sky blue
    background: '#ffffff',
    text: '#111827',
    // derived helpers (not stored on the account)
    muted: '#6b7280',
    border: '#e5e7eb',
    softBg: '#f4f7fa',
  },

  // Fonts (web-safe stacks — sans-serif only, per brand rules)
  fonts: {
    heading: 'Helvetica, Arial, sans-serif',
    body: 'Arial, Helvetica, sans-serif',
    headingName: 'Helvetica',
    bodyName: 'Arial',
  },

  logoLight:
    'https://loomi-media.sfo3.digitaloceanspaces.com/logos/pjfCorp/light-7eb2382222f14bb9bba1200f3f985a50.png',

  // Sending identity (dedicated, warmed subdomain — configured now, sending
  // stays inert in dev until a SendGrid key is attached).
  senderEmail: 'communications@news.pjfcorp.com',
  senderName: 'PJF Corporation',
  sendingDomain: 'news.pjfcorp.com',
  replyToEmail: 'rbarton@pjfcorp.com', // monitored human inbox for cold-email replies
} as const;

// ── Campaign constants ──────────────────────────────────────────────

// Public base for clickable links (where the published LPs/forms live in
// prod). Override with PJF_PUBLIC_BASE for a different host.
export const PUBLIC_BASE = process.env.PJF_PUBLIC_BASE || 'https://studio.loomilm.com';

// utm_campaign slug — {slug}-{launch month-year}. Launch: late July 2026.
export const CAMPAIGN_SLUG = 'pjf-dental-conquest';
export const CAMPAIGN_MONTH = '2026-07';
export const UTM_CAMPAIGN = `${CAMPAIGN_SLUG}-${CAMPAIGN_MONTH}`;

/** Append the campaign UTM scheme to a URL. utm_content = descriptor. */
export function withUtm(url: string, descriptor: string): string {
  const sep = url.includes('?') ? '&' : '?';
  const params = new URLSearchParams({
    utm_source: 'email',
    utm_medium: 'email',
    utm_campaign: UTM_CAMPAIGN,
    utm_content: descriptor,
  });
  return `${url}${sep}${params.toString()}`;
}

// Placeholder lead-magnet asset (swap for the real gated PDF when supplied).
export const LEAD_MAGNET_PDF_PLACEHOLDER = `${PUBLIC_BASE}/assets/pjf/clinic-build-guide.pdf`;

// Funnel tags (lifecycle stages — Loomi has no native pipeline).
export const TAGS = {
  campaign: 'pjf-dental-conquest',
  prospect: 'pjf-prospect',
  engaged: 'pjf-engaged',
  optedIn: 'pjf-opted-in',
  qualified: 'pjf-qualified',
  handoff: 'pjf-handoff',
} as const;
