import { prisma } from '@/lib/prisma';

const emailListSelect = {
  id: true,
  accountKey: true,
  templateId: true,
  name: true,
  status: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  template: { select: { slug: true, title: true, type: true } },
  account: { select: { key: true, dealer: true } },
  folder: { select: { id: true, name: true } },
} as const;

/** Status filter for email listing — same vocabulary as flows so the
 *  shared StatusFilter UI works for both. `draft` matches the only
 *  non-active non-archived state today; kept as its own filter for
 *  symmetry with flows. */
export type EmailStatusFilter = 'all' | 'draft' | 'published' | 'archived';

function emailStatusWhere(
  filter: EmailStatusFilter | undefined,
  includeArchivedLegacy?: boolean,
): Record<string, unknown> {
  if (filter) {
    switch (filter) {
      case 'draft':
        return { status: 'draft' };
      case 'published':
        return { status: 'active' };
      case 'archived':
        return { status: 'archived' };
      case 'all':
      default:
        return { status: { not: 'archived' } };
    }
  }
  return includeArchivedLegacy ? {} : { status: { not: 'archived' } };
}

interface EmailListOptions {
  /** New: explicit status filter — preferred over includeArchived. */
  statusFilter?: EmailStatusFilter;
  /** Legacy: when true, archived rows ride along. Ignored if
   *  statusFilter is set. */
  includeArchived?: boolean;
}

export async function getAccountEmails(
  accountKey: string,
  options?: EmailListOptions,
) {
  return prisma.accountEmail.findMany({
    where: {
      accountKey,
      ...emailStatusWhere(options?.statusFilter, options?.includeArchived),
    },
    select: emailListSelect,
    orderBy: { updatedAt: 'desc' },
  });
}

export async function getAllEmails(options?: EmailListOptions) {
  return prisma.accountEmail.findMany({
    where: emailStatusWhere(options?.statusFilter, options?.includeArchived),
    select: emailListSelect,
    orderBy: { updatedAt: 'desc' },
  });
}

export async function getEmailsForAccounts(
  accountKeys: string[],
  options?: EmailListOptions,
) {
  return prisma.accountEmail.findMany({
    where: {
      accountKey: { in: accountKeys },
      ...emailStatusWhere(options?.statusFilter, options?.includeArchived),
    },
    select: emailListSelect,
    orderBy: { updatedAt: 'desc' },
  });
}

export async function getAccountEmail(id: string) {
  return prisma.accountEmail.findUnique({
    where: { id },
    include: {
      template: true,
      account: true,
    },
  });
}

export async function createAccountEmail(data: {
  accountKey: string;
  templateId: string;
  name: string;
  content?: string;
  status?: string;
  folderId?: string;
}) {
  return prisma.accountEmail.create({ data });
}

export async function updateAccountEmail(
  id: string,
  data: Partial<{
    name: string;
    content: string | null;
    status: string;
    folderId: string | null;
  }>,
) {
  // Stamp archivedAt when the row transitions into the archived state
  // so the 30-day purge job has a stable reference. Clear it when the
  // row is un-archived so a future re-archive starts a fresh clock.
  const archivedAtPatch =
    data.status === 'archived'
      ? { archivedAt: new Date() }
      : data.status && data.status !== 'archived'
        ? { archivedAt: null }
        : {};
  return prisma.accountEmail.update({
    where: { id },
    data: { ...data, ...archivedAtPatch },
  });
}

export async function deleteAccountEmail(id: string) {
  return prisma.accountEmail.delete({ where: { id } });
}

// Hard-delete archived emails whose archivedAt is older than the
// retention window. Invoked by the daily purge job in the worker.
// Returns the number of rows removed for logging.
export async function purgeOldArchivedEmails(
  retentionDays = 30,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.accountEmail.deleteMany({
    where: {
      status: 'archived',
      archivedAt: { not: null, lt: cutoff },
    },
  });
  return result.count;
}
