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

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  CONTACT_SELECT,
  contactIdentitySql,
  serializeContact,
} from '@/lib/contacts/queries';
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
  constructor(accountKey: string, limit = MAX_SCAN_ROWS) {
    super(`Segment scan for account ${accountKey} exceeded ${limit.toLocaleString()} contacts`);
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

// ── Cross-account resolution (group roll-up) ────────────────────
//
// A group account (Young Powersports, Young Automotive Group) owns no
// contacts of its own — every contact hangs off a rooftop beneath it. So
// the single-account functions above, which are all `accountKey = $1`,
// correctly return ZERO for a group, and that is what the segment
// builder showed while it only ever asked about one key.
//
// The rule everywhere else in the product is: a group resolves to itself
// plus its descendants (see `expandWithDescendants`). These functions
// apply that rule to segments.
//
// Two things make this more than an `IN (...)`:
//
//   1. The definition is validated and translated PER ACCOUNT, because
//      the field catalogue is per-account — the same custom-field key can
//      exist in one rooftop and not the next. Each account contributes
//      its own predicate, and they're OR'd together with the account
//      guard so one rooftop's translation can never leak into another's
//      rows.
//   2. Contacts are unique per (accountKey, email), so a shopper who has
//      bought at three rooftops is three rows. Counting rows would report
//      three people. Everything user-facing here is therefore grouped by
//      contact identity — the SAME expression the group Contacts list
//      groups by — so "12,438 contacts match" and the 12,438 rows you get
//      when you click through are the same number.

/** One account's slice of a cross-account resolution. */
export interface SegmentAccountPlan {
  accountKey: string;
  /** Already validated against THIS account's field catalogue. */
  definition: FilterDefinition;
  fields: FieldDefinition[];
}

export interface CrossAccountSegmentResolution {
  /** Distinct PEOPLE matching, across every account in scope. */
  count: number;
  reachable: { email: number; phone: number };
  /** 'scan' when any account in scope needed the JS engine. */
  strategy: SegmentStrategy;
  untranslatable: string[];
}

export interface CrossAccountSegmentPreview extends CrossAccountSegmentResolution {
  /** Distinct people in the accounts in scope, for the "% of roster" line. */
  accountTotal: number;
  contacts: ApiContact[];
}

/**
 * Ceiling on the ids one untranslatable account may contribute to a
 * cross-account predicate. Matches `MAX_SEGMENT_IDS` in lookup.ts — the
 * same bound, for the same reason: a pathological filter must not turn a
 * preview into an unbounded array held in memory.
 */
const MAX_SCOPE_IDS = 200_000;

/**
 * The WHERE clause covering every account in scope, plus how it was
 * arrived at.
 *
 * Accounts whose definition translates to SQL contribute a predicate.
 * Accounts that don't (custom fields — see sql-filter.ts) are scanned for
 * their ids first and contribute an id list, so the aggregate below is
 * still one grouped query over the whole scope rather than a per-account
 * sum that couldn't dedupe.
 */
async function buildScopePredicate(plans: SegmentAccountPlan[]): Promise<{
  predicate: Prisma.Sql;
  strategy: SegmentStrategy;
  untranslatable: string[];
}> {
  const clauses: Prisma.Sql[] = [];
  const untranslatable = new Set<string>();
  const scanIds: string[] = [];
  let scanned = false;

  for (const plan of plans) {
    const refs = await loadSegmentRefs(plan.accountKey, plan.definition);
    const { where, untranslatable: keys } = translateDefinitionToSql(
      plan.definition,
      plan.fields,
      refs,
    );
    for (const key of keys) untranslatable.add(key);

    if (where) {
      clauses.push(
        Prisma.sql`("Contact"."accountKey" = ${plan.accountKey} AND ${where})`,
      );
      continue;
    }

    scanned = true;
    const ids = await collectSegmentContactIds(plan.accountKey, plan.definition, plan.fields);
    if (scanIds.length + ids.length > MAX_SCOPE_IDS) {
      throw new SegmentScanOverflowError(plan.accountKey, MAX_SCOPE_IDS);
    }
    scanIds.push(...ids);
  }

  if (scanIds.length > 0) {
    clauses.push(Prisma.sql`("Contact"."id" = ANY(${scanIds}))`);
  }

  return {
    // No accounts, or every account resolved to nothing: an explicitly
    // empty predicate rather than a missing one. `WHERE` with nothing
    // after it would be a syntax error, and `WHERE TRUE` would return
    // the whole table — the worst possible default here.
    predicate: clauses.length > 0 ? Prisma.join(clauses, ' OR ') : Prisma.sql`FALSE`,
    strategy: scanned ? 'scan' : 'sql',
    untranslatable: [...untranslatable],
  };
}

const IDENTITY = contactIdentitySql('"Contact"');

/** Distinct people matching, and how many carry each identifier. */
async function aggregateScope(predicate: Prisma.Sql): Promise<{
  count: number;
  reachable: { email: number; phone: number };
}> {
  const rows = await prisma.$queryRaw<
    Array<{ count: number; with_email: number; with_phone: number }>
  >(Prisma.sql`
    WITH scoped AS (
      SELECT
        ${IDENTITY} AS ident,
        btrim(coalesce("Contact"."email", '')) <> '' AS has_email,
        btrim(coalesce("Contact"."phone", '')) <> '' AS has_phone
      FROM "Contact"
      WHERE ${predicate}
    ),
    grouped AS (
      -- One row per PERSON. bool_or because reachability is a property
      -- of the person, not of whichever rooftop's row happens to win:
      -- an email at one store makes them emailable.
      SELECT ident, bool_or(has_email) AS has_email, bool_or(has_phone) AS has_phone
      FROM scoped
      GROUP BY ident
    )
    SELECT
      COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE has_email)::int AS with_email,
      COUNT(*) FILTER (WHERE has_phone)::int AS with_phone
    FROM grouped
  `);
  const row = rows[0];
  return {
    count: row?.count ?? 0,
    reachable: { email: row?.with_email ?? 0, phone: row?.with_phone ?? 0 },
  };
}

/** Count a definition across every account in scope. Exact, deduped. */
export async function countSegmentAcrossAccounts(
  plans: SegmentAccountPlan[],
): Promise<CrossAccountSegmentResolution> {
  const { predicate, strategy, untranslatable } = await buildScopePredicate(plans);
  const totals = await aggregateScope(predicate);
  return { ...totals, strategy, untranslatable };
}

/** Count plus a bounded sample, for the builder's live preview. */
export async function previewSegmentAcrossAccounts(
  plans: SegmentAccountPlan[],
  sampleSize = 25,
): Promise<CrossAccountSegmentPreview> {
  const { predicate, strategy, untranslatable } = await buildScopePredicate(plans);
  const accountKeys = plans.map((p) => p.accountKey);

  const [totals, sampleRows, totalRows] = await Promise.all([
    aggregateScope(predicate),
    prisma.$queryRaw<Array<{ rep_id: string }>>(Prisma.sql`
      WITH scoped AS (
        SELECT
          "Contact"."id",
          "Contact"."dateAdded",
          "Contact"."createdAt",
          ${IDENTITY} AS ident
        FROM "Contact"
        WHERE ${predicate}
      ),
      grouped AS (
        -- One representative row per person, newest first — the same
        -- representative the Contacts list picks.
        SELECT
          (array_agg("id" ORDER BY "dateAdded" DESC NULLS LAST, "createdAt" DESC))[1] AS rep_id,
          max("dateAdded") AS last_added,
          max("createdAt") AS last_created
        FROM scoped
        GROUP BY ident
      )
      SELECT rep_id
      FROM grouped
      ORDER BY last_added DESC NULLS LAST, last_created DESC
      LIMIT ${sampleSize}
    `),
    // The roster the segment is a share OF — also distinct people, or the
    // percentage would be a fraction with two different denominators.
    prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT DISTINCT ${IDENTITY} AS ident
        FROM "Contact"
        WHERE "Contact"."accountKey" = ANY(${accountKeys})
      ) people
    `),
  ]);

  return {
    ...totals,
    strategy,
    untranslatable,
    accountTotal: totalRows[0]?.total ?? 0,
    contacts: await loadContactsById(sampleRows.map((r) => r.rep_id)),
  };
}

/**
 * Every matching contact id across the scope, NOT deduped — a sync or
 * export needs the underlying rows, and dedupes them itself by hashed
 * identity (see eligibility.ts).
 */
export async function collectSegmentContactIdsAcrossAccounts(
  plans: SegmentAccountPlan[],
): Promise<string[]> {
  const { predicate } = await buildScopePredicate(plans);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "Contact"."id"
    FROM "Contact"
    WHERE ${predicate}
    ORDER BY "Contact"."id" ASC
  `);
  return rows.map((r) => r.id);
}

/**
 * Like `loadContactsByIds` but without an account restriction: the ids
 * come from a query that was already account-scoped, and a cross-account
 * sample spans several of them by design.
 */
async function loadContactsById(ids: string[]): Promise<ApiContact[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.contact.findMany({
    where: { id: { in: ids } },
    select: CONTACT_SELECT,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => {
      const row = byId.get(id);
      return row ? serializeContact(row) : null;
    })
    .filter((c): c is ApiContact => c !== null);
}
