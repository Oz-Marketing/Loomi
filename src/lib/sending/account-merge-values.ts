// Account-level merge values: the ONE mapping from an account to the
// {{location.*}} tags and the account-backed {{custom_values.*}} tags.
//
// WHY THIS EXISTS
// ───────────────
// The editor preview and the blast sender each used to carry their own copy
// of this mapping, and the two had drifted badly. The preview filled
// {{custom_values.service_phone}}, the logo URL, the brand colors and every
// account custom value from the ACCOUNT; the sender only ever looked at the
// CONTACT's custom fields and loaded none of those account columns. So the
// editor showed the dealership's real service number and logo, and the inbox
// got a literal `{{custom_values.service_phone}}`. {{location.email}}
// disagreed as well — the preview showed the public business email, the send
// used the bulk From address.
//
// Both sides now call accountMergeValues(), so there is nothing left to drift.
// The preview layers its "(801) 555-0100"-style sample fill on top for blanks;
// the send never does.
//
// Pure and client-safe on purpose: the editor imports it through
// lib/preview-variables.ts. The database loader lives in ./blast-account-data.ts.

/**
 * Anything account-shaped: a database row (logos/branding/customValues as JSON
 * strings), the /api/accounts payload (already-parsed objects), or the
 * editor's PreviewAccountData. Every field is optional and untrusted.
 */
export interface AccountMergeSource {
  dealer?: string | null;
  /** The public business email — what {{location.email}} shows. */
  email?: string | null;
  /** The bulk From address. Only a fallback for {{location.email}}. */
  senderEmail?: string | null;
  phone?: string | null;
  salesPhone?: string | null;
  servicePhone?: string | null;
  partsPhone?: string | null;
  /** Aliases the /api/accounts payload uses for the three department phones. */
  phoneSales?: string | null;
  phoneService?: string | null;
  phoneParts?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  website?: string | null;
  /** IANA zone; used to put a contact's timestamps on the account's calendar day. */
  timezone?: string | null;
  storefrontImage?: string | null;
  /** `{ light, dark, white?, black? }` — JSON string or object. */
  logos?: unknown;
  /** `{ colors: {...}, fonts: {...} }` — JSON string or object. */
  branding?: unknown;
  /** `Record<key, { name, value }>` — JSON string or object. */
  customValues?: unknown;
}

/** Tags every account answers, whether or not it filled the field in. */
export const LOCATION_TOKEN_KEYS = [
  'location.name',
  'location.email',
  'location.phone',
  'location.address',
  'location.city',
  'location.state',
  'location.postal_code',
  'location.website',
] as const;

/**
 * Account-backed custom values the variable picker advertises. An account's
 * own customValues entry with the same key always wins; these only fill what
 * it left unset.
 */
export const STANDARD_ACCOUNT_CUSTOM_VALUES = [
  'sales_phone',
  'service_phone',
  'parts_phone',
  'dealer_name',
  'crm_name',
  'storefront_image',
  'brand_primary_color',
  'brand_secondary_color',
  'brand_accent_color',
  'brand_background_color',
  'brand_text_color',
  'brand_heading_font',
  'brand_body_font',
  'website_url',
  'service_scheduler_url',
  'logo_url',
  'review_link',
  'trade_in_url',
  'specials_url',
  'facebook',
  'instagram',
  'tiktok',
  'x',
  'youtube',
] as const;

export const CUSTOM_VALUES_PREFIX = 'custom_values.';

/**
 * Comparison form of a custom field / custom value key.
 *
 * CSV import keeps raw column headers as keys, so one dealership's contacts
 * carry `Trade In Value` while the template says {{custom_values.trade_in_value}}
 * and another import wrote `trade-in-value`. An exact-match lookup can never
 * connect those, so every custom key is compared case-insensitively with
 * spaces, underscores and hyphens collapsed to one separator.
 */
export function normalizeMergeKey(key: string): string {
  return key
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** A JSON object from a JSON string or an object; anything else is null. */
export function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstOf(...values: unknown[]): string {
  for (const value of values) {
    const trimmed = text(value);
    if (trimmed) return trimmed;
  }
  return '';
}

/** The value of one customValues entry: `{ name, value }`, or a bare string. */
function customValueText(def: unknown): string {
  if (typeof def === 'string') return def.trim();
  if (def && typeof def === 'object' && !Array.isArray(def)) {
    const value = (def as Record<string, unknown>).value;
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

/**
 * Every account-level tag value, keyed without braces
 * (`location.name`, `custom_values.service_phone`, …).
 *
 * Real data only: a field the account never filled in maps to ''. The key
 * still EXISTS, which matters — an absent key reads as an unrecognized tag
 * (preflight blocks it, the preview flags it as a typo), whereas a present
 * empty one is a data gap.
 */
export function accountMergeValues(
  account?: AccountMergeSource | null,
): Record<string, string> {
  const a: AccountMergeSource = account ?? {};
  const logos = parseJsonObject(a.logos) ?? {};
  const branding = parseJsonObject(a.branding) ?? {};
  const colors = parseJsonObject(branding.colors) ?? {};
  const fonts = parseJsonObject(branding.fonts) ?? {};

  const dealer = text(a.dealer);
  const mainPhone = text(a.phone);
  const website = text(a.website);

  const values: Record<string, string> = {
    'location.name': dealer,
    // The PUBLIC business email. The bulk From address is a fallback only:
    // it is usually a no-reply-style marketing mailbox, which is not what a
    // "questions? email us at…" line should hand a customer.
    'location.email': firstOf(a.email, a.senderEmail),
    'location.phone': mainPhone,
    'location.address': text(a.address),
    'location.city': text(a.city),
    'location.state': text(a.state),
    'location.postal_code': text(a.postalCode),
    'location.website': website,
  };

  const derived: Record<(typeof STANDARD_ACCOUNT_CUSTOM_VALUES)[number], string> = {
    // Sales falls back to the main number — for most rooftops it IS the sales
    // line. Service and parts deliberately don't: sending a service customer
    // to the sales desk is worse than leaving the line out.
    sales_phone: firstOf(a.phoneSales, a.salesPhone, mainPhone),
    service_phone: firstOf(a.phoneService, a.servicePhone),
    parts_phone: firstOf(a.phoneParts, a.partsPhone),
    dealer_name: dealer,
    crm_name: dealer,
    storefront_image: text(a.storefrontImage),
    brand_primary_color: text(colors.primary),
    brand_secondary_color: text(colors.secondary),
    brand_accent_color: text(colors.accent),
    brand_background_color: text(colors.background),
    brand_text_color: text(colors.text),
    brand_heading_font: text(fonts.heading),
    brand_body_font: text(fonts.body),
    website_url: website,
    service_scheduler_url: '',
    logo_url: firstOf(logos.light, logos.dark),
    review_link: '',
    trade_in_url: '',
    specials_url: '',
    facebook: '',
    instagram: '',
    tiktok: '',
    x: '',
    youtube: '',
  };

  // One entry per NORMALIZED key, so an account custom value saved as
  // "Service Phone" overrides the derived service_phone instead of sitting
  // beside it as a second, competing tag.
  const custom = new Map<string, { key: string; value: string }>();
  for (const [key, value] of Object.entries(derived)) {
    custom.set(normalizeMergeKey(key), { key, value });
  }
  const accountCustom = parseJsonObject(a.customValues) ?? {};
  for (const [rawKey, def] of Object.entries(accountCustom)) {
    const key = rawKey.trim();
    const norm = normalizeMergeKey(key);
    if (!norm) continue;
    const value = customValueText(def);
    const existing = custom.get(norm);
    if (existing) {
      // An entry the account cleared doesn't erase the derived value.
      if (value) existing.value = value;
      continue;
    }
    custom.set(norm, { key, value });
  }
  for (const { key, value } of custom.values()) {
    values[`${CUSTOM_VALUES_PREFIX}${key}`] = value;
  }

  return values;
}
