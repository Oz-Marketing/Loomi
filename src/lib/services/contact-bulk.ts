import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { addContactsToList } from '@/lib/services/contact-lists';

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

function readDndObject(raw: Prisma.JsonValue | null | undefined): { email?: boolean; sms?: boolean } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const out: { email?: boolean; sms?: boolean } = {};
  if (typeof obj.email === 'boolean') out.email = obj.email;
  if (typeof obj.sms === 'boolean') out.sms = obj.sms;
  return out;
}

export async function bulkSetDnd(
  accountKey: string,
  ids: string[],
  patch: DndPatch,
): Promise<BulkResult> {
  if (ids.length === 0) return { affected: 0 };
  if (patch.email === undefined && patch.sms === undefined) return { affected: 0 };

  const rows = await prisma.contact.findMany({
    where: { id: { in: ids }, accountKey },
    select: { id: true, dnd: true },
  });

  let affected = 0;
  await Promise.all(
    rows.map(async (row) => {
      const existing = readDndObject(row.dnd);
      const next = { ...existing };
      if (patch.email !== undefined) next.email = patch.email;
      if (patch.sms !== undefined) next.sms = patch.sms;
      // Skip when state already matches the patch.
      if (next.email === existing.email && next.sms === existing.sms) return;
      await prisma.contact.update({
        where: { id: row.id },
        data: { dnd: Object.keys(next).length > 0 ? next : Prisma.DbNull },
      });
      affected += 1;
    }),
  );
  return { affected };
}

export async function bulkDelete(accountKey: string, ids: string[]): Promise<BulkResult> {
  if (ids.length === 0) return { affected: 0 };
  const result = await prisma.contact.deleteMany({
    where: { id: { in: ids }, accountKey },
  });
  return { affected: result.count };
}
