import type { AdData } from './types';

/**
 * The campaign shape a launch uses, and the platform rules that override it.
 *
 * Pure — no prisma, no network — because the interesting part is policy
 * arithmetic and it needs to be testable without a database or a Graph token.
 */

// ── special ad categories ────────────────────────────────────────────────────

/**
 * Meta's current `special_ad_categories` values.
 *
 * `CREDIT` is NOT here on purpose: Meta retired it on 14 January 2025 and
 * replaced it with `FINANCIAL_PRODUCTS_SERVICES`. Passing the old value now gets
 * the campaign rejected, and the spec this was built from still named it — so the
 * list is spelled out rather than left to a caller's memory.
 */
export const SPECIAL_AD_CATEGORIES = [
  'HOUSING',
  'FINANCIAL_PRODUCTS_SERVICES',
  'EMPLOYMENT',
  'ISSUES_ELECTIONS_POLITICS',
  'NONE',
] as const;
export type SpecialAdCategory = (typeof SPECIAL_AD_CATEGORIES)[number];

/**
 * Targeting Meta forces when a financial-products category applies. Not advice —
 * the API rejects anything tighter, so these are the values a launch must use.
 */
export const FINANCIAL_TARGETING_FLOOR = {
  /** Miles, US/Canada. Zip/postal targeting is unavailable entirely. */
  minRadiusMiles: 15,
  minAge: 18,
  maxAge: 65,
  /** Detailed targeting is restricted and exclusions are not permitted at all. */
  allowsDetailedTargeting: false,
  allowsExclusions: false,
} as const;

/** Offer types that are inherently credit advertising. */
const FINANCING_OFFER_TYPES = new Set(['lease', 'apr']);

/**
 * Text that indicates financing even when the offer type doesn't.
 *
 * Meta's rule reaches any ad that promotes a credit opportunity, including one
 * where the financing appears only in the fine print — and a dealer disclaimer
 * saying "with approved credit" is exactly that. So a cash-back ad carrying a
 * credit disclaimer still qualifies.
 */
const FINANCING_SIGNALS = [
  /\bapr\b/i,
  /\bfinanc(e|ing|ed)\b/i,
  /\bleas(e|ing)\b/i,
  /approved credit/i,
  /credit[- ]qualified/i,
  /\bmonthly payment\b/i,
  /\bper month\b/i,
  /\/mo\b/i,
  /\bdown payment\b/i,
  /\bdue at signing\b/i,
  /\bwell[- ]qualified (buyers|lessees)\b/i,
];

export interface CategoryDecision {
  categories: SpecialAdCategory[];
  /** Why, in one line — this goes in front of a person, not just a log. */
  reason: string;
}

/**
 * Which special ad categories this ad must be created under.
 *
 * DERIVED, never configured. The category is a consequence of what the ad says,
 * so letting someone set it would only let them be wrong: Meta applies the
 * restriction regardless, and the campaign is rejected — or, worse, runs
 * mis-targeted against a policy nobody checked.
 *
 * Biased toward APPLYING it. A false positive costs reach (a wider radius, no
 * demographic narrowing). A false negative risks a rejected campaign and a policy
 * strike against the ad account, which is shared across every rooftop. Those are
 * not comparable costs.
 */
export function specialAdCategoriesFor(params: {
  offerType?: string | null;
  /** Any text the ad publishes — captions, disclaimer, on-image copy. */
  texts?: (string | null | undefined)[];
}): CategoryDecision {
  const offerType = (params.offerType ?? '').trim().toLowerCase();
  if (FINANCING_OFFER_TYPES.has(offerType)) {
    return {
      categories: ['FINANCIAL_PRODUCTS_SERVICES'],
      reason: `A ${offerType} offer is credit advertising, so Meta's financial-products restrictions apply.`,
    };
  }

  for (const text of params.texts ?? []) {
    if (!text) continue;
    const hit = FINANCING_SIGNALS.find((re) => re.test(text));
    if (hit) {
      return {
        categories: ['FINANCIAL_PRODUCTS_SERVICES'],
        reason: `This ad's text refers to financing (${hit.source.replace(/\\b|\(|\)/g, '')}), which brings it under Meta's financial-products restrictions even though the offer type is "${offerType || 'unset'}".`,
      };
    }
  }

  return {
    categories: ['NONE'],
    reason: 'Nothing in this ad advertises credit, so no special ad category applies.',
  };
}

/** Does this decision trigger the financial-products targeting floor? */
export function isFinancialCategory(categories: SpecialAdCategory[]): boolean {
  return categories.includes('FINANCIAL_PRODUCTS_SERVICES');
}

// ── destination URL ──────────────────────────────────────────────────────────

/** Fill `{{year}} {{make}} {{model}} {{vin}} {{trim}}` from the ad's data. */
export function fillUrlTemplate(template: string, data: AdData): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => {
    const v = data[key];
    return v ? encodeURIComponent(v) : '';
  });
}

/**
 * The click destination, with UTMs.
 *
 * Existing query parameters on the template are preserved — a dealer SRP URL
 * frequently carries its own filters, and clobbering them would send the traffic
 * to the wrong inventory.
 */
export function destinationUrl(params: {
  urlTemplate?: string | null;
  fallbackUrl?: string | null;
  data: AdData;
  utm?: { source?: string | null; medium?: string | null; campaign?: string | null };
}): string | null {
  const raw = (params.urlTemplate?.trim() || params.fallbackUrl?.trim() || '').trim();
  if (!raw) return null;
  const filled = fillUrlTemplate(raw, params.data);

  let url: URL;
  try {
    url = new URL(filled.startsWith('http') ? filled : `https://${filled}`);
  } catch {
    return null;
  }
  const utm = params.utm ?? {};
  if (utm.source) url.searchParams.set('utm_source', utm.source);
  if (utm.medium) url.searchParams.set('utm_medium', utm.medium);
  if (utm.campaign) url.searchParams.set('utm_campaign', utm.campaign);
  return url.toString();
}

// ── the resolved launch shape ────────────────────────────────────────────────

/** A stored preset, as the resolver reads it. */
export interface PresetRow {
  platform: string;
  objective: string;
  bidStrategy?: string | null;
  dailyBudget?: string | null;
  flightDays: number;
  geoZip?: string | null;
  geoRadiusMiles: number;
  audienceSpec?: string | null;
  destinationMode: string;
  urlTemplate?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  sizeIds?: string | null;
}

export interface ResolvedLaunch {
  objective: string;
  bidStrategy: string | null;
  dailyBudget: string | null;
  flightDays: number;
  geoZip: string | null;
  geoRadiusMiles: number;
  specialAdCategories: SpecialAdCategory[];
  /** Age/gender/detailed-targeting limits in force, or null when unrestricted. */
  targetingFloor: typeof FINANCIAL_TARGETING_FLOOR | null;
  destinationUrl: string | null;
  sizeIds: string[];
  /** Everything a person should be told before this is published. */
  notices: string[];
}

/** Defaults for an account that has never saved a preset, so a launch is still
 *  possible on day one — a traffic campaign to the dealer's site. */
export const PRESET_DEFAULTS: Omit<PresetRow, 'platform'> = {
  objective: 'OUTCOME_TRAFFIC',
  bidStrategy: null,
  dailyBudget: null,
  flightDays: 30,
  geoZip: null,
  geoRadiusMiles: 25,
  audienceSpec: null,
  destinationMode: 'dealer_site',
  urlTemplate: null,
  utmSource: 'meta',
  utmMedium: 'paid_social',
  utmCampaign: null,
  sizeIds: null,
};

function jsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Resolve a preset against one ad into the shape a launch actually uses, applying
 * every platform override.
 *
 * The overrides are applied HERE rather than checked later on purpose: a
 * validation step that reports "your radius is too small" leaves the caller to
 * fix it and the ad unlaunched, whereas raising the radius and saying so produces
 * a launchable campaign and an honest note about why it differs from the preset.
 */
export function resolveLaunch(params: {
  preset?: PresetRow | null;
  data: AdData;
  /** Ad text that decides the category — captions and the disclaimer. */
  texts?: (string | null | undefined)[];
  /** Where to send clicks when the preset names no template. */
  fallbackUrl?: string | null;
  /** Sizes the ad actually has, to intersect with the preset's list. */
  availableSizeIds?: string[];
}): ResolvedLaunch {
  const preset: PresetRow = { platform: 'meta', ...PRESET_DEFAULTS, ...(params.preset ?? {}) };
  const notices: string[] = [];

  const decision = specialAdCategoriesFor({ offerType: params.data.offerType, texts: params.texts });
  const financial = isFinancialCategory(decision.categories);
  notices.push(decision.reason);

  let radius = preset.geoRadiusMiles;
  if (financial && radius < FINANCIAL_TARGETING_FLOOR.minRadiusMiles) {
    notices.push(
      `Geo radius raised from ${radius} to ${FINANCIAL_TARGETING_FLOOR.minRadiusMiles} miles — Meta enforces that minimum on financial-products ads and rejects anything tighter.`,
    );
    radius = FINANCIAL_TARGETING_FLOOR.minRadiusMiles;
  }
  if (financial && preset.audienceSpec) {
    notices.push(
      'The saved audience is not applied: detailed targeting and exclusions are both unavailable on financial-products ads.',
    );
  }
  if (financial && preset.geoZip) {
    notices.push(
      `Targeting by zip is unavailable on financial-products ads, so ${preset.geoZip} is used as the radius centre only.`,
    );
  }

  const url = destinationUrl({
    urlTemplate: preset.urlTemplate,
    fallbackUrl: params.fallbackUrl,
    data: params.data,
    utm: { source: preset.utmSource, medium: preset.utmMedium, campaign: preset.utmCampaign },
  });
  if (!url) {
    notices.push(
      'No destination URL: the preset has no URL template and the account has no website on file. A launch needs somewhere to send the click.',
    );
  }

  const wanted = jsonArray(preset.sizeIds);
  const available = params.availableSizeIds ?? [];
  let sizeIds = wanted.length && available.length ? available.filter((id) => wanted.includes(id)) : available;
  if (wanted.length && available.length && sizeIds.length === 0) {
    notices.push(
      `None of the preset's sizes (${wanted.join(', ')}) exist on this ad, so every rendered size is included instead.`,
    );
    sizeIds = available;
  }

  return {
    objective: preset.objective,
    bidStrategy: preset.bidStrategy ?? null,
    dailyBudget: preset.dailyBudget ?? null,
    flightDays: preset.flightDays,
    geoZip: preset.geoZip ?? null,
    geoRadiusMiles: radius,
    specialAdCategories: decision.categories,
    targetingFloor: financial ? FINANCIAL_TARGETING_FLOOR : null,
    destinationUrl: url,
    sizeIds,
    notices,
  };
}
