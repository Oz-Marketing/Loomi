// The one definition of "a contact, as a CSV row".
//
// Extracted from POST /api/contacts/export so segment exports produce a
// byte-identical file. Two copies of this list would drift the moment a
// column was added to one of them, and the difference would only show up
// in a spreadsheet somebody had already sent to a client.

import { prisma } from '@/lib/prisma';

export const CONTACT_CSV_COLUMNS: { key: string; label: string }[] = [
  { key: 'fullName', label: 'Full Name' },
  { key: 'firstName', label: 'First Name' },
  { key: 'lastName', label: 'Last Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'address1', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'postalCode', label: 'Postal Code' },
  { key: 'country', label: 'Country' },
  { key: 'source', label: 'Source' },
  { key: 'tags', label: 'Tags' },
  { key: 'dateAdded', label: 'Date Added' },
  { key: 'vehicleYear', label: 'Vehicle Year' },
  { key: 'vehicleMake', label: 'Vehicle Make' },
  { key: 'vehicleModel', label: 'Vehicle Model' },
];

/** The columns the CSV needs, as a Prisma select. */
export const CONTACT_CSV_SELECT = {
  id: true,
  accountKey: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  address1: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  source: true,
  dateAdded: true,
  vehicleYear: true,
  vehicleMake: true,
  vehicleModel: true,
  tags: true,
} as const;

export function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatCell(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

type CsvContactRow = {
  firstName?: string | null;
  lastName?: string | null;
  tags?: unknown;
  [key: string]: unknown;
};

/** Header row + one line per contact. */
export function buildContactsCsv(rows: CsvContactRow[]): string {
  const body = rows.map((c) => {
    const record: Record<string, unknown> = {
      ...c,
      fullName: [c.firstName, c.lastName].filter(Boolean).join(' '),
      // `Contact.tags` is a JSON column, not a relation.
      tags: Array.isArray(c.tags) ? c.tags.map((t) => String(t)).join('; ') : '',
    };
    return CONTACT_CSV_COLUMNS.map((col) => csvEscape(formatCell(record[col.key]))).join(',');
  });
  return [CONTACT_CSV_COLUMNS.map((c) => csvEscape(c.label)).join(','), ...body].join('\n');
}

// Contacts are fetched in chunks rather than one `IN (...)` of every id:
// a segment export can be tens of thousands of ids, and a single bind
// parameter list that long is where Postgres starts refusing the query.
const FETCH_CHUNK = 5_000;

/**
 * Load the CSV columns for a set of contact ids, restricted to the given
 * accounts. Order follows `ids`, so a caller that sorted them keeps its
 * sort. Ids outside `accountKeys` simply do not come back — the scope is
 * applied in the query, not after it.
 */
export async function loadContactsForCsv(
  ids: string[],
  accountKeys: string[] | null,
): Promise<Array<Record<string, unknown>>> {
  if (ids.length === 0) return [];

  const byId = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += FETCH_CHUNK) {
    const chunk = ids.slice(i, i + FETCH_CHUNK);
    const rows = await prisma.contact.findMany({
      where: {
        id: { in: chunk },
        ...(accountKeys ? { accountKey: { in: accountKeys } } : {}),
      },
      select: CONTACT_CSV_SELECT,
    });
    for (const row of rows) byId.set(row.id, row as Record<string, unknown>);
  }

  return ids.map((id) => byId.get(id)).filter((row): row is Record<string, unknown> => Boolean(row));
}

/** `Content-Disposition` etc. for a CSV download response. */
export function csvHeaders(filename: string): Record<string, string> {
  return {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  };
}

/** Turn a segment name into something safe to put in a filename. */
export function csvFilenameSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'segment';
}
