import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAncestorAccountKeysForAll } from '@/lib/services/accounts';
import { segmentReadWhere } from '@/lib/segments/visibility';
import type { FanOutResult } from '@/lib/segments/fan-out';

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

/**
 * Create the same definition in several accounts, one row per account.
 *
 * WHY COPIES RATHER THAN ONE SHARED ROW. Sharing a group's segment DOWN to
 * the accounts beneath it is the better answer whenever the accounts have a
 * group in common — one row, one edit, and `sharedWithChildren` already does
 * it. This is for the case that cannot reach: accounts with no common parent,
 * where there is no group to own the shared row, and the case where each
 * account genuinely needs its own editable version rather than a read-only
 * copy of someone else's.
 *
 * Sequential, non-transactional, and collecting per-account failures — the
 * same shape as deployFormTemplateToAccounts, deployFlowToAccounts and
 * deployBlueprintToAccounts. The caller is expected to have run the
 * pre-flight checks (scope, per-account validation, name clashes) so that by
 * the time we get here a failure is a race, not a foreseeable refusal.
 */
export async function createAudienceAcrossAccounts(input: {
  name: string;
  description?: string;
  filters: string;
  accountKeys: string[];
  createdByUserId?: string;
  icon?: string;
  color?: string;
}): Promise<FanOutResult> {
  const created: FanOutResult['created'] = [];
  const failures: FanOutResult['failures'] = [];

  // De-dupe defensively: two rows for one account would collide on
  // (name, accountKey) and report the second as a mysterious failure.
  for (const accountKey of [...new Set(input.accountKeys)]) {
    try {
      const audience = await createAudience({
        name: input.name,
        description: input.description,
        accountKey,
        createdByUserId: input.createdByUserId,
        filters: input.filters,
        icon: input.icon,
        color: input.color,
      });
      created.push({ accountKey, id: audience.id });
    } catch (err) {
      // A name collision is the one failure a user can act on, so say so
      // rather than letting it reach them as a generic 500 with a trace id.
      const isDuplicate =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
      failures.push({
        accountKey,
        error: isDuplicate
          ? 'A segment with that name already exists here'
          : 'Could not create the segment',
      });
    }
  }

  return { created, failures };
}
