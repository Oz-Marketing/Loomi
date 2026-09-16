import { prisma } from '@/lib/prisma';
import { getAncestorAccountKeysForAll } from '@/lib/services/accounts';
import { segmentReadWhere } from '@/lib/segments/visibility';

/**
 * Segments these accounts may read.
 *
 * "Mine, plus platform-wide, plus anything a group ABOVE me shared down."
 * The scope rule itself lives in lib/segments/visibility.ts so the list
 * page and this query cannot disagree about who sees what.
 *
 * Omitting `accountKeys` returns every segment and is for privileged
 * callers only — see the role check in GET /api/audiences.
 */
export async function getAudiences(accountKeys?: string[]) {
  const where = accountKeys
    ? segmentReadWhere(accountKeys, await getAncestorAccountKeysForAll(accountKeys))
    : undefined;

  return prisma.audience.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function createAudience(data: {
  name: string;
  description?: string;
  accountKey?: string | null;
  sharedWithChildren?: boolean;
  createdByUserId?: string;
  filters: string;
  icon?: string;
  color?: string;
  sortOrder?: number;
}) {
  return prisma.audience.create({ data });
}

export async function getAudienceById(id: string) {
  return prisma.audience.findUnique({ where: { id } });
}

export async function updateAudience(
  id: string,
  data: {
    name?: string;
    description?: string | null;
    filters?: string;
    icon?: string | null;
    color?: string | null;
    sortOrder?: number;
    /** Re-sharing an existing segment down to the group's accounts. The
     *  owning `accountKey` is deliberately NOT updatable: moving a segment
     *  between accounts changes whose contacts it resolves against, which
     *  is a different segment, so the UI copies instead. */
    sharedWithChildren?: boolean;
  },
) {
  return prisma.audience.update({ where: { id }, data });
}

export async function deleteAudience(id: string) {
  return prisma.audience.delete({ where: { id } });
}
