// Shared Prisma query builders for /api/contacts/*.
//
// One source of truth for:
//   - turning a Prisma Contact row into the public API Contact shape
//     (string fields, ISO date strings, tags as string[])
//   - materialising the messaging summary fields
//     (hasReceivedEmail / Sms / Message + lastMessageDate) from
//     EmailEvent + SmsEvent aggregates. We only run those aggregates
//     when a consumer asks for them, since they require a group-by
//     across the event tables.
//   - case-folded server-side search on a small set of indexed
//     columns. Postgres `ilike` is fine here at expected dataset
//     sizes (low five figures per account).

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { Contact as ApiContact } from './types';

// ── DB → API mapping ──

type ContactRow = Prisma.ContactGetPayload<{ select: typeof CONTACT_SELECT }>;

export const CONTACT_SELECT = {
  id: true,
  accountKey: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  fullName: true,
  address1: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  source: true,
  tags: true,
  dateAdded: true,
  vehicleYear: true,
  vehicleMake: true,
  vehicleModel: true,
  vehicleVin: true,
  vehicleMileage: true,
  lastServiceDate: true,
  nextServiceDate: true,
  leaseEndDate: true,
  warrantyEndDate: true,
  purchaseDate: true,
  // Selected because the filter builder offers Date of Birth as a
  // filterable lifecycle field. Without it here, birthday segments
  // evaluated in the browser read `undefined` and match nobody, while
  // the same segment resolved server-side (full row) matches — the
  // definition of a filter you can't trust.
  dateOfBirth: true,
  customFields: true,
  dnd: true,
  lastEmailDeliveredAt: true,
  lastEmailOpenedAt: true,
  lastEmailClickedAt: true,
  lastSmsAt: true,
  lastMessageAt: true,
  serviceVisitCount: true,
  saleCount: true,
  lifetimeSpend: true,
  firstServiceEventAt: true,
  lastServiceEventAt: true,
  firstSaleEventAt: true,
  lastSaleEventAt: true,
  // Static list membership, so "is on the do-not-target list" is
  // expressible in a segment. One small join per contact read; contacts
  // belong to few lists in practice.
  listMemberships: { select: { listId: true } },
} as const satisfies Prisma.ContactSelect;

function tagsToStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry)).filter(Boolean);
}

function isoOrEmpty(value: Date | null | undefined): string {
  return value ? value.toISOString() : '';
}

function stringOrEmpty(value: string | null | undefined): string {
  return value ?? '';
}

/**
 * Map a Prisma Contact row to the API `Contact` shape consumers expect.
 *
 * The messaging fields are now read straight off the row's engagement
 * rollup columns. They used to be materialised here from a `summary`
 * argument produced by four aggregate queries through
 * EmailBlastRecipient — which meant they existed ONLY when a caller
 * remembered to pass one, and read as `false` everywhere else. That is
 * the divergence that let a segment preview as N in the builder and
 * match zero contacts in a flow.
 */
export function serializeContact(row: ContactRow): ApiContact {
  const firstName = stringOrEmpty(row.firstName);
  const lastName = stringOrEmpty(row.lastName);
  const fullName =
    stringOrEmpty(row.fullName) ||
    [firstName, lastName].filter(Boolean).join(' ').trim();

  return {
    id: row.id,
    firstName,
    lastName,
    fullName,
    email: stringOrEmpty(row.email),
    phone: stringOrEmpty(row.phone),
    address1: stringOrEmpty(row.address1),
    city: stringOrEmpty(row.city),
    state: stringOrEmpty(row.state),
    postalCode: stringOrEmpty(row.postalCode),
    country: stringOrEmpty(row.country),
    tags: tagsToStringArray(row.tags),
    dateAdded: isoOrEmpty(row.dateAdded),
    source: stringOrEmpty(row.source),
    vehicleYear: stringOrEmpty(row.vehicleYear),
    vehicleMake: stringOrEmpty(row.vehicleMake),
    vehicleModel: stringOrEmpty(row.vehicleModel),
    vehicleVin: stringOrEmpty(row.vehicleVin),
    vehicleMileage: stringOrEmpty(row.vehicleMileage),
    lastServiceDate: isoOrEmpty(row.lastServiceDate),
    nextServiceDate: isoOrEmpty(row.nextServiceDate),
    leaseEndDate: isoOrEmpty(row.leaseEndDate),
    warrantyEndDate: isoOrEmpty(row.warrantyEndDate),
    purchaseDate: isoOrEmpty(row.purchaseDate),
    dateOfBirth: isoOrEmpty(row.dateOfBirth),
    // Legacy booleans, kept so saved segments built against them still
    // work. Each is just "the corresponding timestamp is set".
    hasReceivedMessage: row.lastMessageAt != null,
    hasReceivedEmail: row.lastEmailDeliveredAt != null,
    hasReceivedSms: row.lastSmsAt != null,
    hasOpenedEmail: row.lastEmailOpenedAt != null,
    hasClickedEmail: row.lastEmailClickedAt != null,
    lastMessageDate: isoOrEmpty(row.lastMessageAt),
    lastEmailDeliveredAt: isoOrEmpty(row.lastEmailDeliveredAt),
    lastEmailOpenedAt: isoOrEmpty(row.lastEmailOpenedAt),
    lastEmailClickedAt: isoOrEmpty(row.lastEmailClickedAt),
    lastSmsAt: isoOrEmpty(row.lastSmsAt),
    // Purchase / service history rollups, derived from ContactEvent.
    serviceVisitCount: row.serviceVisitCount,
    saleCount: row.saleCount,
    lifetimeSpend: row.lifetimeSpend,
    firstServiceEventAt: isoOrEmpty(row.firstServiceEventAt),
    lastServiceEventAt: isoOrEmpty(row.lastServiceEventAt),
    firstSaleEventAt: isoOrEmpty(row.firstSaleEventAt),
    lastSaleEventAt: isoOrEmpty(row.lastSaleEventAt),
    listIds: row.listMemberships.map((m) => m.listId),
    // Opt-out state, previously read from the DB but never surfaced —
    // so a segment had no way to see who had opted out, and an audience
    // export would have included them.
    dndEmail: readDndFlag(row.dnd, 'email'),
    dndSms: readDndFlag(row.dnd, 'sms'),
    customFields: customFieldsFromJson(row.customFields),
  };
}

/** Read one channel's opt-out flag from the `dnd` jsonb cell. */
function readDndFlag(value: unknown, channel: 'email' | 'sms'): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const flag = (value as Record<string, unknown>)[channel];
  return flag === true || flag === 'true';
}

/** Coerce the Prisma jsonb cell into the always-an-object shape the
 *  API surface promises. Anything other than a flat object becomes {}
 *  so consumers can read `contact.customFields[key]` without guarding. */
function customFieldsFromJson(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

// ── Search builder ──

/**
 * Build a Prisma `where` fragment that case-insensitively matches a
 * search query against name / email / phone fields. Tag matching is
 * intentionally omitted here — the filter engine handles tags
 * client-side, and a jsonb `array_contains` query on every search
 * keystroke is a heavier query than makes sense for what's a quick
 * lookup. Phone is matched as a substring so dealer staff can
 * search "555-1234" and still hit the +15551234 row.
 */
export function searchClause(query: string): Prisma.ContactWhereInput | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  return {
    OR: [
      { firstName: { contains: trimmed, mode: 'insensitive' } },
      { lastName: { contains: trimmed, mode: 'insensitive' } },
      { fullName: { contains: trimmed, mode: 'insensitive' } },
      { email: { contains: trimmed, mode: 'insensitive' } },
      { phone: { contains: trimmed.replace(/\D/g, '') || trimmed } },
      { source: { contains: trimmed, mode: 'insensitive' } },
    ],
  };
}

// ── List ──

export interface ListContactsOptions {
  accountKey: string;
  search?: string;
  limit?: number;
  /** When true, returns every match (capped to MAX_FETCH_ALL). */
  all?: boolean;
  /**
   * Retained so existing callers (and the `includeMessaging` query
   * param) keep type-checking. Now a no-op: the messaging fields are
   * columns on the row, so they're always present at no extra cost.
   */
  includeMessagingSummary?: boolean;
}

export interface ListContactsResult {
  contacts: ApiContact[];
  total: number;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_FETCH_ALL = 5000;

export async function listContactsForAccount(
  opts: ListContactsOptions,
): Promise<ListContactsResult> {
  const where: Prisma.ContactWhereInput = { accountKey: opts.accountKey };
  const search = searchClause(opts.search ?? '');
  if (search) Object.assign(where, search);

  const take = opts.all
    ? MAX_FETCH_ALL
    : Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? DEFAULT_LIMIT));

  const [rows, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      select: CONTACT_SELECT,
      orderBy: [{ dateAdded: 'desc' }, { createdAt: 'desc' }],
      take,
    }),
    prisma.contact.count({ where: { accountKey: opts.accountKey } }),
  ]);

  return { contacts: rows.map(serializeContact), total };
}

// ── Single ──

export async function getContactById(
  accountKey: string,
  contactId: string,
): Promise<ApiContact | null> {
  const row = await prisma.contact.findFirst({
    where: { id: contactId, accountKey },
    select: CONTACT_SELECT,
  });
  if (!row) return null;
  return serializeContact(row);
}

// ── Stats ──

export async function countContactsForAccount(accountKey: string): Promise<number> {
  return prisma.contact.count({ where: { accountKey } });
}

// ── Paged, cross-account list ──
//
// What the group ("roll-up") Contacts view runs on.
//
// It used to fan out one `?all=true` request PER ACCOUNT from the browser —
// up to MAX_FETCH_ALL rows each, 8 in flight — merge them in JS, and then
// render 50 rows from the result. On a 41-rooftop group that is ~200k contact
// records serialized, shipped, parsed, and held in a tab to show one screenful.
// It also meant the server built 8 of those payloads at once in a process pm2
// restarts at 512MB RSS, which took the whole app down with it.
//
// So: one query, one page.
//
// The wrinkle is that the browser wasn't only paginating — it was DEDUPING.
// One shopper who signed up at three rooftops is three Contact rows, and the
// view collapses them into a single row carrying all three memberships. That
// has to happen BEFORE the limit/offset or the page size is meaningless, so
// the grouping runs in SQL.

/** Rows are grouped by this — mirrors `contactIdentityKey` on the client. */
const IDENTITY_SQL = Prisma.sql`
  CASE
    WHEN btrim(coalesce(c."email", '')) <> ''
      THEN 'email:' || lower(btrim(c."email"))
    WHEN btrim(coalesce(c."phone", '')) LIKE '+%'
         AND regexp_replace(coalesce(c."phone", ''), '\\D', '', 'g') <> ''
      THEN 'phone:+' || regexp_replace(c."phone", '\\D', '', 'g')
    WHEN length(regexp_replace(coalesce(c."phone", ''), '\\D', '', 'g')) = 10
      THEN 'phone:+1' || regexp_replace(c."phone", '\\D', '', 'g')
    WHEN length(regexp_replace(coalesce(c."phone", ''), '\\D', '', 'g')) = 11
         AND regexp_replace(coalesce(c."phone", ''), '\\D', '', 'g') LIKE '1%'
      THEN 'phone:+' || regexp_replace(c."phone", '\\D', '', 'g')
    -- No usable email or phone: not mergeable with anything, so key it to
    -- itself. The client does the same by leaving such rows un-grouped.
    ELSE 'id:' || c."id"
  END
`;

/**
 * Sortable columns, mirroring the table's header buttons. Whitelisted rather
 * than interpolated — these become SQL identifiers.
 *
 * Every one aggregates, because a row here is a PERSON who may span several
 * rooftops: `min(lower(...))` picks a stable representative value so the same
 * person sorts to the same place regardless of which rooftop's row won.
 */
export type PagedSortKey =
  | 'dateAdded'
  | 'fullName'
  | 'email'
  | 'source'
  | 'vehicleMake'
  | '_dealer';

export interface PagedContactsOptions {
  accountKeys: string[];
  /** 0-based. */
  page?: number;
  pageSize?: number;
  search?: string;
  sort?: PagedSortKey;
  dir?: 'asc' | 'desc';
  /**
   * Restrict the page to these contact ids, on top of the account scope
   * and search. This is how a segment filters the Contacts list: the ids
   * come from the segment resolver (see `@/lib/segments/resolve`), which
   * already answered "who is in this segment?" exactly, and this query
   * then does the dedupe, sort and paging it always did.
   *
   * An EMPTY array means "nothing matched", not "no restriction" — the
   * distinction matters, because reading it the other way would show the
   * whole roster for a segment with no members.
   */
  restrictIds?: string[] | null;
}

export interface PagedContactsResult {
  /** One page of deduped contacts, each carrying every account it belongs to. */
  contacts: (ApiContact & { _accountKeys: string[] })[];
  /** Distinct PEOPLE matching the query across every account in scope. */
  total: number;
  page: number;
  pageSize: number;
}

const SORT_EXPR: Record<PagedSortKey, Prisma.Sql> = {
  dateAdded: Prisma.sql`max(c."dateAdded")`,
  fullName: Prisma.sql`min(lower(btrim(coalesce(nullif(btrim(c."fullName"), ''),
    btrim(coalesce(c."firstName", '') || ' ' || coalesce(c."lastName", ''))))))`,
  email: Prisma.sql`min(lower(coalesce(c."email", '')))`,
  source: Prisma.sql`min(lower(coalesce(c."source", '')))`,
  vehicleMake: Prisma.sql`min(lower(coalesce(c."vehicleMake", '')))`,
  // The dealer NAME, not the key — the column shows names and sorts by them.
  _dealer: Prisma.sql`min(lower(coalesce(a."dealer", c."accountKey")))`,
};

const PAGED_MAX_PAGE_SIZE = 200;
const PAGED_DEFAULT_PAGE_SIZE = 50;

export async function listContactsPaged(
  opts: PagedContactsOptions,
): Promise<PagedContactsResult> {
  const accountKeys = [...new Set(opts.accountKeys.filter(Boolean))];
  const pageSize = Math.min(
    PAGED_MAX_PAGE_SIZE,
    Math.max(1, opts.pageSize ?? PAGED_DEFAULT_PAGE_SIZE),
  );
  const page = Math.max(0, opts.page ?? 0);

  if (accountKeys.length === 0) {
    return { contacts: [], total: 0, page, pageSize };
  }

  // `null`/`undefined` = unrestricted; an empty array = an empty result.
  const restrictIds = opts.restrictIds ?? null;
  if (restrictIds && restrictIds.length === 0) {
    return { contacts: [], total: 0, page, pageSize };
  }
  const restrictSql = restrictIds
    ? Prisma.sql`AND c."id" = ANY(${restrictIds})`
    : Prisma.empty;

  const term = (opts.search ?? '').trim();
  // Mirrors `searchClause`, which the single-account path uses. Phone is
  // matched on digits so "(801) 555" finds "+18015550100".
  const digits = term.replace(/\D/g, '');
  const searchSql = term
    ? Prisma.sql`AND (
        c."firstName" ILIKE ${'%' + term + '%'} OR
        c."lastName"  ILIKE ${'%' + term + '%'} OR
        c."fullName"  ILIKE ${'%' + term + '%'} OR
        c."email"     ILIKE ${'%' + term + '%'} OR
        c."source"    ILIKE ${'%' + term + '%'} OR
        c."phone"     LIKE  ${'%' + (digits || term) + '%'}
      )`
    : Prisma.empty;

  // Two steps on purpose. Raw SQL resolves WHICH people are on this page and
  // which accounts each belongs to; Prisma then fetches those rows through
  // CONTACT_SELECT so the 30-odd columns stay typed and serializeContact keeps
  // its single definition. Hand-mapping every column in raw SQL would be a
  // second source of truth for the row shape.
  const sortKey: PagedSortKey = opts.sort && SORT_EXPR[opts.sort] ? opts.sort : 'dateAdded';
  // Default DESC for recency, ASC for the text columns — what each one reads
  // as "first" to a person scanning the list.
  const dir = opts.dir ?? (sortKey === 'dateAdded' ? 'desc' : 'asc');
  const dirSql = dir === 'asc' ? Prisma.sql`ASC NULLS LAST` : Prisma.sql`DESC NULLS LAST`;

  const groups = await prisma.$queryRaw<
    { rep_id: string; account_keys: string[]; total: bigint }[]
  >(Prisma.sql`
    WITH scoped AS (
      SELECT
        c."id",
        c."accountKey",
        c."dateAdded",
        c."createdAt",
        ${IDENTITY_SQL} AS ident,
        ${SORT_EXPR[sortKey]} OVER (PARTITION BY ${IDENTITY_SQL}) AS sort_val
      FROM "Contact" c
      LEFT JOIN "Account" a ON a."key" = c."accountKey"
      WHERE c."accountKey" = ANY(${accountKeys})
      ${restrictSql}
      ${searchSql}
    ),
    grouped AS (
      SELECT
        ident,
        (array_agg("id" ORDER BY "dateAdded" DESC NULLS LAST, "createdAt" DESC))[1] AS rep_id,
        array_agg(DISTINCT "accountKey") AS account_keys,
        min(sort_val) AS sort_val,
        max("createdAt") AS sort_created
      FROM scoped
      GROUP BY ident
    )
    SELECT
      rep_id,
      account_keys,
      -- Total distinct PEOPLE, not rows. Windowed so it costs one pass
      -- instead of a second round trip.
      count(*) OVER () AS total
    FROM grouped
    ORDER BY sort_val ${dirSql}, sort_created DESC
    LIMIT ${pageSize} OFFSET ${page * pageSize}
  `);

  if (groups.length === 0) {
    return { contacts: [], total: 0, page, pageSize };
  }

  const total = Number(groups[0]!.total);
  const repIds = groups.map((g) => g.rep_id);

  const rows = await prisma.contact.findMany({
    where: { id: { in: repIds } },
    select: CONTACT_SELECT,
  });

  // `IN` does not preserve order — restore the ranking the window produced.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const contacts = groups.flatMap((g) => {
    const row = byId.get(g.rep_id);
    if (!row) return [];
    return [{ ...serializeContact(row), _accountKeys: g.account_keys }];
  });

  return { contacts, total, page, pageSize };
}
