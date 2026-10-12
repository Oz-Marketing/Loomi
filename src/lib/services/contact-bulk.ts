import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { addContactsToList } from '@/lib/services/contact-lists';
import { getRelatedAccountKeys } from '@/lib/services/accounts';
import {
  OPT_OUT_SOURCE,
  clearStaffEmailOptOuts,
  clearStaffSmsOptOuts,
  normalizeOptOutEmail,
  normalizeOptOutPhone,
  readDndFlags,
  recordEmailOptOuts,
  recordSmsOptOuts,
  type SuppressionRowRef,
} from '@/lib/sending/opt-outs';

// Bulk operations for the contacts table. Every helper accepts the
// accountKey it should scope to and the list of contact IDs the
// caller is acting on; we re-filter to that accountKey on read so
// IDs from a different account can't leak through, even if the
// caller's selection state got out of sync with the URL.
//
// Returns { affected: N } so the API layer can surface a single
// success toast regardless of which action ran.

export interface BulkResult {
  affected: number;
  /**
   * "DND off" only: contacts left opted out on a channel because what holds
   * them there isn't staff's to clear — they unsubscribed themselves, their
   * address bounced, or the opt-out was imported.
   */
  stillOptedOut?: number;
}

async function fetchOwnedIds(accountKey: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.contact.findMany({
    where: { id: { in: ids }, accountKey },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export async function bulkAddToList(
  accountKey: string,
  ids: string[],
  listId: string,
): Promise<BulkResult> {
  // Make sure the list belongs to this account before attaching.
  const list = await prisma.contactList.findUnique({
    where: { id: listId },
    select: { accountKey: true },
  });
  if (!list || list.accountKey !== accountKey) {
    throw new Error('List does not belong to this account');
  }
  const ownedIds = await fetchOwnedIds(accountKey, ids);
  const affected = await addContactsToList(listId, ownedIds);
  return { affected };
}

export async function bulkRemoveFromList(
  accountKey: string,
  ids: string[],
  listId: string,
): Promise<BulkResult> {
  const list = await prisma.contactList.findUnique({
    where: { id: listId },
    select: { accountKey: true },
  });
  if (!list || list.accountKey !== accountKey) {
    throw new Error('List does not belong to this account');
  }
  const ownedIds = await fetchOwnedIds(accountKey, ids);
  if (ownedIds.length === 0) return { affected: 0 };
  const result = await prisma.contactListMembership.deleteMany({
    where: { listId, contactId: { in: ownedIds } },
  });
  return { affected: result.count };
}

function readTagsArray(raw: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === 'string');
}

export async function bulkAddTags(
  accountKey: string,
  ids: string[],
  tags: string[],
): Promise<BulkResult> {
  const cleanTags = tags.map((t) => t.trim()).filter(Boolean);
  if (cleanTags.length === 0 || ids.length === 0) return { affected: 0 };

  const rows = await prisma.contact.findMany({
    where: { id: { in: ids }, accountKey },
    select: { id: true, tags: true },
  });

  let affected = 0;
  await Promise.all(
    rows.map(async (row) => {
      const existing = readTagsArray(row.tags);
      const merged = Array.from(new Set([...existing, ...cleanTags]));
      // Skip writes that wouldn't change anything to avoid bumping updatedAt.
      if (merged.length === existing.length) return;
      await prisma.contact.update({
        where: { id: row.id },
        data: { tags: merged },
      });
      affected += 1;
    }),
  );
  return { affected };
}

export async function bulkRemoveTags(
  accountKey: string,
  ids: string[],
  tags: string[],
): Promise<BulkResult> {
  const cleanTags = new Set(tags.map((t) => t.trim()).filter(Boolean));
  if (cleanTags.size === 0 || ids.length === 0) return { affected: 0 };

  const rows = await prisma.contact.findMany({
    where: { id: { in: ids }, accountKey },
    select: { id: true, tags: true },
  });

  let affected = 0;
  await Promise.all(
    rows.map(async (row) => {
      const existing = readTagsArray(row.tags);
      const trimmed = existing.filter((t) => !cleanTags.has(t));
      if (trimmed.length === existing.length) return;
      await prisma.contact.update({
        where: { id: row.id },
        data: { tags: trimmed },
      });
      affected += 1;
    }),
  );
  return { affected };
}

export interface DndPatch {
  email?: boolean;
  sms?: boolean;
}

/**
 * Bulk "Set DND". The dnd flag alone used to be all this wrote — but the flag
 * is the UI's copy, honored only for that one contact. The suppression rows
 * are what every send path checks and what reaches the rest of the group, so
 * they're written first, and the flags follow.
 *
 * DND on  → a 'manual' opt-out for each contact's address, across the group.
 * DND off → clears only what staff may clear (see isStaffClearable). A
 *           contact who unsubscribed themselves, bounced, or came over in an
 *           import stays opted out, flag included, and is counted in
 *           `stillOptedOut` so the caller can say so.
 */
export async function bulkSetDnd(
  accountKey: string,
  ids: string[],
  patch: DndPatch,
): Promise<BulkResult> {
  if (ids.length === 0) return { affected: 0 };
  if (patch.email === undefined && patch.sms === undefined) return { affected: 0 };

  const rows = await prisma.contact.findMany({
    where: { id: { in: ids }, accountKey },
    select: { id: true, dnd: true, email: true, phone: true },
  });
  if (rows.length === 0) return { affected: 0 };

  // Suppression rows first. If the flag writes below fail part-way, everyone
  // the action was meant to opt out is already opted out where it counts.
  const shared = { accountKey, relatedAccountKeys: await getRelatedAccountKeys(accountKey) };
  const emails = rows.map((r) => r.email);
  const phones = rows.map((r) => r.phone);
  let heldEmails = new Set<string>();
  let heldPhones = new Set<string>();

  if (patch.email === true) {
    await recordEmailOptOuts({ ...shared, emails, reason: 'manual', source: OPT_OUT_SOURCE.manual });
  } else if (patch.email === false) {
    const cleared = await clearStaffEmailOptOuts({ ...shared, emails });
    heldEmails = heldAt(accountKey, cleared.remaining, normalizeOptOutEmail);
  }
  if (patch.sms === true) {
    await recordSmsOptOuts({ ...shared, phones, reason: 'manual', source: OPT_OUT_SOURCE.manual });
  } else if (patch.sms === false) {
    const cleared = await clearStaffSmsOptOuts({ ...shared, phones });
    heldPhones = heldAt(accountKey, cleared.remaining, normalizeOptOutPhone);
  }

  let affected = 0;
  let stillOptedOut = 0;
  await Promise.all(
    rows.map(async (row) => {
      const existing = readDndFlags(row.dnd);
      const next = { ...existing };
      let held = false;
      if (patch.email !== undefined) {
        const keep = !patch.email && isHeld(heldEmails, row.email, normalizeOptOutEmail);
        next.email = patch.email || keep;
        held ||= keep;
      }
      if (patch.sms !== undefined) {
        const keep = !patch.sms && isHeld(heldPhones, row.phone, normalizeOptOutPhone);
        next.sms = patch.sms || keep;
        held ||= keep;
      }
      if (held) stillOptedOut += 1;
      // Skip when state already matches the patch.
      if (next.email === existing.email && next.sms === existing.sms) return;
      await prisma.contact.update({
        where: { id: row.id },
        data: { dnd: Object.keys(next).length > 0 ? next : Prisma.DbNull },
      });
      affected += 1;
    }),
  );
  return { affected, ...(stillOptedOut > 0 ? { stillOptedOut } : {}) };
}

/** The addresses still suppressed at this account, normalized for lookup. */
function heldAt(
  accountKey: string,
  remaining: SuppressionRowRef[],
  normalize: (raw: string) => string | null,
): Set<string> {
  const out = new Set<string>();
  for (const row of remaining) {
    if (row.accountKey !== accountKey) continue;
    const key = normalize(row.address);
    if (key) out.add(key);
  }
  return out;
}

function isHeld(
  held: Set<string>,
  address: string | null,
  normalize: (raw: string) => string | null,
): boolean {
  if (!address || held.size === 0) return false;
  const key = normalize(address);
  return key !== null && held.has(key);
}

export async function bulkDelete(accountKey: string, ids: string[]): Promise<BulkResult> {
  if (ids.length === 0) return { affected: 0 };
  const result = await prisma.contact.deleteMany({
    where: { id: { in: ids }, accountKey },
  });
  return { affected: result.count };
}
