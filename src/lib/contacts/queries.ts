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

import type { Prisma } from '@prisma/client';
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
