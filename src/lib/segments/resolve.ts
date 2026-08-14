// Server-side segment resolution — the one place that answers "who is
// in this segment?" and "how many?".
//
// Two strategies, one contract:
//
//   'sql'  — the whole definition translated to a WHERE clause and
//            answered by Postgres. O(1) round trips, no row ever leaves
//            the database for a count.
//   'scan' — the definition touches messaging or custom fields, which
//            can't be translated exactly (see sql-filter.ts), so every
//            contact is streamed through the same JS engine the builder
//            uses. Slower, but complete and never capped.
//
// Both are exhaustive. The thing being replaced was neither: it fetched
// at most 5,000 contacts into a browser tab and filtered there, so every
// count on a larger account was a count of a sample that nothing in the
// UI admitted was a sample.

import { prisma } from '@/lib/prisma';
import { CONTACT_SELECT, serializeContact } from '@/lib/contacts/queries';
import type { Contact as ApiContact } from '@/lib/contacts/types';
import { evaluateFilter } from '@/lib/smart-list-engine';
import type { FieldDefinition, FilterDefinition } from '@/lib/smart-list-types';
import { loadSegmentRefs, type SegmentRefs } from './refs';
import { translateDefinitionToSql } from './sql-filter';

export type SegmentStrategy = 'sql' | 'scan';

export interface SegmentResolution {
  /** Exact number of contacts in the segment. Never a sample. */
  count: number;
  /**
   * How many members carry each identifier, counted exactly rather than
   * extrapolated from the preview sample. These are the numbers that
   * decide whether a segment is worth anything to an ad platform: a
   * 40,000-member segment where 900 have an email address is a 900-member
   * Customer Match audience, and it should be visible BEFORE anyone
   * builds a campaign on it.
   */
  reachable: { email: number; phone: number };
  strategy: SegmentStrategy;
  /** Field keys that forced the scan strategy — useful for explaining a
   *  slow segment, and for seeing which fields would most benefit from
   *  being denormalised into real columns. */
  untranslatable: string[];
}

export interface SegmentPreview extends SegmentResolution {
  /** A bounded sample for display. `count` is the real total. */
  contacts: ApiContact[];
  /** Total contacts in the account, so the UI can express the segment as
   *  a share of the roster without a second (differently-permissioned)
   *  request. */
  accountTotal: number;
}

// One page of the keyset scan. Matches the batch size the flows engine
// already uses for whole-account contact walks.
const SCAN_BATCH = 1000;

// Hard ceiling on the scan strategy, as a safety valve rather than a
// product limit: at 1k rows/batch this is 2M contacts, far beyond any
// real account. Hitting it means something pathological, and we'd rather
// throw than quietly return a partial answer — the exact failure mode
// this module exists to remove.
const MAX_SCAN_ROWS = 2_000_000;

export class SegmentScanOverflowError extends Error {
  constructor(accountKey: string) {
    super(`Segment scan for account ${accountKey} exceeded ${MAX_SCAN_ROWS} contacts`);
    this.name = 'SegmentScanOverflowError';
  }
}

/** Count the contacts matching a definition. Exact. */
export async function countSegment(
  accountKey: string,
  definition: FilterDefinition,
  fields: FieldDefinition[],
): Promise<SegmentResolution> {
  const refs = await loadSegmentRefs(accountKey, definition);
  const { where, untranslatable } = translateDefinitionToSql(definition, fields, refs);

  if (where) {
    const rows = await prisma.$queryRaw<
      Array<{ count: number; with_email: number; with_phone: number }>
    >`
      SELECT
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE btrim(COALESCE("Contact"."email", '')) <> '')::int AS with_email,
        COUNT(*) FILTER (WHERE btrim(COALESCE("Contact"."phone", '')) <> '')::int AS with_phone
      FROM "Contact"
      WHERE "Contact"."accountKey" = ${accountKey}
        AND ${where}
    `;
    const row = rows[0];
    return {
      count: row?.count ?? 0,
      reachable: { email: row?.with_email ?? 0, phone: row?.with_phone ?? 0 },
      strategy: 'sql',
      untranslatable,
    };
  }

  let count = 0;
  let withEmail = 0;
  let withPhone = 0;
  await forEachMatch(accountKey, definition, fields, refs, (contact) => {
    count += 1;
    if (contact.email.trim()) withEmail += 1;
    if (contact.phone.trim()) withPhone += 1;
  });
  return {
    count,
    reachable: { email: withEmail, phone: withPhone },
    strategy: 'scan',
    untranslatable,
  };
}

/**
 * Count plus a bounded sample of matching contacts, for the builder's
 * live preview. The sample is capped; the count is not.
 */
export async function previewSegment(
  accountKey: string,
  definition: FilterDefinition,
  fields: FieldDefinition[],
  sampleSize = 25,
): Promise<SegmentPreview> {
  const refs = await loadSegmentRefs(accountKey, definition);
  const { where, untranslatable } = translateDefinitionToSql(definition, fields, refs);

  if (where) {
    const [totals, idRows, accountTotal] = await Promise.all([
      countSegment(accountKey, definition, fields),
      prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "Contact"."id"
        FROM "Contact"
        WHERE "Contact"."accountKey" = ${accountKey}
          AND ${where}
        ORDER BY "Contact"."dateAdded" DESC NULLS LAST, "Contact"."createdAt" DESC
        LIMIT ${sampleSize}
      `,
      prisma.contact.count({ where: { accountKey } }),
    ]);
    return {
      ...totals,
      accountTotal,
      contacts: await loadContactsByIds(
        accountKey,
        idRows.map((r) => r.id),
      ),
    };
  }

  // One scan produces the totals AND the sample — walking the account
  // twice for a live preview would double the cost of every keystroke.
  let count = 0;
  let withEmail = 0;
  let withPhone = 0;
  const sampleIds: string[] = [];
  await forEachMatch(accountKey, definition, fields, refs, (contact) => {
    count += 1;
    if (contact.email.trim()) withEmail += 1;
    if (contact.phone.trim()) withPhone += 1;
    if (sampleIds.length < sampleSize) sampleIds.push(contact.id);
  });
  return {
    count,
    reachable: { email: withEmail, phone: withPhone },
    strategy: 'scan',
    untranslatable,
    accountTotal: await prisma.contact.count({ where: { accountKey } }),
    contacts: await loadContactsByIds(accountKey, sampleIds),
  };
}

/**
 * Every matching contact id. This is what an ad-platform sync will diff
 * against a previous snapshot, so it must be complete — callers should
 * expect it to be large and treat it as such.
 */
export async function collectSegmentContactIds(
  accountKey: string,
  definition: FilterDefinition,
  fields: FieldDefinition[],
): Promise<string[]> {
  const refs = await loadSegmentRefs(accountKey, definition);
  const { where } = translateDefinitionToSql(definition, fields, refs);

  if (where) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "Contact"."id"
      FROM "Contact"
      WHERE "Contact"."accountKey" = ${accountKey}
        AND ${where}
      ORDER BY "Contact"."id" ASC
    `;
    return rows.map((r) => r.id);
  }

  const ids: string[] = [];
  await forEachMatch(accountKey, definition, fields, refs, (contact) => {
    ids.push(contact.id);
  });
  return ids;
}

// ── Scan strategy ───────────────────────────────────────────────

/**
 * Keyset-paginate every contact in the account, hydrate the messaging
 * fields when the definition needs them, and run the JS engine over each
 * page. `onMatch` sees every match exactly once.
 *
 * Keyset (id-cursor) rather than offset so the walk stays an index range
 * scan and doesn't degrade on later pages; only one page is resident at
 * a time, so memory is bounded regardless of account size.
 */
async function forEachMatch(
  accountKey: string,
  definition: FilterDefinition,
  fields: FieldDefinition[],
  refs: SegmentRefs,
  onMatch: (contact: ApiContact) => void,
): Promise<void> {
  let cursor: string | undefined;
  let scanned = 0;

  for (;;) {
    const batch = await prisma.contact.findMany({
      where: { accountKey },
      select: CONTACT_SELECT,
      orderBy: { id: 'asc' },
      take: SCAN_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) return;

    scanned += batch.length;
    if (scanned > MAX_SCAN_ROWS) throw new SegmentScanOverflowError(accountKey);

    // Serialize before evaluating. The engine's semantics are defined
    // over the API Contact shape — derived fullName, ISO date strings,
    // tags as string[], null coerced to '' — so feeding it raw Prisma
    // rows quietly changes what some conditions mean. This is the same
    // input the browser used to filter, minus the 5,000-row cap.
    const contacts = batch.map(serializeContact);

    for (const match of evaluateFilter(contacts, definition, fields, refs)) {
      onMatch(match);
    }

    if (batch.length < SCAN_BATCH) return;
    cursor = batch[batch.length - 1].id;
  }
}

// ── Shared ──────────────────────────────────────────────────────

/**
 * Re-read a set of ids through the normal contact serializer so preview
 * rows are shaped exactly like every other Contact the API returns —
 * including the materialised messaging fields.
 */
async function loadContactsByIds(
  accountKey: string,
  ids: string[],
): Promise<ApiContact[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.contact.findMany({
    where: { accountKey, id: { in: ids } },
    select: CONTACT_SELECT,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));

  // Preserve the caller's id order — the SQL path already sorted them.
  return ids
    .map((id) => {
      const row = byId.get(id);
      if (!row) return null;
      return serializeContact(row);
    })
    .filter((c): c is ApiContact => c !== null);
}
