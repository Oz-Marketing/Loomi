// Identity normalisation + hashing for ad-platform audience uploads.
//
// Every platform that takes a customer list (Google Customer Match, Meta
// Custom Audiences, StackAdapt) wants SHA-256 of a NORMALISED value, and
// they broadly agree on the normalisation: trim, lowercase, strip
// formatting, phone in E.164. They disagree on packaging — Google wants
// the phone with a leading '+', Meta wants digits only — so normalisation
// lives here once and the per-provider shaping is a thin layer on top.
//
// Why this module exists rather than inlining a hash at the call site:
// match rate is the number that decides whether an audience is worth
// anything, and it is decided entirely by normalisation. A stray
// uppercase letter or a missing country code doesn't error — it silently
// fails to match, and the platform reports a smaller audience with no
// explanation. Getting this wrong is invisible, so it gets one
// implementation and a test suite with fixed vectors.
//
// NOTE: hashing is only ever applied to values the user already holds
// first-party. Normalisation here does not imply consent — that gate is
// enforced separately in eligibility.ts and is not optional.

import { createHash } from 'node:crypto';

/** SHA-256, lowercase hex. The encoding every platform accepts. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Email: trim + lowercase.
 *
 * Deliberately does NOT strip dots or +tags from gmail addresses. Older
 * guidance suggested it; current guidance does not, and normalising
 * beyond what the platform expects turns a matchable address into an
 * unmatchable one.
 */
export function normalizeEmailForHash(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Phone → E.164 digits WITH country code, no punctuation, no leading
 * '+'. Callers add the '+' if their platform wants it.
 *
 * Returns '' when there isn't enough signal to know the country code —
 * an 8-digit local number hashed without one matches nothing, so it's
 * better to drop the identifier than to upload a guess.
 */
export function normalizePhoneForHash(
  value: string | null | undefined,
  defaultCountryCode = '1',
): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const hadPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  if (hadPlus) return digits;
  // Bare 10-digit North American number.
  if (digits.length === 10) return `${defaultCountryCode}${digits}`;
  // 11 digits already starting with the country code.
  if (digits.length === 11 && digits.startsWith(defaultCountryCode)) return digits;
  // Anything else (7-digit local, 9-digit truncation, a CRM's internal
  // id that landed in the phone column) has no reliable country code.
  return '';
}

/**
 * Name: lowercase, strip punctuation and all whitespace, drop common
 * prefixes/suffixes. "O'Neil" and "ONEIL" have to hash identically or
 * address matching loses a chunk of any dealer's book.
 */
export function normalizeNameForHash(value: string | null | undefined): string {
  let name = String(value ?? '')
    .trim()
    .toLowerCase()
    // Accents → base letters, so "José" matches "Jose".
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  for (const affix of NAME_AFFIXES) {
    name = name.replace(affix, ' ');
  }

  return name.replace(/[^a-z0-9]/g, '');
}

const NAME_AFFIXES: RegExp[] = [
  /\b(mr|mrs|ms|miss|dr|prof|rev|sir)\b\.?/g,
  /\b(jr|sr|ii|iii|iv|md|phd|dds|esq)\b\.?/g,
];

/**
 * Postal code. US: the 5-digit prefix (ZIP+4 loses the +4). Everything
 * else: lowercase, whitespace and hyphens removed, which is what the
 * platforms specify for international formats.
 *
 * Postal code is NOT hashed by any of the platforms — it's sent in the
 * clear alongside the hashed name fields — but it still has to be
 * normalised consistently or address matching drops.
 */
export function normalizePostalCode(
  value: string | null | undefined,
  country?: string | null,
): string {
  const raw = String(value ?? '').trim().toLowerCase().replace(/[\s-]/g, '');
  if (!raw) return '';
  const iso = normalizeCountryCode(country);
  if (iso === 'US' || (!iso && /^\d{5,9}$/.test(raw))) {
    const digits = raw.replace(/\D/g, '');
    return digits.slice(0, 5);
  }
  return raw;
}

/**
 * Country → ISO-3166-1 alpha-2, uppercase. Sent unhashed.
 *
 * Only the handful of spellings that actually turn up in North American
 * dealer CRM exports are mapped; anything else that's already two
 * letters passes through, and anything unrecognised returns '' rather
 * than a guess.
 */
export function normalizeCountryCode(value: string | null | undefined): string {
  const raw = String(value ?? '').trim().toLowerCase().replace(/\./g, '');
  if (!raw) return '';
  if (/^[a-z]{2}$/.test(raw)) return raw.toUpperCase();
  const mapped = COUNTRY_ALIASES[raw];
  return mapped ?? '';
}

const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'US',
  us: 'US',
  'united states': 'US',
  'united states of america': 'US',
  america: 'US',
  can: 'CA',
  canada: 'CA',
  mex: 'MX',
  mexico: 'MX',
};

// ── Per-contact identifier bundle ───────────────────────────────

export interface HashableContact {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

/**
 * The hashed identifier set for one contact.
 *
 * `null` for anything the contact can't supply — an absent identifier
 * and an empty-string identifier are very different things to a
 * platform, and uploading a hash of '' is uploading a hash of nothing
 * that will match a surprising number of other broken records.
 */
export interface HashedIdentifiers {
  /** SHA-256 of the normalised email. */
  hashedEmail: string | null;
  /** SHA-256 of the E.164 digits (no '+'). */
  hashedPhone: string | null;
  /** Address block — all four parts are required together, since
   *  partial address matching isn't supported. */
  address: {
    hashedFirstName: string;
    hashedLastName: string;
    postalCode: string;
    countryCode: string;
  } | null;
}

export function hashContactIdentifiers(
  contact: HashableContact,
): HashedIdentifiers {
  const email = normalizeEmailForHash(contact.email);
  const phone = normalizePhoneForHash(contact.phone);
  const firstName = normalizeNameForHash(contact.firstName);
  const lastName = normalizeNameForHash(contact.lastName);
  const countryCode = normalizeCountryCode(contact.country);
  const postalCode = normalizePostalCode(contact.postalCode, contact.country);

  // Address matching needs the whole block. A hashed surname with no
  // postal code isn't a weaker signal, it's an unusable one.
  const hasAddress = !!(firstName && lastName && postalCode && countryCode);

  return {
    hashedEmail: email ? sha256Hex(email) : null,
    hashedPhone: phone ? sha256Hex(phone) : null,
    address: hasAddress
      ? {
          hashedFirstName: sha256Hex(firstName),
          hashedLastName: sha256Hex(lastName),
          postalCode,
          countryCode,
        }
      : null,
  };
}

/** True when a contact carries at least one usable identifier. */
export function hasAnyIdentifier(identifiers: HashedIdentifiers): boolean {
  return !!(identifiers.hashedEmail || identifiers.hashedPhone || identifiers.address);
}

/**
 * A stable key for deduplicating the same human across sub-accounts.
 *
 * Contacts are unique per (accountKey, email) by design, so one customer
 * who has shopped at three Young rooftops is three Contact rows. Uploading
 * all three inflates the audience, wastes match quota, and breaks
 * frequency capping — the platform sees one person but is told about
 * three.
 *
 * Email is preferred over phone because it's the higher-confidence
 * identifier and the one most likely to be present. Contacts with
 * neither get a null key and are handled by the caller (they're already
 * excluded by the eligibility gate).
 */
export function identityDedupeKey(
  identifiers: HashedIdentifiers,
): string | null {
  if (identifiers.hashedEmail) return `e:${identifiers.hashedEmail}`;
  if (identifiers.hashedPhone) return `p:${identifiers.hashedPhone}`;
  return null;
}
