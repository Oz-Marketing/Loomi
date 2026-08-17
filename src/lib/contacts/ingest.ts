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
import {
  normaliseEmail,
  normalisePhone,
  parseDateCell,
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
   * data (e.g. dealer opt-out flags). Merged into the existing dnd, so a
   * suppression from one feed is never silently cleared by a feed that
   * omits it. Loomi's send engine must honor this before email/SMS.
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
  const email = input.email ? normaliseEmail(String(input.email)) || null : null;
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

  return { email, phone, source, tags, customFields, strings, dates, dnd };
}

/** Read an existing contact's tags Json column as a string[]. */
function existingTags(value: unknown): string[] {
  return Array.isArray(value) ? (value.filter((t) => typeof t === 'string') as string[]) : [];
}

/** Read an existing contact's dnd Json column as an object. */
function existingDnd(value: unknown): Record<string, boolean> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, boolean>)
    : {};
}

/**
 * Enforce suppression at the level the send worker actually checks:
 * EmailSuppression / SmsSuppression rows (the Contact.dnd JSON is only a
 * UI convenience). We upsert a row for each channel the source marked
 * opted-out. We intentionally do NOT delete on a `false` flag — an
 * opt-out is a sticky compliance signal, and skipping the per-row delete
 * keeps the backfill fast (the vast majority of contacts aren't
 * suppressed). Manual re-opt-in is handled by the suppression UI.
 */
async function applyCrmSuppression(
  accountKey: string,
  email: string | null,
  phone: string | null,
  dnd: { email?: boolean; sms?: boolean },
): Promise<void> {
  if (dnd.email === true && email) {
    await prisma.emailSuppression.upsert({
      where: { accountKey_email: { accountKey, email } },
      update: { reason: 'crm-optout', source: 'oz-reports' },
      create: { accountKey, email, reason: 'crm-optout', source: 'oz-reports' },
    });
  }
  if (dnd.sms === true && phone) {
    await prisma.smsSuppression.upsert({
      where: { accountKey_phone: { accountKey, phone } },
      update: { reason: 'crm-optout', source: 'oz-reports' },
      create: { accountKey, phone, reason: 'crm-optout', source: 'oz-reports' },
    });
  }
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

  for (let i = 0; i < contacts.length; i++) {
    const row = normalise(contacts[i], source);
    if (!row) {
      skipped += 1;
      if (issues.length < MAX_ISSUES_RETURNED) {
        issues.push({ index: i, reason: 'No usable email or phone — skipped' });
      }
      continue;
    }

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
            // Merge suppression so a prior opt-out is never cleared by a feed
            // that omits dnd. Only written when this row carried consent data.
            ...(row.dnd ? { dnd: { ...existingDnd(existing.dnd), ...row.dnd } } : {}),
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

      // Write the suppression rows the send worker enforces on. Runs for
      // both create and update; only channels flagged opted-out are written.
      if (row.dnd) {
        await applyCrmSuppression(accountKey, row.email, row.phone, row.dnd);
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
