import { prisma } from '@/lib/prisma';

export interface ListWithCount {
  id: string;
  name: string;
  description: string | null;
  accountKey: string;
  createdByUserId: string | null;
  createdByUserName: string | null;
  createdAt: Date;
  updatedAt: Date;
  memberCount: number;
}

// Resolve createdByUserId → user name in one extra query. We do it
// here (rather than via a Prisma relation) because ContactList has no
// direct `createdByUser` relation — createdByUserId is a loose pointer.
async function resolveCreatorNames(userIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

export async function getLists(accountKeys?: string[]): Promise<ListWithCount[]> {
  const where = accountKeys ? { accountKey: { in: accountKeys } } : undefined;

  const lists = await prisma.contactList.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }],
    include: {
      _count: { select: { memberships: true } },
    },
  });

  const creators = await resolveCreatorNames(lists.map((l) => l.createdByUserId));

  return lists.map((list) => ({
    id: list.id,
    name: list.name,
    description: list.description,
    accountKey: list.accountKey,
    createdByUserId: list.createdByUserId,
    createdByUserName: list.createdByUserId ? creators.get(list.createdByUserId) ?? null : null,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
    memberCount: list._count.memberships,
  }));
}

export async function getListById(
  id: string,
  accountKeys?: string[],
): Promise<ListWithCount | null> {
  const list = await prisma.contactList.findUnique({
    where: { id },
    include: { _count: { select: { memberships: true } } },
  });
  if (!list) return null;
  if (accountKeys && !accountKeys.includes(list.accountKey)) return null;
  const creators = await resolveCreatorNames([list.createdByUserId]);
  return {
    id: list.id,
    name: list.name,
    description: list.description,
    accountKey: list.accountKey,
    createdByUserId: list.createdByUserId,
    createdByUserName: list.createdByUserId ? creators.get(list.createdByUserId) ?? null : null,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
    memberCount: list._count.memberships,
  };
}

export async function createList(data: {
  name: string;
  description?: string | null;
  accountKey: string;
  createdByUserId?: string | null;
}) {
  return prisma.contactList.create({
    data: {
      name: data.name,
      description: data.description ?? null,
      accountKey: data.accountKey,
      createdByUserId: data.createdByUserId ?? null,
    },
  });
}

export async function updateList(
  id: string,
  data: { name?: string; description?: string | null },
) {
  return prisma.contactList.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
    },
  });
}

export async function deleteList(id: string) {
  return prisma.contactList.delete({ where: { id } });
}

/**
 * Bulk-attach contacts to a list. Ignores duplicates so it's safe to
 * call repeatedly (e.g. the same CSV re-uploaded). Returns the number
 * of new memberships created.
 */
export async function addContactsToList(
  listId: string,
  contactIds: string[],
): Promise<number> {
  if (contactIds.length === 0) return 0;
  const result = await prisma.contactListMembership.createMany({
    data: contactIds.map((contactId) => ({ listId, contactId })),
    skipDuplicates: true,
  });
  return result.count;
}
