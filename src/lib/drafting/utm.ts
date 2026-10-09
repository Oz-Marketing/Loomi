/**
 * UTM tagging for drafted emails.
 *
 * House rule: every clickable link carries utm_source=email, utm_medium=email,
 * utm_campaign={slug-with-month-year}, and a utm_content that differs per link
 * — the hero image and the button beside it usually go to the same page, and
 * a shared utm_content would make the two clicks indistinguishable.
 *
 * Drafts are tagged when they're assembled, link by link. Loomi's send-time
 * `applyUtmTags` stamps ONE utm_content on every link, but it never overwrites
 * a parameter a link already carries, so tagging here survives a Loomi send.
 *
 * Pure.
 */

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const;

/** `accord-lx-monthly-offer-october-2026` — the shape every utm_campaign must have. */
export const UTM_CAMPAIGN_PATTERN = new RegExp(
  `^[a-z0-9]+(?:-[a-z0-9]+)*-(?:${MONTHS.join('|')})-\\d{4}$`,
);

/** Kebab-case `name` and suffix the send month: "CX-90 Monthly Offer", Oct 2026 → "cx-90-monthly-offer-october-2026". */
export function campaignSlug(name: string, month: number, year: number): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const monthName = MONTHS[month - 1];
  if (!monthName) throw new Error(`campaignSlug: month must be 1-12, got ${month}`);
  return `${base || 'email'}-${monthName}-${year}`;
}

export const UTM_SOURCE = 'email';
export const UTM_MEDIUM = 'email';

/** `url` with the house UTM set applied, overwriting any stale values. */
export function tagLink(url: string, campaign: string, content: string): string {
  const u = new URL(url);
  u.searchParams.set('utm_source', UTM_SOURCE);
  u.searchParams.set('utm_medium', UTM_MEDIUM);
  u.searchParams.set('utm_campaign', campaign);
  u.searchParams.set('utm_content', content);
  return u.toString();
}
