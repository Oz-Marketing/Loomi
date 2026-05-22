// CSV row → Contact-shape normalisation. Handles the messy reality
// of dealer CSVs: header variants, mixed-case email, partial phone
// numbers, free-form dates, tag delimiters, vehicle info smeared
// across multiple columns. The output rows are what the importer
// upserts into Prisma.
//
// This is intentionally schema-rigid: anything that doesn't map to a
// canonical column gets stashed under `customFields` so the API can
// surface it without a schema migration. DND state is limited to
// `dnd.email` / `dnd.sms` — the channels Loomi sends on.

// ── Canonical field names ──

// Keep in sync with the Prisma Contact model (excluding system
// columns id, accountKey, createdAt, updatedAt).
export const CONTACT_FIELDS = [
  'email',
  'phone',
  'firstName',
  'lastName',
  'fullName',
  'address1',
  'city',
  'state',
  'postalCode',
  'country',
  'source',
  'tags',
  'dateAdded',
  'vehicleYear',
  'vehicleMake',
  'vehicleModel',
  'vehicleVin',
  'vehicleMileage',
  'lastServiceDate',
  'nextServiceDate',
  'leaseEndDate',
  'warrantyEndDate',
  'purchaseDate',
] as const;

export type ContactField = (typeof CONTACT_FIELDS)[number];

// A special "ignore" sentinel for columns the user explicitly wants
// skipped during import (e.g. an internal CRM id that has no Loomi
// equivalent). The UI surfaces this so we don't silently swallow
// columns into `customFields`.
export const IGNORE_FIELD = '__ignore' as const;

// Which canonical fields are DateTime in the DB — drives coercion.
const DATE_FIELDS: ReadonlySet<ContactField> = new Set([
  'dateAdded',
  'lastServiceDate',
  'nextServiceDate',
  'leaseEndDate',
  'warrantyEndDate',
  'purchaseDate',
]);

// ── Header aliasing ──

// Aliases the auto-mapping uses to guess which canonical field a
// CSV header corresponds to. Matching is case-insensitive and
// strips spaces, underscores, dashes, dots.
const HEADER_ALIASES: Record<ContactField, string[]> = {
  email: ['email', 'emailaddress', 'mail', 'e-mail'],
  phone: ['phone', 'phonenumber', 'mobile', 'cell', 'cellphone', 'mobilephone', 'tel', 'telephone'],
  firstName: ['firstname', 'first', 'givenname', 'fname'],
  lastName: ['lastname', 'last', 'familyname', 'surname', 'lname'],
  fullName: ['fullname', 'name', 'contactname', 'displayname'],
  address1: ['address', 'address1', 'addressline1', 'street', 'streetaddress', 'mailingaddress'],
  city: ['city', 'town', 'locality'],
  state: ['state', 'region', 'province'],
  postalCode: ['postalcode', 'zip', 'zipcode', 'postcode'],
  country: ['country'],
  source: ['source', 'leadsource', 'origin'],
  tags: ['tags', 'tag', 'labels', 'segments'],
  dateAdded: ['dateadded', 'createdat', 'created', 'createdon', 'datecreated', 'enrolled', 'addeddate'],
  vehicleYear: ['vehicleyear', 'year', 'vyear', 'modelyear'],
  vehicleMake: ['vehiclemake', 'make', 'vmake', 'manufacturer'],
  vehicleModel: ['vehiclemodel', 'model', 'vmodel'],
  vehicleVin: ['vehiclevin', 'vin'],
  vehicleMileage: ['vehiclemileage', 'mileage', 'odometer', 'miles'],
  lastServiceDate: ['lastservicedate', 'lastservice'],
  nextServiceDate: ['nextservicedate', 'nextservice', 'serviceduedate', 'servicedue'],
  leaseEndDate: ['leaseenddate', 'leaseend', 'leaseexpiry', 'leaseexpiration'],
  warrantyEndDate: ['warrantyenddate', 'warrantyend', 'warrantyexpiry', 'warrantyexpiration'],
  purchaseDate: ['purchasedate', 'purchasedon', 'datepurchased', 'soldon', 'datesold'],
};

function normaliseHeaderKey(header: string): string {
  return header.toLowerCase().replace(/[\s_\-.]+/g, '');
}

/**
 * Best-guess mapping from CSV headers → Contact fields. Returns a
 * map keyed by the raw header string (preserved verbatim so the UI
 * can show the original). Unmatched headers are absent; the UI
 * decides whether to assign them to a canonical field, stash them
 * under customFields, or IGNORE_FIELD them.
 */
export function autoMapHeaders(headers: readonly string[]): Record<string, ContactField> {
  const out: Record<string, ContactField> = {};
  const used = new Set<ContactField>();

  for (const header of headers) {
    const key = normaliseHeaderKey(header);
    if (!key) continue;

    for (const field of CONTACT_FIELDS) {
      if (used.has(field)) continue;
      if (HEADER_ALIASES[field].includes(key)) {
        out[header] = field;
        used.add(field);
        break;
      }
    }
  }

  return out;
}

// ── Value coercion ──

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Best-effort E.164 normalisation. Strips formatting, prepends +1
 * for 10-digit US numbers, preserves any existing +country prefix.
 * Returns '' for anything that doesn't look like a phone (so the
 * caller can choose to skip / null the row).
 */
export function normalisePhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Strip every non-digit except a leading +.
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';

  if (hasPlus) {
    // Already had a +, keep as-is. Don't validate further — Twilio
    // will reject malformed numbers at send time.
    return `+${digits}`;
  }

  // US fallback: 10 digits → +1XXXXXXXXXX, 11 digits starting with 1.
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;

  // Otherwise we don't have enough signal to pick a country code.
  // Return empty so the row falls through to "no usable phone".
  return '';
}

const ISO_LIKE = /^\d{4}-\d{2}-\d{2}/;
const EPOCH_MS = /^\d{13}$/;
const EPOCH_S = /^\d{10}$/;

/**
 * Parse a date cell into a Date or null. Accepts ISO-ish strings,
 * epoch seconds, epoch milliseconds, and anything `new Date()` can
 * parse (US-style "MM/DD/YYYY", RFC 2822, etc.). Returns null if the
 * value is empty or the parse fails.
 */
export function parseDateCell(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (EPOCH_S.test(trimmed)) {
    const ms = Number(trimmed) * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (EPOCH_MS.test(trimmed)) {
    const d = new Date(Number(trimmed));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // ISO-like or fallback to Date constructor.
  if (ISO_LIKE.test(trimmed)) {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d;
  }

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** Split a tags cell into a string[]. Accepts comma, semicolon, or
 * pipe-delimited input. Empty cells return []. */
export function parseTagsCell(raw: string): string[] {
  return raw
    .split(/[,;|]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

// ── Row → ParsedContact ──

export interface ParsedContact {
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  source: string | null;
  tags: string[];
  dateAdded: Date | null;
  vehicleYear: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleVin: string | null;
  vehicleMileage: string | null;
  lastServiceDate: Date | null;
  nextServiceDate: Date | null;
  leaseEndDate: Date | null;
  warrantyEndDate: Date | null;
  purchaseDate: Date | null;
  customFields: Record<string, string> | null;
}

export interface RowIssue {
  rowNumber: number;
  reason: string;
}

export interface NormaliseRowResult {
  row: ParsedContact | null;
  issue: RowIssue | null;
}

/**
 * Apply a header → field mapping to a single CSV row and return a
 * ParsedContact ready for upsert. Unmapped headers (mapping absent
 * or set to a non-canonical key starting with `custom:`) flow into
 * `customFields`. Headers explicitly mapped to IGNORE_FIELD are
 * dropped silently.
 */
export function normaliseRow(
  row: Record<string, unknown>,
  mapping: Record<string, ContactField | typeof IGNORE_FIELD | `custom:${string}`>,
  rowNumber: number,
): NormaliseRowResult {
  const parsed: ParsedContact = {
    email: null,
    phone: null,
    firstName: null,
    lastName: null,
    fullName: null,
    address1: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    source: null,
    tags: [],
    dateAdded: null,
    vehicleYear: null,
    vehicleMake: null,
    vehicleModel: null,
    vehicleVin: null,
    vehicleMileage: null,
    lastServiceDate: null,
    nextServiceDate: null,
    leaseEndDate: null,
    warrantyEndDate: null,
    purchaseDate: null,
    customFields: null,
  };

  const customFields: Record<string, string> = {};

  for (const [header, rawValue] of Object.entries(row)) {
    const target = mapping[header];
    if (!target || target === IGNORE_FIELD) continue;

    const value = rawValue == null ? '' : String(rawValue).trim();
    if (!value) continue;

    if (target.startsWith('custom:')) {
      customFields[target.slice('custom:'.length)] = value;
      continue;
    }

    const field = target as ContactField;

    if (field === 'email') {
      parsed.email = normaliseEmail(value) || null;
    } else if (field === 'phone') {
      const e164 = normalisePhone(value);
      parsed.phone = e164 || null;
    } else if (field === 'tags') {
      parsed.tags = parseTagsCell(value);
    } else if (DATE_FIELDS.has(field)) {
      const date = parseDateCell(value);
      // Type-narrow: only the date-typed fields exist as Date | null
      // on ParsedContact, so cast here is safe.
      (parsed as unknown as Record<ContactField, unknown>)[field] = date;
    } else {
      (parsed as unknown as Record<ContactField, unknown>)[field] = value;
    }
  }

  // Derive fullName when source didn't provide it.
  if (!parsed.fullName) {
    const concat = [parsed.firstName, parsed.lastName].filter(Boolean).join(' ').trim();
    parsed.fullName = concat || null;
  }

  parsed.customFields = Object.keys(customFields).length > 0 ? customFields : null;

  if (!parsed.email && !parsed.phone) {
    return {
      row: null,
      issue: { rowNumber, reason: 'Row has no usable email or phone — skipped' },
    };
  }

  return { row: parsed, issue: null };
}
