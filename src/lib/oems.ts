export const MAJOR_US_OEMS = [
  'Acura',
  'Alfa Romeo',
  'Aston Martin',
  'Audi',
  'Bentley',
  'BMW',
  'Buick',
  'Cadillac',
  'Chevrolet',
  'Chrysler',
  'Dodge',
  'Ferrari',
  'Fiat',
  'Ford',
  'Genesis',
  'GMC',
  'Honda',
  'Hyundai',
  'INFINITI',
  'Jaguar',
  'Jeep',
  'Kia',
  'Lamborghini',
  'Land Rover',
  'Lexus',
  'Lincoln',
  'Lucid',
  'Maserati',
  'Mazda',
  'McLaren',
  'Mercedes-Benz',
  'MINI',
  'Mitsubishi',
  'Nissan',
  'Polestar',
  'Porsche',
  'Ram',
  'Rivian',
  'Rolls-Royce',
  'Subaru',
  'Tesla',
  'Toyota',
  'Volkswagen',
  'Volvo',
] as const;

/**
 * Powersports brands — and, deliberately, the agricultural ones.
 *
 * LS Tractor and New Holland are farm equipment, not powersports. They live here
 * because Loomi has no `agriculture` industry, and adding one would mean an ag
 * account got the vehicle picker that backs the automotive flow — EVOX and
 * MarketCheck have no tractor coverage, so it would return nothing. Filing them
 * under powersports mislabels the industry and costs nothing; a real ag industry
 * is worth revisiting if it grows past a couple of brands.
 * See docs/custom-offer-disclaimer-builder.md §8.
 */
export const POWERSPORTS_BRANDS = [
  'Arctic Cat',
  'Can-Am',
  'CFMoto',
  'Ducati',
  'Harley-Davidson',
  'Honda Powersports',
  'Husqvarna',
  'Indian Motorcycle',
  'Kawasaki',
  'KTM',
  'LS Tractor',
  'New Holland',
  'Polaris',
  'Royal Enfield',
  'Sea-Doo',
  'Sherco',
  'Ski-Doo',
  'Suzuki',
  'Triumph',
  'Yamaha',
] as const;

/**
 * Trade shorthand → the canonical brand name.
 *
 * Brand lookups elsewhere match a stored value against these canonical names —
 * co-op rule packs, disclaimer templates and OEM offer rules are all keyed by
 * make. An account stored as "VW" matched NOTHING and did so silently: no error,
 * just a brand with no rules, which reads exactly like a brand with no rules on
 * file. Every entry here is shorthand in actual use, never a guess at what
 * someone might have meant.
 */
const OEM_ALIASES: Record<string, string> = {
  vw: 'Volkswagen',
  volkswagon: 'Volkswagen', // common misspelling, seen in imported account data
  chevy: 'Chevrolet',
  mercedes: 'Mercedes-Benz',
  'mercedes benz': 'Mercedes-Benz',
  'land-rover': 'Land Rover',
  landrover: 'Land Rover',
  alfa: 'Alfa Romeo',
  'mini cooper': 'MINI',
  harley: 'Harley-Davidson',
  'harley davidson': 'Harley-Davidson',
  'cf moto': 'CFMoto',
  'can am': 'Can-Am',
  'ski doo': 'Ski-Doo',
  'sea doo': 'Sea-Doo',
  indian: 'Indian Motorcycle',
};

/**
 * Dealer-group acronyms → the brands they stand for.
 *
 * These are NOT aliases and must never be resolved to a single make: an ad keys
 * off one vehicle's make, so "CDJRF" has to become four or five separate brands
 * or none. Kept out of {@link normalizeOems} on purpose — callers that take the
 * first result (media scoping) would silently pick Chrysler for a Jeep.
 */
const OEM_GROUPS: Record<string, readonly string[]> = {
  cdjr: ['Chrysler', 'Dodge', 'Jeep', 'Ram'],
  cdjrf: ['Chrysler', 'Dodge', 'Jeep', 'Ram', 'Fiat'],
  brp: ['Can-Am', 'Ski-Doo', 'Sea-Doo'],
};

/**
 * The brands a dealer-group acronym stands for, or null when the token isn't a
 * known group. Callers that need per-make behaviour (co-op packs, disclaimer
 * templates) expand explicitly; nothing expands implicitly.
 */
export function expandBrandGroup(token: string): string[] | null {
  const brands = OEM_GROUPS[token.trim().toLowerCase()];
  return brands ? [...brands] : null;
}

/** Industries that support brand (OEM) selection. */
export function industryHasBrands(category: string): boolean {
  const normalized = category.trim().toLowerCase();
  return normalized === 'automotive' || normalized === 'powersports';
}

/** Return the brand list for a given industry. */
export function brandsForIndustry(category: string): readonly string[] {
  const normalized = category.trim().toLowerCase();
  if (normalized === 'powersports') return POWERSPORTS_BRANDS;
  return MAJOR_US_OEMS;
}

const ALL_KNOWN_BRANDS = [...MAJOR_US_OEMS, ...POWERSPORTS_BRANDS];

const OEM_CANONICAL_BY_LOWER = new Map(
  ALL_KNOWN_BRANDS.map((oem) => [oem.toLowerCase(), oem]),
);

function splitMaybeCsv(value: string): string[] {
  if (!value.includes(',')) return [value];
  return value.split(',');
}

export function normalizeOems(rawOems?: unknown, fallbackOem?: unknown): string[] {
  const tokens: string[] = [];

  if (Array.isArray(rawOems)) {
    for (const item of rawOems) {
      if (typeof item === 'string') tokens.push(...splitMaybeCsv(item));
    }
  } else if (typeof rawOems === 'string') {
    tokens.push(...splitMaybeCsv(rawOems));
  }

  if (typeof fallbackOem === 'string') {
    tokens.push(...splitMaybeCsv(fallbackOem));
  }

  const unique: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const normalized = token.trim();
    if (!normalized) continue;
    const lower = normalized.toLowerCase();
    // Exact canonical match first, then known shorthand. An unrecognised token is
    // passed through unchanged rather than dropped — a brand we haven't listed is
    // still the account's brand, and silently losing it would be worse than
    // carrying it uncanonicalised.
    const canonical = OEM_CANONICAL_BY_LOWER.get(lower) || OEM_ALIASES[lower] || normalized;
    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(canonical);
  }

  return unique;
}

export function getAccountOems(account?: {
  oems?: unknown;
  oem?: unknown;
} | null): string[] {
  if (!account) return [];
  return normalizeOems(account.oems, account.oem);
}
