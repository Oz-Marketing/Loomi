// CSV → ParsedContact[] → Prisma upsert pipeline.
//
// The flow is two-pass:
//   1. parseCsv() — synchronously parse the uploaded text, return
//      headers + the first N rows for the column-mapping UI.
//   2. importContacts() — apply the user-confirmed mapping, normalise
//      every row, and upsert into Prisma. Idempotent per account on
//      (email) then (phone): re-running the same CSV updates rather
//      than duplicates.
//
// Dedup precedence: email wins over phone for matching. If a CSV row
// has both an email and a phone but the email matches an existing
// contact while the phone matches a *different* contact, we update
// the email-matched contact and overwrite its phone (effectively
// merging the two records into one). We don't try to be clever about
// conflict resolution — first-write-wins, last-write-wins for fields,
// and a single email match wins over a phone match.
//
// Opt-out columns are the exception to last-write-wins. A column mapped to
// an opt-out target can turn a contact's dnd ON but never off (see
// mergeStickyDnd), and every opt-out it carries is also written to the
// suppression list for the whole group — that list, not the flag, is what
// the send path enforces.

import Papa from 'papaparse';
import { prisma } from '@/lib/prisma';
import { addContactsToList } from '@/lib/services/contact-lists';
import {
  OPT_OUT_SOURCE,
  mergeStickyDnd,
  recordEmailOptOuts,
  recordSmsOptOuts,
} from '@/lib/sending/opt-outs';
import {
  ADDITIONAL_EMAILS_FIELD,
  CONTACT_FIELDS,
  type ContactField,
  type ImportTarget,
  type OptOutTarget,
  type ParsedContact,
  type RowIssue,
  autoMapHeaders,
  mergeTags,
  normaliseRow,
  parseDateCell,
  parseEmailCell,
  readTagsArray,
} from './normalize';

// ── Phase 1: parse ──

export interface CsvParseResult {
  headers: string[];
  totalRows: number;
  sampleRows: Record<string, string>[];
  /** Auto-mapping suggestion for the column-mapping UI. */
  suggestedMapping: Record<string, ContactField | OptOutTarget>;
}

const SAMPLE_ROW_COUNT = 5;

/**
 * Parse a CSV text buffer and return a preview suitable for the
 * column-mapping UI. Does not write anything.
 */
export function parseCsv(text: string): CsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });

  const rows = parsed.data;
  const headers = parsed.meta.fields ?? [];

  return {
    headers,
    totalRows: rows.length,
    sampleRows: rows.slice(0, SAMPLE_ROW_COUNT),
    suggestedMapping: autoMapHeaders(headers),
  };
}

// ── Phase 2: import ──

export type ImportMapping = Record<string, ImportTarget>;

export interface ImportSummary {
  totalRows: number;
  imported: number;
  updated: number;
  skipped: number;
  issues: RowIssue[];
  /** Set when an import was targeted at a list — how many new memberships were added. */
  listMembershipsAdded?: number;
  /**
   * Rows whose opt-out columns said yes, per channel. Counted on a dry-run
   * too, so the preview can say how many people the file opts out before
   * anything is written.
   */
  optedOut: { email: number; sms: number };
}

interface ImportContactsOptions {
  accountKey: string;
  csvText: string;
  mapping: ImportMapping;
  /**
   * When true, parse + normalise but don't write. Used by the
   * preview endpoint so the UI can show "would create N, update M,
   * skip K" before the user commits.
   */
  dryRun?: boolean;
  /**
   * When set, every successfully upserted contact is attached to this
   * list during the commit pass. Ignored on dry-runs. Duplicates are
   * skipped, so re-uploading the same CSV against the same list is safe.
   */
  listId?: string;
  /**
   * Tags applied to every contact this import touches, on top of
   * whatever a mapped `tags` column carried. Always MERGED with the
   * contact's existing tags — an import never clears a tag someone set
   * elsewhere. Ignored on dry-runs.
   */
  applyTags?: string[];
  /**
   * When true, a matched contact keeps every existing field value and
   * only its tags (and list membership) change. This is the
   * "upload to a list" flow: the CSV is an identity roster naming who
   * belongs, not a data update.
   *
   * Defaults to false — a plain import writes the CSV's values over the
   * matched record. Note this is deliberately NOT inferred from
   * `listId`: choosing to also file an import into a list shouldn't
   * silently turn off field updates.
   */
  preserveExistingOnMatch?: boolean;
  /** The user running the import — kept on the suppression rows it writes, for the audit trail. */
  importedBy?: string;
}

const MAX_ISSUES_RETURNED = 50;

export async function importContacts({
  accountKey,
  csvText,
  mapping,
  dryRun = false,
  listId,
  applyTags,
  preserveExistingOnMatch = false,
  importedBy,
}: ImportContactsOptions): Promise<ImportSummary> {
  const tagsToApply = mergeTags(applyTags);
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });

  const rows = parsed.data;
  const totalRows = rows.length;

  // Date-typed custom fields for this account. Values mapped into these
  // keys are coerced to canonical ISO date-only (UTC) below, so the flow
  // date triggers — which read the stored value with getUTC* — see a
  // consistent calendar day no matter what date format the source CSV
  // used. Unparseable values are left as-is.
  const dateCustomFieldKeys = new Set(
    (
      await prisma.contactCustomField.findMany({
        where: { accountKey, type: 'date' },
        select: { key: true },
      })
    ).map((f) => f.key),
  );

  const issues: RowIssue[] = [];
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  // Collected during commit so we can bulk-attach to a list at the end.
  // Skipped when the caller didn't ask for list attachment.
  const upsertedContactIds: string[] = [];
  // Addresses the file opts out, written to the suppression list in one
  // set-based pass after the loop.
  const optedOut = { email: 0, sms: 0 };
  const optOutEmails: string[] = [];
  const optOutPhones: string[] = [];

  // Pre-fetch existing contacts for this account so we know whether
  // each row is a create or update without hitting the DB per row.
  // For accounts under ~100k contacts this fits comfortably in memory.
  const existing = dryRun
    ? await prisma.contact.findMany({
        where: { accountKey },
        select: { id: true, email: true, phone: true },
      })
    : null;

  const emailToId = new Map<string, string>();
  const phoneToId = new Map<string, string>();
  if (existing) {
    for (const row of existing) {
      if (row.email) emailToId.set(row.email, row.id);
      if (row.phone) phoneToId.set(row.phone, row.id);
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const result = normaliseRow(rows[i], mapping, i + 2); // +2: header row + 1-indexed
    if (!result.row) {
      skipped += 1;
      if (result.issue && issues.length < MAX_ISSUES_RETURNED) {
        issues.push(result.issue);
      }
      continue;
    }

    const parsedRow = result.row;

    // Collected whether or not the upsert below succeeds: the opt-out belongs
    // to the address, and a contact row that failed to save (a phone already
    // taken by another contact, say) is no reason to keep mailing it.
    if (parsedRow.dnd?.email) {
      const emails = rowEmails(parsedRow);
      if (emails.length > 0) {
        optedOut.email += 1;
        optOutEmails.push(...emails);
      }
    }
    if (parsedRow.dnd?.sms && parsedRow.phone) {
      optedOut.sms += 1;
      optOutPhones.push(parsedRow.phone);
    }

    // Normalize date-typed custom-field values to ISO date-only (UTC).
    if (parsedRow.customFields && dateCustomFieldKeys.size > 0) {
      for (const key of Object.keys(parsedRow.customFields)) {
        if (!dateCustomFieldKeys.has(key)) continue;
        const d = parseDateCell(parsedRow.customFields[key]);
        if (d) parsedRow.customFields[key] = d.toISOString().slice(0, 10);
      }
    }

    if (dryRun) {
      // Count create vs update against the snapshot we pre-fetched.
      const matchedId =
        (parsedRow.email && emailToId.get(parsedRow.email)) ||
        (parsedRow.phone && phoneToId.get(parsedRow.phone));
      if (matchedId) {
        updated += 1;
      } else {
        imported += 1;
        // Tentatively register the new identifier so subsequent rows
        // in the same dry-run don't double-count.
        if (parsedRow.email) emailToId.set(parsedRow.email, '__pending');
        if (parsedRow.phone) phoneToId.set(parsedRow.phone, '__pending');
      }
      continue;
    }

    try {
      const result = await upsertContact(accountKey, parsedRow, {
        overwriteOnMatch: !preserveExistingOnMatch,
        applyTags: tagsToApply,
      });
      if (result.action === 'created') imported += 1;
      else updated += 1;
      if (listId) upsertedContactIds.push(result.id);
    } catch (err) {
      skipped += 1;
      if (issues.length < MAX_ISSUES_RETURNED) {
        issues.push({
          rowNumber: i + 2,
          reason: err instanceof Error ? err.message : 'Upsert failed',
        });
      }
    }
  }

  // Reason 'manual' (a deliberate opt-out, not a bounce), source 'import' — an
  // export can't say whether the person opted out themselves, so the contact
  // toggle won't clear these. See OPT_OUT_SOURCE.import.
  if (!dryRun && (optOutEmails.length > 0 || optOutPhones.length > 0)) {
    const raw = JSON.stringify({ via: 'contact-import', ...(importedBy ? { userId: importedBy } : {}) });
    const shared = { accountKey, reason: 'manual' as const, source: OPT_OUT_SOURCE.import, raw };
    if (optOutEmails.length > 0) await recordEmailOptOuts({ ...shared, emails: optOutEmails });
    if (optOutPhones.length > 0) await recordSmsOptOuts({ ...shared, phones: optOutPhones });
  }

  let listMembershipsAdded: number | undefined;
  if (listId && upsertedContactIds.length > 0) {
    listMembershipsAdded = await addContactsToList(listId, upsertedContactIds);
  }

  return { totalRows, imported, updated, skipped, issues, listMembershipsAdded, optedOut };
}

/**
 * Every address an opted-out row names: the contact's email and the
 * alternates a packed cell carried. They all belong to the person who opted out.
 */
function rowEmails(row: ParsedContact): string[] {
  const alternates = row.customFields?.[ADDITIONAL_EMAILS_FIELD];
  return [
    ...(row.email ? [row.email] : []),
    ...(alternates ? parseEmailCell(alternates).addresses : []),
  ];
}

// ── Upsert ──

type UpsertResult = { action: 'created' | 'updated'; id: string };

/** The fields we need off an already-existing contact to decide what to write. */
type MatchedContact = { id: string; tags: unknown; dnd: unknown };

/**
 * Find the contact this row refers to, preferring an email match and
 * falling back to phone. Returns null when the row names someone new.
 */
async function findMatch(
  accountKey: string,
  row: ParsedContact,
): Promise<MatchedContact | null> {
  if (row.email) {
    const byEmail = await prisma.contact.findUnique({
      where: { accountKey_email: { accountKey, email: row.email } },
      select: { id: true, tags: true, dnd: true },
    });
    if (byEmail) return byEmail;
  }

  if (row.phone) {
    const byPhone = await prisma.contact.findUnique({
      where: { accountKey_phone: { accountKey, phone: row.phone } },
      select: { id: true, tags: true, dnd: true },
    });
    if (byPhone) return byPhone;
  }

  return null;
}

/**
 * Upsert a single contact, preferring email-match for identity and
 * falling back to phone-match. Falls through to a create when
 * neither matches.
 *
 * `overwriteOnMatch` controls what happens when an existing contact
 * is matched: true rewrites it with the CSV data (standalone import
 * page semantics), false leaves its fields untouched (list-targeted
 * import semantics — we just want the identity link).
 *
 * Tags are the exception to both modes: they are always the UNION of
 * what the contact already had, what a mapped `tags` column carried,
 * and `applyTags`. An import adds tags; it never takes one away. (It
 * used to: `toPrismaData` wrote the parsed `tags` array unconditionally,
 * and that array is `[]` whenever no column is mapped to it, so every
 * overwrite-on-match import silently cleared the tags of every contact
 * it matched.)
 */
async function upsertContact(
  accountKey: string,
  row: ParsedContact,
  { overwriteOnMatch, applyTags }: { overwriteOnMatch: boolean; applyTags: string[] },
): Promise<UpsertResult> {
  const matched = await findMatch(accountKey, row);

  if (matched) {
    const existingTags = readTagsArray(matched.tags);
    const tags = mergeTags(existingTags, row.tags, applyTags);
    // Opt-outs land in BOTH modes: a roster upload that names someone as
    // opted out is still telling us they opted out. Sticky, so the file can
    // add an opt-out but never take one away.
    const dnd = row.dnd ? mergeStickyDnd(matched.dnd, row.dnd) : null;
    const dndChanged = dnd !== null && !sameDnd(matched.dnd, dnd);

    if (overwriteOnMatch) {
      await prisma.contact.update({
        where: { id: matched.id },
        data: { ...toPrismaData(row), tags, ...(dndChanged ? { dnd } : {}) },
      });
    } else if (tags.length !== existingTags.length || dndChanged) {
      // Match-only import. The merge is a superset of what was there, so
      // an unchanged length (and no new opt-out) means nothing to write —
      // skip it rather than bump updatedAt across the whole roster on a
      // re-upload.
      await prisma.contact.update({
        where: { id: matched.id },
        data: { tags, ...(dndChanged ? { dnd } : {}) },
      });
    }

    return { action: 'updated', id: matched.id };
  }

  const created = await prisma.contact.create({
    data: {
      accountKey,
      dateAdded: new Date(),
      ...toPrismaData(row),
      tags: mergeTags(row.tags, applyTags),
      ...(row.dnd ? { dnd: row.dnd } : {}),
    },
    select: { id: true },
  });
  return { action: 'created', id: created.id };
}

/** Do two dnd cells say the same thing for email and sms? */
function sameDnd(a: unknown, b: Readonly<Record<string, unknown>>): boolean {
  const prior = a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : {};
  return prior.email === b.email && prior.sms === b.sms;
}

/**
 * Turn a ParsedContact into a Prisma create/update payload. Skips
 * keys that are null/empty so partial CSV uploads don't blank out
 * existing data on update.
 */
function toPrismaData(row: ParsedContact): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const field of CONTACT_FIELDS) {
    // tags are merged by the caller, never replaced from here.
    if (field === 'tags') continue;
    const value = row[field];
    if (value === null) continue;
    if (value instanceof Date) {
      data[field] = value;
      continue;
    }
    if (typeof value === 'string' && value === '') continue;
    data[field] = value;
  }

  if (row.customFields) {
    data.customFields = row.customFields;
  }

  return data;
}
