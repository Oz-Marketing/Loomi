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

// Anything that isn't a single `local@domain.tld` is not something we can
// send to. Deliberately strict about the delimiters so a multi-address cell
// can never survive as one "address".
const EMAIL_SHAPE = /^[^\s@,;|]+@[^\s@,;|]+\.[^\s@,;|]+$/;

// What dealer CRMs write into the email field to mean "we don't have one".
// These are addresses by shape, so they can't be rejected outright — a
// contact whose only value is `none@none.com` keeps it. They are only ranked
// BELOW a real address when one cell holds both, which is how
// "noneyet@none.com;markpantelakis@gmail.com" ends up sendable.
const PLACEHOLDER_DOMAINS = new Set([
  'none.com',
  'nonet.com',
  'no.com',
  'noemail.com',
  'nomail.com',
  'email.com',
  'test.com',
  'example.com',
  'example.org',
]);
const PLACEHOLDER_LOCALS = new Set([
  'none',
  'noneyet',
  'noemail',
  'nomail',
  'noreply',
  'no-reply',
  'email',
  'test',
  'na',
  'unknown',
  'nobody',
  'declined',
]);

/** A shape-valid address that is really a "we have no address" marker. */
export function isPlaceholderEmail(address: string): boolean {
  const at = address.lastIndexOf('@');
  if (at < 0) return false;
  return (
    PLACEHOLDER_DOMAINS.has(address.slice(at + 1)) ||
    PLACEHOLDER_LOCALS.has(address.slice(0, at))
  );
}

export interface ParsedEmailCell {
  /** Distinct valid addresses, real ones before placeholders. */
  addresses: string[];
  /** Non-empty parts that were not addresses — "none", "calie", "NULL". */
  dropped: string[];
}

/**
 * Take apart an email cell.
 *
 * Dealer CRMs routinely pack every address they hold for a person into one
 * field ("bluejenkins1@yahoo.com;donald.jenkins@gmail.com"), and some repeat
 * the same one twice. Same delimiters as `parseTagsCell`. Empty parts (a
 * trailing "a@b.com,") are not "dropped" — there was nothing there.
 */
export function parseEmailCell(raw: string): ParsedEmailCell {
  const addresses: string[] = [];
  const dropped: string[] = [];

  for (const part of raw.split(/[,;|]/)) {
    const token = part.trim();
    if (!token) continue;
    const addr = token.toLowerCase();
    if (!EMAIL_SHAPE.test(addr)) {
      dropped.push(token);
    } else if (!addresses.includes(addr)) {
      addresses.push(addr);
    }
  }

  return {
    addresses: [
      ...addresses.filter((a) => !isPlaceholderEmail(a)),
      ...addresses.filter((a) => isPlaceholderEmail(a)),
    ],
    dropped,
  };
}

/**
 * True when a cell holds an address AND text that isn't one, which usually
 * means a delimiter landed inside a single address rather than between two:
 * "calie,hammond@youngsubaru.com" is a mistyped `calie.hammond@…`, not a list.
 * Taking the valid-looking half would invent `hammond@youngsubaru.com` — a
 * different, possibly real person. There is no way to tell that apart from a
 * genuine "NULL;real@x.com", so neither is guessed at.
 */
export function isAmbiguousEmailCell(cell: ParsedEmailCell): boolean {
  return cell.dropped.length > 0 && cell.addresses.length > 0;
}

/**
 * The one address that becomes `Contact.email`: the best address in the cell,
 * or '' when the cell holds none or is ambiguous. `Contact.email` is both the
 * send target and the dedup key, so it has to be a single address. Callers
 * that want the alternates use `parseEmailCell`.
 */
export function normaliseEmail(raw: string): string {
  const cell = parseEmailCell(raw);
  if (isAmbiguousEmailCell(cell)) return '';
  return cell.addresses[0] ?? '';
}

/**
 * Where the addresses a packed cell held beyond the first are kept. `Contact`
 * has one email column, so the alternates go to `customFields` rather than
 * being thrown away — losing an address the dealer gave us is not a fix.
 */
export const ADDITIONAL_EMAILS_FIELD = 'additionalEmails';

/**
 * Where an ambiguous cell is parked verbatim. Nothing is discarded; a human
 * can read it back and correct the contact.
 */
export const UNPARSED_EMAIL_FIELD = 'unparsedEmail';

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
  let extraEmails: string[] = [];
  let unparsedEmail: string | null = null;

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
      const cell = parseEmailCell(value);
      if (isAmbiguousEmailCell(cell)) {
        // Don't guess which half of "calie,hammond@x.com" was the address.
        parsed.email = null;
        unparsedEmail = value;
      } else {
        parsed.email = cell.addresses[0] ?? null;
        extraEmails = cell.addresses.slice(1);
      }
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

  // A column the user explicitly mapped to these keys wins over our salvage.
  if (extraEmails.length > 0 && !(ADDITIONAL_EMAILS_FIELD in customFields)) {
    customFields[ADDITIONAL_EMAILS_FIELD] = extraEmails.join('; ');
  }
  if (unparsedEmail && !(UNPARSED_EMAIL_FIELD in customFields)) {
    customFields[UNPARSED_EMAIL_FIELD] = unparsedEmail;
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
