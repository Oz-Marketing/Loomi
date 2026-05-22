import { prisma } from '@/lib/prisma';

export async function getAudiences(accountKeys?: string[]) {
  const where = accountKeys
    ? { OR: [{ accountKey: null }, { accountKey: { in: accountKeys } }] }
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
  },
) {
  return prisma.audience.update({ where: { id }, data });
}

export async function deleteAudience(id: string) {
  return prisma.audience.delete({ where: { id } });
}
