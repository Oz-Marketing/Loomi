import {
  resolveAccountAddress,
  resolveAccountCity,
  resolveAccountDealerName,
  resolveAccountEmail,
  resolveAccountPhone,
  resolveAccountPostalCode,
  resolveAccountState,
  resolveAccountWebsite,
} from '@/lib/account-resolvers';

export interface PreviewAccountData {
  dealer?: string;
  email?: string;
  phone?: string;
  salesPhone?: string;
  servicePhone?: string;
  partsPhone?: string;
  phoneSales?: string;
  phoneService?: string;
  phoneParts?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  website?: string;
  timezone?: string;
  storefrontImage?: string;
  branding?: {
    colors?: {
      primary?: string;
      secondary?: string;
      accent?: string;
      background?: string;
      text?: string;
    };
    fonts?: {
      heading?: string;
      body?: string;
    };
  };
  customValues?: Record<string, { name: string; value: string }>;
  logos?: {
    light?: string;
    dark?: string;
    white?: string;
    black?: string;
  };
  previewValues?: Record<string, string>;
}

export interface PreviewContact {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleVin?: string;
  vehicleMileage?: string;
  lastServiceDate?: string;
  nextServiceDate?: string;
  leaseEndDate?: string;
  warrantyEndDate?: string;
  purchaseDate?: string;
}

function token(variable: string): string {
  const trimmed = variable.trim();
  if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) return trimmed;
  return `{{${trimmed.replace(/^\{+|\}+$/g, '')}}}`;
}

function mergeTokenMap(
  target: Record<string, string>,
  source?: Record<string, string | undefined | null>,
) {
  if (!source) return;
  for (const [rawKey, rawValue] of Object.entries(source)) {
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    target[token(rawKey)] = String(rawValue);
  }
}

function fallbackContactDefaults(): Record<string, string> {
  return {
    '{{contact.first_name}}': 'Alex',
    '{{contact.last_name}}': 'Customer',
    '{{contact.full_name}}': 'Alex Customer',
    '{{contact.email}}': 'alex.customer@example.com',
    '{{contact.phone}}': '(801) 555-0199',
    '{{contact.address1}}': '450 N Main St',
    '{{contact.city}}': 'Layton',
    '{{contact.state}}': 'UT',
    '{{contact.postal_code}}': '84041',
    '{{contact.country}}': 'US',
    '{{contact.vehicle_year}}': '2021',
    '{{contact.vehicle_make}}': 'Mazda',
    '{{contact.vehicle_model}}': 'CX-5',
    '{{contact.vehicle_vin}}': 'JM3KFACM7M1234567',
    '{{contact.vehicle_mileage}}': '42000',
    '{{contact.last_service_date}}': '2025-10-05',
    '{{contact.next_service_date}}': '2026-03-05',
    '{{contact.lease_end_date}}': '2027-02-01',
    '{{contact.warranty_end_date}}': '2026-12-15',
    '{{contact.purchase_date}}': '2021-03-20',
  };
}

export interface PreviewVariableOptions {
  /**
   * Fill a token the real data doesn't cover with a realistic stand-in
   * ("Alex", "(801) 555-0100").
   *
   * True — the default — for the EDITOR, where the whole point is to see
   * the layout carrying plausible text. False for anything that LEAVES the
   * building: a downloaded PNG gets forwarded to a client, and an invented
   * dealer phone number is indistinguishable from a real one to whoever
   * receives it. With it off, a token we recognize but have no data for
   * resolves to nothing — the same thing a recipient with a blank field
   * gets at send time — while an unrecognized token is still left standing
   * as `{{…}}` so a typo stays catchable.
   */
  sampleFallbacks?: boolean;
}

export function buildPreviewVariableMap(
  accountData?: PreviewAccountData | null,
  contact?: PreviewContact | null,
  options: PreviewVariableOptions = {},
): Record<string, string> {
  const sample = options.sampleFallbacks !== false;
  const or = (value: string) => (sample ? value : '');

  const values: Record<string, string> = {
    '{{unsubscribe_link}}': or('https://example.com/unsubscribe'),
    '{{message.id}}': or('preview-message-id'),
  };

  if (sample) {
    mergeTokenMap(values, fallbackContactDefaults());
  } else {
    // The key still has to EXIST. mergeTokenMap skips an empty value, and a
    // key that is absent reads as an unrecognized token — the audit calls it
    // invalid and the substituter leaves the raw `{{…}}` in the download,
    // which is the bug this is meant to stop.
    for (const key of Object.keys(fallbackContactDefaults())) values[key] = '';
  }

  if (contact) {
    mergeTokenMap(values, {
      '{{contact.first_name}}': contact.firstName,
      '{{contact.last_name}}': contact.lastName,
      '{{contact.full_name}}': contact.fullName || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.firstName,
      '{{contact.email}}': contact.email,
      '{{contact.phone}}': contact.phone,
      '{{contact.address1}}': contact.address1,
      '{{contact.city}}': contact.city,
      '{{contact.state}}': contact.state,
      '{{contact.postal_code}}': contact.postalCode,
      '{{contact.country}}': contact.country,
      '{{contact.vehicle_year}}': contact.vehicleYear,
      '{{contact.vehicle_make}}': contact.vehicleMake,
      '{{contact.vehicle_model}}': contact.vehicleModel,
      '{{contact.vehicle_vin}}': contact.vehicleVin,
      '{{contact.vehicle_mileage}}': contact.vehicleMileage,
      '{{contact.last_service_date}}': contact.lastServiceDate,
      '{{contact.next_service_date}}': contact.nextServiceDate,
      '{{contact.lease_end_date}}': contact.leaseEndDate,
      '{{contact.warranty_end_date}}': contact.warrantyEndDate,
      '{{contact.purchase_date}}': contact.purchaseDate,
    });
  }

  const dealerName = resolveAccountDealerName(accountData, or('Preview Dealer'));
  const brandingColors = accountData?.branding?.colors;
  const brandingFonts = accountData?.branding?.fonts;
  const locationTokens: Record<string, string> = {
    '{{location.name}}': dealerName,
    '{{location.email}}': resolveAccountEmail(accountData, or('dealer@example.com')),
    '{{location.phone}}': resolveAccountPhone(accountData, or('(801) 555-0100')),
    '{{location.address}}': resolveAccountAddress(accountData, or('450 N Main St')),
    '{{location.city}}': resolveAccountCity(accountData, or('Layton')),
    '{{location.state}}': resolveAccountState(accountData, or('UT')),
    '{{location.postal_code}}': resolveAccountPostalCode(accountData, or('84041')),
    '{{location.website}}': resolveAccountWebsite(accountData),
  };
  if (sample) mergeTokenMap(values, locationTokens);
  else Object.assign(values, locationTokens);

  // Custom values — from customValues field (dynamic), with static defaults
  if (accountData?.customValues) {
    for (const [fieldKey, cv] of Object.entries(accountData.customValues)) {
      if (cv.value) {
        values[token(`custom_values.${fieldKey}`)] = cv.value;
      }
    }
  }

  // Static defaults for standard custom values. An account customValues
  // entry always wins — these only fill what it left unset.
  const mainPhone = resolveAccountPhone(accountData);
  const customValueDefaults: Record<string, string> = {
    // Phone numbers
    '{{custom_values.sales_phone}}':
      accountData?.phoneSales || accountData?.salesPhone || mainPhone || or('(801) 555-0101'),
    '{{custom_values.service_phone}}':
      accountData?.phoneService || accountData?.servicePhone || or('(801) 555-0102'),
    '{{custom_values.parts_phone}}':
      accountData?.phoneParts || accountData?.partsPhone || or('(801) 555-0103'),
    // Branding
    '{{custom_values.dealer_name}}': dealerName,
    '{{custom_values.crm_name}}': dealerName,
    '{{custom_values.storefront_image}}': accountData?.storefrontImage || '',
    '{{custom_values.brand_primary_color}}': brandingColors?.primary || '',
    '{{custom_values.brand_secondary_color}}': brandingColors?.secondary || '',
    '{{custom_values.brand_accent_color}}': brandingColors?.accent || '',
    '{{custom_values.brand_background_color}}': brandingColors?.background || '',
    '{{custom_values.brand_text_color}}': brandingColors?.text || '',
    '{{custom_values.brand_heading_font}}': brandingFonts?.heading || '',
    '{{custom_values.brand_body_font}}': brandingFonts?.body || '',
    // URLs
    '{{custom_values.website_url}}': resolveAccountWebsite(accountData),
    '{{custom_values.service_scheduler_url}}': '',
    '{{custom_values.logo_url}}': accountData?.logos?.light || accountData?.logos?.dark || '',
    '{{custom_values.review_link}}': '',
    '{{custom_values.trade_in_url}}': '',
    '{{custom_values.specials_url}}': '',
    // Socials
    '{{custom_values.facebook}}': '',
    '{{custom_values.instagram}}': '',
    '{{custom_values.tiktok}}': '',
    '{{custom_values.x}}': '',
    '{{custom_values.youtube}}': '',
  };
  for (const [key, value] of Object.entries(customValueDefaults)) {
    if (values[key]) continue;
    // In sample mode an empty default is left OUT, exactly as it always was.
    if (sample && !value) continue;
    values[key] = value;
  }

  mergeTokenMap(values, accountData?.previewValues);

  return values;
}

export interface PreviewVariableAudit {
  /**
   * Tokens no namespace recognizes — a typo like {{email.unsubscribe_link}}
   * or a token from another ESP. These ship to the inbox as literal
   * `{{...}}` text and preflight BLOCKS the send over them, so they are a
   * different problem from a blank value and have to read differently.
   */
  invalid: string[];
  /**
   * Real tokens the current preview context has no value for. These render
   * as an empty string — a send-safe, fixable-with-data situation.
   */
  blank: string[];
}

/**
 * Classify the {{...}} tokens in a template against the preview map.
 *
 * These two cases used to be merged into one "Missing Preview Data" list
 * whose copy told the user to "select a contact with this data" — advice
 * that can never fix a misspelled token. The typo then sailed through the
 * editor and only surfaced as a hard blocker on the Schedule step, which is
 * the worst possible place to learn about it.
 */
export function auditPreviewVariables(
  templateHtml: string,
  previewValues: Record<string, string>,
): PreviewVariableAudit {
  // Match all {{...}} tokens (non-greedy, single-line)
  const tokenRegex = /\{\{([^}]+)\}\}/g;
  const seen = new Set<string>();
  const invalid: string[] = [];
  const blank: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(templateHtml)) !== null) {
    const varName = match[1].trim();
    // Skip Maizzle expressions / helpers (contain pipes, parens, or are single words like "yield")
    if (!varName || varName.includes('|') || varName.includes('(') || varName === 'yield' || varName.startsWith('#') || varName.startsWith('/')) continue;

    const tokenKey = `{{${varName}}}`;
    if (seen.has(varName)) continue;
    seen.add(varName);

    const value = previewValues[tokenKey];
    if (value === undefined) {
      // custom_values.* is per-account/per-contact and the preview map
      // can't enumerate every one, so treat it as valid-but-unknown here.
      // blast-preflight.ts exempts the same prefix for the same reason.
      if (varName.startsWith('custom_values.')) {
        blank.push(varName);
      } else {
        invalid.push(varName);
      }
    } else if (value === '') {
      blank.push(varName);
    }
  }

  return { invalid: invalid.sort(), blank: blank.sort() };
}

/**
 * Scan template HTML for {{...}} tokens that are NOT covered by the
 * preview variable map — i.e. tokens that will render as raw mustache
 * text in the final email.
 *
 * Returns a deduplicated, sorted list of missing variable names
 * (without the {{ }} wrappers).
 *
 * @deprecated Prefer auditPreviewVariables(), which separates a misspelled
 * token (blocks the send) from a real one with no data (renders blank).
 */
export function findMissingPreviewVariables(
  templateHtml: string,
  previewValues: Record<string, string>,
): string[] {
  const { invalid, blank } = auditPreviewVariables(templateHtml, previewValues);
  return [...invalid, ...blank].sort();
}
