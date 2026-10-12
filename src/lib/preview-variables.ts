// What every {{…}} tag resolves to in the editor preview, the /preview page,
// the PNG downloads and the test send.
//
// This used to keep its own account → value mapping beside the sender's, and
// the two drifted until the preview showed a dealership's real service phone
// while the inbox got a literal {{custom_values.service_phone}}. It now holds
// no mapping of its own: contact values come from contactMergeValues(),
// account values from accountMergeValues(), and substitution and auditing go
// through the sender's parser and filters. The only thing that is preview-only
// is the realistic sample text ("Alex", "(801) 555-0100") used to fill a blank
// so a layout can be judged — and that is switchable off.

import {
  accountMergeValues,
  type AccountMergeSource,
} from '@/lib/sending/account-merge-values';
import {
  applyBlastMergetags,
  applyContactCustomFields,
  applyMergetagFilters,
  contactMergeValues,
  parseMergetag,
  resolveMergetagValue,
  type BlastContactData,
  type BlastMergetagContext,
} from '@/lib/sending/blast-mergetags';

export interface PreviewAccountData extends AccountMergeSource {
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
  dateOfBirth?: string;
  /** The contact's custom fields, when the caller loaded them. */
  customFields?: Record<string, unknown> | null;
}

/**
 * The stand-in recipient for the editor preview and the test send. Clearly a
 * sample — nobody mistakes "Alex Customer" at example.com for a real person.
 */
export const SAMPLE_PREVIEW_CONTACT: BlastContactData = {
  firstName: 'Alex',
  lastName: 'Customer',
  fullName: 'Alex Customer',
  email: 'alex.customer@example.com',
  phone: '(801) 555-0199',
  address1: '450 N Main St',
  city: 'Layton',
  state: 'UT',
  postalCode: '84041',
  country: 'US',
  vehicleYear: '2021',
  vehicleMake: 'Mazda',
  vehicleModel: 'CX-5',
  vehicleVin: 'JM3KFACM7M1234567',
  vehicleMileage: '42000',
  lastServiceDate: '2025-10-05',
  nextServiceDate: '2026-03-05',
  leaseEndDate: '2027-02-01',
  warrantyEndDate: '2026-12-15',
  purchaseDate: '2021-03-20',
  dateOfBirth: '1988-06-15',
};

/** Sample fill for account fields the account hasn't set. Editor only. */
const SAMPLE_ACCOUNT_VALUES: Record<string, string> = {
  'location.name': 'Preview Dealer',
  'location.email': 'dealer@example.com',
  'location.phone': '(801) 555-0100',
  'location.address': '450 N Main St',
  'location.city': 'Layton',
  'location.state': 'UT',
  'location.postal_code': '84041',
  'custom_values.sales_phone': '(801) 555-0101',
  'custom_values.service_phone': '(801) 555-0102',
  'custom_values.parts_phone': '(801) 555-0103',
  'custom_values.dealer_name': 'Preview Dealer',
  'custom_values.crm_name': 'Preview Dealer',
};

function bareKey(variable: string): string {
  return variable.trim().replace(/^\{+\s*|\s*\}+$/g, '').trim();
}

function token(key: string): string {
  return `{{${key}}}`;
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

/**
 * The preview's tag → value map, keyed WITH braces (`{{contact.first_name}}`)
 * because that is the shape /api/preview and the editor exchange.
 *
 * Every tag the sender knows is present — an empty string when there's no
 * data — so an absent key always means "the sender won't recognize this".
 */
export function buildPreviewVariableMap(
  accountData?: PreviewAccountData | null,
  contact?: PreviewContact | null,
  options: PreviewVariableOptions = {},
): Record<string, string> {
  const sample = options.sampleFallbacks !== false;
  const timeZone = accountData?.timezone ?? null;
  const sampleContact = sample ? contactMergeValues(SAMPLE_PREVIEW_CONTACT, { timeZone }) : null;
  const realContact = contact ? contactMergeValues(contact, { timeZone }) : null;

  const ctx: BlastMergetagContext = {
    // A preview has no SendGrid to mint a real unsubscribe URL.
    unsubscribe_link: sample ? 'https://example.com/unsubscribe' : '',
    unsubscribe_url: sample ? 'https://example.com/unsubscribe' : '',
    // Empty at send time too: nothing fills it per recipient.
    'message.id': '',
  };

  // A selected contact's real values win; a blank falls back to the sample.
  for (const [key, value] of Object.entries(contactMergeValues(null))) {
    ctx[key] = realContact?.[key] || sampleContact?.[key] || value;
  }

  for (const [key, value] of Object.entries(accountMergeValues(accountData))) {
    ctx[key] = value || (sample ? SAMPLE_ACCOUNT_VALUES[key] ?? '' : '');
  }

  // Same resolution order as the send: the contact's own custom field beats
  // the account's value of the same name.
  if (contact?.customFields) applyContactCustomFields(ctx, contact.customFields, { timeZone });

  // Per-account preview overrides: an explicit "show this in the editor".
  for (const [rawKey, rawValue] of Object.entries(accountData?.previewValues ?? {})) {
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    const key = bareKey(rawKey);
    if (key) ctx[key] = String(rawValue);
  }

  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(ctx)) values[token(key)] = value;
  return values;
}

/** The bare-keyed context the substitution engine wants, from a preview map. */
export function previewMapToContext(
  previewValues: Record<string, string>,
): BlastMergetagContext {
  const ctx: BlastMergetagContext = {};
  for (const [rawKey, value] of Object.entries(previewValues)) {
    const key = bareKey(rawKey);
    if (key) ctx[key] = typeof value === 'string' ? value : String(value ?? '');
  }
  return ctx;
}

/**
 * Substitute a preview map into HTML (or text) with the SENDER's engine —
 * filters, `default:` fallbacks, case-insensitive custom keys, URL-aware
 * encoding inside href/src — so the preview can't render a tag differently
 * from the inbox. Exact-string replacement of `{{key}}` (what /api/preview and
 * the editor canvas still do) misses every tag with a filter or odd spacing.
 */
export function applyPreviewVariables(
  html: string,
  previewValues: Record<string, string>,
  options: { escape?: boolean } = {},
): string {
  return applyBlastMergetags(html, previewMapToContext(previewValues), {
    escape: options.escape !== false,
  });
}

export interface PreviewVariableAudit {
  /**
   * Tags that would ship to the inbox as literal `{{...}}` text — a typo like
   * {{email.unsubscribe_link}}, a token from another ESP, an unsupported
   * filter, template syntax Loomi doesn't run. Preflight BLOCKS the send over
   * these, so they are a different problem from a blank value and have to
   * read differently.
   */
  invalid: string[];
  /**
   * Real tags the current preview context has no value for. These render
   * as an empty string — a send-safe, fixable-with-data situation.
   */
  blank: string[];
}

/**
 * Classify the {{...}} tags in a template against the preview map.
 *
 * These two cases used to be merged into one "Missing Preview Data" list
 * whose copy told the user to "select a contact with this data" — advice
 * that can never fix a misspelled token. The typo then sailed through the
 * editor and only surfaced as a hard blocker on the Schedule step, which is
 * the worst possible place to learn about it. The audit now parses tags with
 * the sender's own parser, so anything the Schedule step would block, the
 * editor flags first.
 */
export function auditPreviewVariables(
  templateHtml: string,
  previewValues: Record<string, string>,
): PreviewVariableAudit {
  const ctx = previewMapToContext(previewValues);
  const invalid = new Set<string>();
  const blank = new Set<string>();

  for (const match of (templateHtml || '').matchAll(/\{\{([^{}]{0,1000})\}\}/g)) {
    const parsed = parseMergetag(match[1]);
    if (parsed.problem) {
      invalid.add(parsed.source);
      continue;
    }
    const value = resolveMergetagValue(ctx, parsed.key);
    if (value === undefined) {
      // custom_values.* can come from a contact's own fields at send time,
      // which the preview can't enumerate — a data gap, not a typo. Preflight
      // decides whether ANY account or contact can fill it.
      if (parsed.key.startsWith('custom_values.')) blank.add(parsed.key);
      else invalid.add(parsed.key);
    } else if (!applyMergetagFilters(value, parsed.filters)) {
      blank.add(parsed.key);
    }
  }

  return { invalid: [...invalid].sort(), blank: [...blank].sort() };
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
