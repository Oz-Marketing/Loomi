// Structured contact ingestion (machine-to-machine).
//
// This is the permanent inbound path for contacts arriving as JSON
// from an upstream system (today: the Oz Reports CRM bridge; later:
// native source adapters). It is deliberately separate from the CSV
// importer in ./import.ts:
//
//   - import.ts takes a CSV + a user-confirmed column mapping and
//     OVERWRITES matched contacts (last-write-wins on fields, tags
//     replaced wholesale). That's correct for a human re-uploading a
//     spreadsheet.
//
//   - ingestContacts() takes already-structured rows and MERGES on
//     match: tags are unioned and customFields are shallow-merged, so
//     the same person arriving first as a lead, then as a buyer, then
//     as a service customer accumulates `lead` + `sales` + `service`
//     tags on one contact instead of clobbering the previous state.
//
// Identity/dedup is the same as the CSV path — (accountKey, email)
// first, then (accountKey, phone) — so a phone-only lead still merges
// with a later email-bearing record on phone. Upserts are idempotent:
// re-sending the same batch updates rather than duplicates, which is
// what makes the one-time full backfill safe to re-run.

import { prisma } from '@/lib/prisma';
import { getRelatedAccountKeys } from '@/lib/services/accounts';
import {
  OPT_OUT_SOURCE,
  mergeStickyDnd,
  recordEmailOptOuts,
  recordSmsOptOuts,
} from '@/lib/sending/opt-outs';
import {
  ADDITIONAL_EMAILS_FIELD,
  UNPARSED_EMAIL_FIELD,
  isAmbiguousEmailCell,
  normalisePhone,
  parseDateCell,
  parseEmailCell,
} from './normalize';

// Scalar (string) fields we accept and pass straight through after a
// trim. Kept explicit rather than derived from CONTACT_FIELDS because
// email/phone/tags/dates need bespoke coercion below.
const STRING_FIELDS = [
  'firstName',
  'lastName',
  'fullName',
  'address1',
  'city',
  'state',
  'postalCode',
  'country',
  'vehicleYear',
  'vehicleMake',
  'vehicleModel',
  'vehicleVin',
  'vehicleMileage',
] as const;

// DateTime columns. Accept ISO strings, epoch, or US-style dates —
// parseDateCell handles the same formats the CSV importer does.
const DATE_FIELDS = [
  'dateAdded',
  'dateOfBirth',
  'lastServiceDate',
  'nextServiceDate',
  'leaseEndDate',
  'warrantyEndDate',
  'purchaseDate',
] as const;

type StringField = (typeof STRING_FIELDS)[number];
type DateField = (typeof DATE_FIELDS)[number];

/**
 * One inbound contact. Everything is optional; a row is only usable if
 * it yields at least an email or a phone. Dates may be sent as strings
 * (any format parseDateCell accepts) or as Date instances.
 */
export interface IngestContactInput {
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  tags?: string[] | null;
  customFields?: Record<string, string> | null;
  /**
   * Channel suppression. Sent only by sources that carry real consent
   * data (e.g. dealer opt-out flags). Merged into the existing dnd and
   * sticky: a feed may set a channel true, but its `false` never clears an
   * opt-out already recorded — by this feed, another feed, or Loomi itself.
   * Loomi's send engine must honor this before email/SMS.
   */
  dnd?: { email?: boolean; sms?: boolean } | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  vehicleYear?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleVin?: string | null;
  vehicleMileage?: string | null;
  dateAdded?: string | Date | null;
  dateOfBirth?: string | Date | null;
  lastServiceDate?: string | Date | null;
  nextServiceDate?: string | Date | null;
  leaseEndDate?: string | Date | null;
  warrantyEndDate?: string | Date | null;
  purchaseDate?: string | Date | null;
}

export interface IngestIssue {
  index: number;
  reason: string;
}

export interface IngestSummary {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  issues: IngestIssue[];
}

export interface IngestContactsOptions {
  accountKey: string;
  /**
   * Batch-level default source (e.g. "oz-reports"). Applied to any row
   * that doesn't carry its own `source` — UNLESS it names the pipeline rather
   * than a marketing source; see `isPipelineSource`.
   */
  source?: string;
  contacts: IngestContactInput[];
}

/**
 * Is this "source" the name of an ingest pipeline rather than a marketing
 * source a dealer would recognise?
 *
 * The bridge labels each batch by feed — `oz-reports`, `oz-reports:automotive`,
 * `oz-reports:leads`. Those describe how a row reached Loomi, not where the
 * customer came from, and they must never reach `Contact.source`.
 *
 * A prefix match rather than an exact list, so a new feed suffix is covered the
 * day it appears instead of the day someone notices it in a client's report. If
 * a second bridge is ever added, add its namespace here.
 */
export function isPipelineSource(value: string | null | undefined): boolean {
  return /^oz-reports(:|$)/i.test((value ?? '').trim());
}

const MAX_ISSUES_RETURNED = 50;

/** Coerce a string|Date|null date input into a Date or null. */
function coerceDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  return parseDateCell(String(value));
}

/** Trim a scalar string input; empty/whitespace → null. */
function coerceString(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

interface NormalisedContact {
  email: string | null;
  /** Every address the email cell held — `email` first. An opt-out covers all of them. */
  emails: string[];
  phone: string | null;
  source: string | null;
  tags: string[];
  customFields: Record<string, string>;
  strings: Partial<Record<StringField, string>>;
  dates: Partial<Record<DateField, Date>>;
  dnd: { email?: boolean; sms?: boolean } | null;
}

/**
 * Turn a raw inbound row into a normalised shape, or return null when
 * the row has no usable identity (no email and no phone).
 */
function normalise(
  input: IngestContactInput,
  defaultSource: string | undefined,
): NormalisedContact | null {
  // The powersports feed sends every address it holds for a person in this
  // one field, semicolon-joined. `Contact.email` is one address.
  const rawEmail = input.email ? String(input.email) : '';
  const cell = parseEmailCell(rawEmail);
  const ambiguous = isAmbiguousEmailCell(cell);
  const addresses = ambiguous ? [] : cell.addresses;
  const email = addresses[0] ?? null;
  const phone = input.phone ? normalisePhone(String(input.phone)) || null : null;
  if (!email && !phone) return null;

  const strings: Partial<Record<StringField, string>> = {};
  for (const field of STRING_FIELDS) {
    const v = coerceString(input[field]);
    if (v !== null) strings[field] = v;
  }

  // Derive fullName from first/last when the source didn't send one.
  if (!strings.fullName) {
    const concat = [strings.firstName, strings.lastName].filter(Boolean).join(' ').trim();
    if (concat) strings.fullName = concat;
  }

  const dates: Partial<Record<DateField, Date>> = {};
  for (const field of DATE_FIELDS) {
    const d = coerceDate(input[field]);
    if (d) dates[field] = d;
  }

  const tags = Array.isArray(input.tags)
    ? Array.from(
        new Set(input.tags.map((t) => String(t).trim()).filter(Boolean)),
      )
    : [];

  const customFields: Record<string, string> = {};
  if (input.customFields && typeof input.customFields === 'object') {
    for (const [k, v] of Object.entries(input.customFields)) {
      if (v == null) continue;
      const val = String(v).trim();
      if (val !== '') customFields[k] = val;
    }
  }

  // Keep the alternates the packed cell carried — the sender gave us those
  // addresses, and there is no second email column to put them in. An
  // ambiguous cell is parked whole rather than guessed at.
  if (addresses.length > 1 && !(ADDITIONAL_EMAILS_FIELD in customFields)) {
    customFields[ADDITIONAL_EMAILS_FIELD] = addresses.slice(1).join('; ');
  }
  if (ambiguous && !(UNPARSED_EMAIL_FIELD in customFields)) {
    customFields[UNPARSED_EMAIL_FIELD] = rawEmail.trim();
  }

  // Deliberately NOT `?? defaultSource` unconditionally. The bridge sends a
  // batch label naming the feed ("oz-reports:automotive"), and rows from the
  // automotive feed carry no per-contact source, so every one of them inherited
  // it. `Contact.source` is a MARKETING source — it is what the Lead
  // Performance report groups by — so the pipeline's own name was rendering to
  // clients as the single biggest lead source, above CDK and Dealer Website.
  //
  // Provenance is not lost: `IngestRun.source` records the batch label, and its
  // schema comment already calls that the reliable record of which feed a run
  // came from. Leaving this null is the honest answer — those contacts have no
  // known marketing source, and the report folds null into "Unknown source".
  const batchDefault = isPipelineSource(defaultSource) ? null : defaultSource;
  const source = coerceString(input.source) ?? batchDefault ?? null;

  let dnd: { email?: boolean; sms?: boolean } | null = null;
  if (input.dnd && typeof input.dnd === 'object') {
    const d: { email?: boolean; sms?: boolean } = {};
    if (typeof input.dnd.email === 'boolean') d.email = input.dnd.email;
    if (typeof input.dnd.sms === 'boolean') d.sms = input.dnd.sms;
    if (Object.keys(d).length > 0) dnd = d;
  }

  return { email, emails: addresses, phone, source, tags, customFields, strings, dates, dnd };
}

/** Read an existing contact's tags Json column as a string[]. */
function existingTags(value: unknown): string[] {
  return Array.isArray(value) ? (value.filter((t) => typeof t === 'string') as string[]) : [];
}

/**
 * Enforce suppression at the level the send worker actually checks:
 * EmailSuppression / SmsSuppression rows (the Contact.dnd JSON is the UI's
 * copy). One row per opted-out address at this account AND every other
 * account in its group — the dealer's CRM saying "don't contact" is not a
 * per-rooftop preference.
 *
 * Through the shared helpers, so the reason never DOWNGRADES: this used to
 * upsert reason 'crm-optout' unconditionally, which turned a person's own
 * unsubscribe into a CRM flag that staff are allowed to clear.
 *
 * We intentionally do NOT delete on a `false` flag — an opt-out is a sticky
 * compliance signal, and skipping the delete keeps the backfill fast (the
 * vast majority of contacts aren't suppressed). Re-opting someone in is a
 * deliberate act in the UI.
 */
async function applyCrmSuppression(
  accountKey: string,
  emails: string[],
  phones: string[],
): Promise<void> {
  if (emails.length === 0 && phones.length === 0) return;
  const shared = {
    accountKey,
    reason: 'crm-optout' as const,
    source: OPT_OUT_SOURCE.crm,
    // One hierarchy read for the batch, not one per opted-out row.
    relatedAccountKeys: await getRelatedAccountKeys(accountKey),
  };
  if (emails.length > 0) await recordEmailOptOuts({ ...shared, emails });
  if (phones.length > 0) await recordSmsOptOuts({ ...shared, phones });
}

/** Read an existing contact's customFields Json column as an object. */
function existingCustomFields(value: unknown): Record<string, string> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {};
}

/**
 * Ingest a batch of structured contacts for one account. Idempotent:
 * matched contacts are merged (tags unioned, customFields merged,
 * provided scalar/date fields updated; omitted fields left intact).
 */
export async function ingestContacts({
  accountKey,
  source,
  contacts,
}: IngestContactsOptions): Promise<IngestSummary> {
  const issues: IngestIssue[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  // Opted-out addresses, written in one set-based pass after the loop.
  const optOutEmails: string[] = [];
  const optOutPhones: string[] = [];

  for (let i = 0; i < contacts.length; i++) {
    const row = normalise(contacts[i], source);
    if (!row) {
      skipped += 1;
      if (issues.length < MAX_ISSUES_RETURNED) {
        issues.push({ index: i, reason: 'No usable email or phone — skipped' });
      }
      continue;
    }

    // Collected before the upsert and regardless of how it goes: the opt-out
    // is about the address, and a contact row that failed to save is no
    // reason to keep messaging it.
    if (row.dnd?.email === true) optOutEmails.push(...row.emails);
    if (row.dnd?.sms === true && row.phone) optOutPhones.push(row.phone);

    try {
      const existing = await findExisting(accountKey, row.email, row.phone);

      if (existing) {
        await prisma.contact.update({
          where: { id: existing.id },
          data: {
            ...row.strings,
            ...row.dates,
            ...(row.email ? { email: row.email } : {}),
            ...(row.phone ? { phone: row.phone } : {}),
            ...(row.source ? { source: row.source } : {}),
            tags: Array.from(new Set([...existingTags(existing.tags), ...row.tags])),
            customFields: { ...existingCustomFields(existing.customFields), ...row.customFields },
            // Sticky: a feed may opt a channel out, but its explicit `false`
            // must not erase an opt-out set in Loomi or by another feed. A
            // plain spread let `{ email: false }` overwrite `email: true`.
            // Only written when this row carried consent data.
            ...(row.dnd ? { dnd: mergeStickyDnd(existing.dnd, row.dnd) } : {}),
          },
        });
        updated += 1;
      } else {
        await prisma.contact.create({
          data: {
            accountKey,
            email: row.email,
            phone: row.phone,
            source: row.source,
            dateAdded: row.dates.dateAdded ?? new Date(),
            tags: row.tags,
            customFields:
              Object.keys(row.customFields).length > 0 ? row.customFields : undefined,
            ...(row.dnd ? { dnd: row.dnd } : {}),
            ...row.strings,
            ...row.dates,
          },
        });
        created += 1;
      }
    } catch (err) {
      skipped += 1;
      if (issues.length < MAX_ISSUES_RETURNED) {
        issues.push({
          index: i,
          reason: err instanceof Error ? err.message : 'Upsert failed',
        });
      }
    }
  }

  // Write the suppression rows the send worker enforces on, for both created
  // and updated contacts; only channels flagged opted-out are written. Not
  // caught: if this fails the batch fails loudly — a 500 to the sender and no
  // IngestRun heartbeat — and re-sending it is safe because the whole path is
  // idempotent. A swallowed error here would leave opted-out people mailable
  // with nothing but a log line to show for it.
  await applyCrmSuppression(accountKey, optOutEmails, optOutPhones);

  return { totalRows: contacts.length, created, updated, skipped, issues };
}

/**
 * Find an existing contact by email first, then phone. Mirrors the CSV
 * importer's identity precedence so both paths dedup consistently.
 */
async function findExisting(accountKey: string, email: string | null, phone: string | null) {
  if (email) {
    const byEmail = await prisma.contact.findUnique({
      where: { accountKey_email: { accountKey, email } },
      select: { id: true, tags: true, customFields: true, dnd: true },
    });
    if (byEmail) return byEmail;
  }
  if (phone) {
    const byPhone = await prisma.contact.findUnique({
      where: { accountKey_phone: { accountKey, phone } },
      select: { id: true, tags: true, customFields: true, dnd: true },
    });
    if (byPhone) return byPhone;
  }
  return null;
}
