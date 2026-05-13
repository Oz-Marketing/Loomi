import { prisma } from '@/lib/prisma';

export interface EspTemplateFolder {
  id: string;
  accountKey: string;
  name: string;
  parentId: string | null;
  /** GHL remote folder ID (set when synced from ESP) */
  remoteId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FolderRow {
  id: string;
  accountKey: string;
  name: string;
  parentId: string | null;
  remoteId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toFolder(row: FolderRow): EspTemplateFolder {
  return {
    id: row.id,
    accountKey: row.accountKey,
    name: row.name,
    parentId: row.parentId,
    remoteId: row.remoteId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getAccountFolders(accountKey: string): Promise<EspTemplateFolder[]> {
  const rows = await prisma.espTemplateFolder.findMany({
    where: { accountKey },
    orderBy: { name: 'asc' },
  });
  return rows.map(toFolder);
}

export async function getAccountAssignments(accountKey: string): Promise<Record<string, string>> {
  const rows = await prisma.espTemplate.findMany({
    where: { accountKey, folderId: { not: null } },
    select: { id: true, folderId: true },
  });
  const map: Record<string, string> = {};
  for (const r of rows) {
    if (r.folderId) map[r.id] = r.folderId;
  }
  return map;
}

export async function findFolderByRemoteId(
  accountKey: string,
  remoteId: string,
): Promise<EspTemplateFolder | null> {
  const row = await prisma.espTemplateFolder.findFirst({
    where: { accountKey, remoteId },
  });
  return row ? toFolder(row) : null;
}

export async function folderExistsForAccount(
  accountKey: string,
  folderId: string,
): Promise<boolean> {
  const count = await prisma.espTemplateFolder.count({
    where: { id: folderId, accountKey },
  });
  return count > 0;
}

export async function createAccountFolder(
  accountKey: string,
  name: string,
  parentId: string | null,
  remoteId?: string | null,
): Promise<EspTemplateFolder> {
  const row = await prisma.espTemplateFolder.create({
    data: {
      accountKey,
      name,
      parentId,
      remoteId: remoteId ?? null,
    },
  });
  return toFolder(row);
}

export async function updateAccountFolder(
  accountKey: string,
  folderId: string,
  updates: { name?: string; parentId?: string | null },
): Promise<EspTemplateFolder | null> {
  const existing = await prisma.espTemplateFolder.findFirst({
    where: { id: folderId, accountKey },
  });
  if (!existing) return null;

  const data: { name?: string; parentId?: string | null } = {};
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.parentId !== undefined) data.parentId = updates.parentId;

  const updated = await prisma.espTemplateFolder.update({
    where: { id: folderId },
    data,
  });
  return toFolder(updated);
}

/**
 * Delete a folder and all of its descendants for the given account. Any
 * EspTemplate rows whose folderId references a deleted folder get their
 * folderId set to null via the onDelete: SetNull relation in the schema.
 */
export async function deleteAccountFolder(
  accountKey: string,
  folderId: string,
): Promise<{ deletedIds: string[] }> {
  const root = await prisma.espTemplateFolder.findFirst({
    where: { id: folderId, accountKey },
    select: { id: true },
  });
  if (!root) return { deletedIds: [] };

  const allIds: string[] = [folderId];
  let frontier: string[] = [folderId];
  while (frontier.length > 0) {
    const children = await prisma.espTemplateFolder.findMany({
      where: { accountKey, parentId: { in: frontier } },
      select: { id: true },
    });
    const childIds = children.map((c) => c.id);
    if (childIds.length === 0) break;
    allIds.push(...childIds);
    frontier = childIds;
  }

  await prisma.espTemplateFolder.deleteMany({
    where: { id: { in: allIds } },
  });

  return { deletedIds: allIds };
}

export async function assignTemplatesToFolder(
  accountKey: string,
  templateIds: string[],
  folderId: string | null,
): Promise<Record<string, string>> {
  const filtered = templateIds.filter((id) => typeof id === 'string' && id.length > 0);
  if (filtered.length > 0) {
    await prisma.espTemplate.updateMany({
      where: { id: { in: filtered }, accountKey },
      data: { folderId },
    });
  }
  return getAccountAssignments(accountKey);
}
