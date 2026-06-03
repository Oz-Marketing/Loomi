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

import Papa from 'papaparse';
import { prisma } from '@/lib/prisma';
import { addContactsToList } from '@/lib/services/contact-lists';
import {
  CONTACT_FIELDS,
  IGNORE_FIELD,
  type ContactField,
  type ParsedContact,
  type RowIssue,
  autoMapHeaders,
  normaliseRow,
  parseDateCell,
} from './normalize';

// ── Phase 1: parse ──

export interface CsvParseResult {
  headers: string[];
  totalRows: number;
  sampleRows: Record<string, string>[];
  /** Auto-mapping suggestion for the column-mapping UI. */
  suggestedMapping: Record<string, ContactField>;
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

export type ImportMapping = Record<
  string,
  ContactField | typeof IGNORE_FIELD | `custom:${string}`
>;

export interface ImportSummary {
  totalRows: number;
  imported: number;
  updated: number;
  skipped: number;
  issues: RowIssue[];
  /** Set when an import was targeted at a list — how many new memberships were added. */
  listMembershipsAdded?: number;
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
}

const MAX_ISSUES_RETURNED = 50;

export async function importContacts({
  accountKey,
  csvText,
  mapping,
  dryRun = false,
  listId,
}: ImportContactsOptions): Promise<ImportSummary> {
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
      // List-targeted imports preserve existing data (match-only), so the
      // existing contact record's fields aren't clobbered by re-uploads.
      // Standalone imports keep the original write-on-match behavior.
      const result = await upsertContact(accountKey, parsedRow, {
        overwriteOnMatch: !listId,
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

  let listMembershipsAdded: number | undefined;
  if (listId && upsertedContactIds.length > 0) {
    listMembershipsAdded = await addContactsToList(listId, upsertedContactIds);
  }

  return { totalRows, imported, updated, skipped, issues, listMembershipsAdded };
}

// ── Upsert ──

type UpsertResult = { action: 'created' | 'updated'; id: string };

/**
 * Upsert a single contact, preferring email-match for identity and
 * falling back to phone-match. Falls through to a create when
 * neither matches.
 *
 * `overwriteOnMatch` controls what happens when an existing contact
 * is matched: true rewrites it with the CSV data (standalone import
 * page semantics), false leaves it untouched (list-targeted import
 * semantics — we just want the identity link, not the fields).
 */
async function upsertContact(
  accountKey: string,
  row: ParsedContact,
  { overwriteOnMatch }: { overwriteOnMatch: boolean },
): Promise<UpsertResult> {
  const writeData = toPrismaData(row);

  // Match by email first if present.
  if (row.email) {
    const existing = await prisma.contact.findUnique({
      where: { accountKey_email: { accountKey, email: row.email } },
      select: { id: true },
    });
    if (existing) {
      if (overwriteOnMatch) {
        await prisma.contact.update({ where: { id: existing.id }, data: writeData });
      }
      return { action: 'updated', id: existing.id };
    }
  }

  // Fall back to phone match.
  if (row.phone) {
    const existing = await prisma.contact.findUnique({
      where: { accountKey_phone: { accountKey, phone: row.phone } },
      select: { id: true },
    });
    if (existing) {
      if (overwriteOnMatch) {
        await prisma.contact.update({ where: { id: existing.id }, data: writeData });
      }
      return { action: 'updated', id: existing.id };
    }
  }

  const created = await prisma.contact.create({
    data: { accountKey, ...writeData },
    select: { id: true },
  });
  return { action: 'created', id: created.id };
}

/**
 * Turn a ParsedContact into a Prisma create/update payload. Skips
 * keys that are null/empty so partial CSV uploads don't blank out
 * existing data on update.
 */
function toPrismaData(row: ParsedContact): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const field of CONTACT_FIELDS) {
    const value = row[field];
    if (value === null) continue;
    if (Array.isArray(value)) {
      // tags — empty array is meaningful (clear tags); keep it
      data[field] = value;
      continue;
    }
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
