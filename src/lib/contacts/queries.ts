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
  customFields: true,
  dnd: true,
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
 * Map a Prisma Contact row to the API `Contact` shape consumers
 * already expect. Messaging fields default to false / empty; pass a
 * `summary` map (from `getMessagingSummaryForContacts`) to fill them
 * in.
 */
export function serializeContact(
  row: ContactRow,
  summary?: MessagingSummary,
): ApiContact {
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
    hasReceivedMessage: summary?.hasReceivedMessage ?? false,
    hasReceivedEmail: summary?.hasReceivedEmail ?? false,
    hasReceivedSms: summary?.hasReceivedSms ?? false,
    hasOpenedEmail: summary?.hasOpenedEmail ?? false,
    hasClickedEmail: summary?.hasClickedEmail ?? false,
    lastMessageDate: summary?.lastMessageDate ?? '',
    customFields: customFieldsFromJson(row.customFields),
  };
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
  /** When true, runs the EmailEvent/SmsEvent aggregate join. */
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

  let summaries: Map<string, MessagingSummary> | null = null;
  if (opts.includeMessagingSummary && rows.length > 0) {
    summaries = await getMessagingSummaryForContacts(
      opts.accountKey,
      rows.map((row) => row.id),
    );
  }

  const contacts = rows.map((row) =>
    serializeContact(row, summaries?.get(row.id)),
  );

  return { contacts, total };
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

// ── Messaging summary materialiser ──

export interface MessagingSummary {
  hasReceivedMessage: boolean;
  hasReceivedEmail: boolean;
  hasReceivedSms: boolean;
  /** True when ANY past email to this contact recorded an `open`
   *  EmailEvent. Used by the flow builder's condition node to branch
   *  on whether a recipient has opened a prior send. */
  hasOpenedEmail: boolean;
  /** True when ANY past email to this contact recorded a `click`
   *  EmailEvent. The strongest engagement signal — especially when
   *  emails drive clicks to off-platform content (e.g. blog posts). */
  hasClickedEmail: boolean;
  lastMessageDate: string;
}

/**
 * For a given list of contactIds, aggregate EmailEvent + SmsEvent
 * to populate the messaging summary the filter UI uses. Joins go
 * through EmailCampaignRecipient / SmsCampaignRecipient because
 * events store the recipientId (snapshot), not contactId directly.
 *
 * Returns a Map keyed by contactId. Missing contacts mean "no
 * delivered messages on record" (default to false / empty in the
 * caller).
 */
export async function getMessagingSummaryForContacts(
  accountKey: string,
  contactIds: string[],
): Promise<Map<string, MessagingSummary>> {
  const out = new Map<string, MessagingSummary>();
  if (contactIds.length === 0) return out;

  // Look up email-delivered events for any recipient whose
  // contactId/accountKey matches. "Delivered" wins over "processed"
  // — we want a real signal that the contact actually got the
  // message, not just that we queued it.
  const emailRows = await prisma.emailCampaignRecipient.findMany({
    where: {
      accountKey,
      contactId: { in: contactIds },
      events: { some: { eventType: 'delivered' } },
    },
    select: {
      contactId: true,
      events: {
        where: { eventType: 'delivered' },
        select: { timestamp: true },
        orderBy: { timestamp: 'desc' },
        take: 1,
      },
    },
  });

  const smsRows = await prisma.smsCampaignRecipient.findMany({
    where: {
      accountKey,
      contactId: { in: contactIds },
      events: { some: { eventType: { in: ['sent', 'delivered'] } } },
    },
    select: {
      contactId: true,
      events: {
        where: { eventType: { in: ['sent', 'delivered'] } },
        select: { timestamp: true },
        orderBy: { timestamp: 'desc' },
        take: 1,
      },
    },
  });

  // Separate query for `open` events so we can flip `hasOpenedEmail`
  // on the summary. Same EmailCampaignRecipient join shape, just a
  // different event type filter.
  const openRows = await prisma.emailCampaignRecipient.findMany({
    where: {
      accountKey,
      contactId: { in: contactIds },
      events: { some: { eventType: 'open' } },
    },
    select: { contactId: true },
  });
  const openedIds = new Set(openRows.map((r) => r.contactId));

  // Same EmailCampaignRecipient join shape for `click` events so we can
  // flip `hasClickedEmail` — the engagement signal that survives Apple
  // Mail Privacy Protection (which auto-opens but never auto-clicks).
  const clickRows = await prisma.emailCampaignRecipient.findMany({
    where: {
      accountKey,
      contactId: { in: contactIds },
      events: { some: { eventType: 'click' } },
    },
    select: { contactId: true },
  });
  const clickedIds = new Set(clickRows.map((r) => r.contactId));

  for (const row of emailRows) {
    const last = row.events[0]?.timestamp;
    const current = out.get(row.contactId);
    out.set(row.contactId, {
      hasReceivedMessage: true,
      hasReceivedEmail: true,
      hasReceivedSms: current?.hasReceivedSms ?? false,
      hasOpenedEmail: current?.hasOpenedEmail ?? openedIds.has(row.contactId),
      hasClickedEmail: current?.hasClickedEmail ?? clickedIds.has(row.contactId),
      lastMessageDate: pickLatest(current?.lastMessageDate, last),
    });
  }

  for (const row of smsRows) {
    const last = row.events[0]?.timestamp;
    const current = out.get(row.contactId);
    out.set(row.contactId, {
      hasReceivedMessage: true,
      hasReceivedEmail: current?.hasReceivedEmail ?? false,
      hasReceivedSms: true,
      hasOpenedEmail: current?.hasOpenedEmail ?? false,
      hasClickedEmail: current?.hasClickedEmail ?? false,
      lastMessageDate: pickLatest(current?.lastMessageDate, last),
    });
  }

  return out;
}

function pickLatest(
  a: string | undefined,
  b: Date | null | undefined,
): string {
  const bIso = b ? b.toISOString() : '';
  if (!a) return bIso;
  if (!bIso) return a;
  return a > bIso ? a : bIso;
}
