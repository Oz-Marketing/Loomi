import { prisma } from '@/lib/prisma';

/**
 * Organization service — the parent grouping over sub-accounts.
 *
 * An Organization owns zero-or-more Accounts (rooftops) via
 * `Account.organizationId`. This module is the single place that resolves an
 * org to its child account keys, which powers both:
 *   - auth (an org grant expands to every child accountKey), and
 *   - Phase-1 aggregation (`where: { accountKey: { in: childKeys } }`).
 */

const ORG_ACCOUNT_SELECT = {
  key: true,
  slug: true,
  dealer: true,
} as const;

function orgSlugBase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Generate a unique kebab-case slug for an organization from its name. */
export async function generateUniqueOrgSlug(name: string): Promise<string> {
  let base = orgSlugBase(name);
  if (!base) base = 'organization';

  const existing = await prisma.organization.findUnique({
    where: { slug: base },
    select: { id: true },
  });
  if (!existing) return base;

  let counter = 2;
  for (;;) {
    const candidate = `${base}-${counter}`;
    const exists = await prisma.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
    counter++;
  }
}

/** All organizations, each with its child accounts (key/slug/dealer only). */
export async function getOrganizations() {
  return prisma.organization.findMany({
    orderBy: { name: 'asc' },
    include: { accounts: { select: ORG_ACCOUNT_SELECT, orderBy: { dealer: 'asc' } } },
  });
}

/** Organizations restricted to a set of org keys (for scoped users). */
export async function getOrganizationsByKeys(orgKeys: string[]) {
  if (orgKeys.length === 0) return [];
  return prisma.organization.findMany({
    where: { key: { in: orgKeys } },
    orderBy: { name: 'asc' },
    include: { accounts: { select: ORG_ACCOUNT_SELECT, orderBy: { dealer: 'asc' } } },
  });
}

export async function getOrganization(id: string) {
  return prisma.organization.findUnique({
    where: { id },
    include: { accounts: { select: ORG_ACCOUNT_SELECT, orderBy: { dealer: 'asc' } } },
  });
}

export async function getOrganizationByKey(key: string) {
  return prisma.organization.findUnique({
    where: { key },
    include: { accounts: { select: ORG_ACCOUNT_SELECT, orderBy: { dealer: 'asc' } } },
  });
}

export async function getOrganizationBySlug(slug: string) {
  return prisma.organization.findUnique({
    where: { slug },
    include: { accounts: { select: ORG_ACCOUNT_SELECT, orderBy: { dealer: 'asc' } } },
  });
}

export async function createOrganization(data: {
  key: string;
  name: string;
  slug?: string;
  logos?: string;
  branding?: string;
}) {
  const slug = data.slug || (await generateUniqueOrgSlug(data.name));
  return prisma.organization.create({ data: { ...data, slug } });
}

export async function updateOrganization(
  id: string,
  data: Partial<{
    name: string;
    slug: string;
    logos: string | null;
    branding: string | null;
    primaryAccountKey: string | null;
  }>,
) {
  return prisma.organization.update({ where: { id }, data });
}

export async function deleteOrganization(id: string) {
  // Account.organizationId is onDelete: SetNull, so child rooftops are
  // detached (not deleted) when the org is removed.
  return prisma.organization.delete({ where: { id } });
}

/**
 * Set the exact membership of an organization to `accountKeys`.
 * Accounts previously in the org but not in the list are detached; accounts
 * in the list are (re)attached, moving them from any prior org.
 */
export async function setOrganizationAccounts(orgId: string, accountKeys: string[]) {
  const result = await prisma.$transaction([
    // Detach rooftops that are no longer members.
    prisma.account.updateMany({
      where: { organizationId: orgId, key: { notIn: accountKeys } },
      data: { organizationId: null },
    }),
    // Attach the requested sub-accounts (idempotent; moves them from any other org).
    prisma.account.updateMany({
      where: { key: { in: accountKeys } },
      data: { organizationId: orgId },
    }),
  ]);
  // If the org's primary ("house") account was detached, clear the pointer so
  // it never dangles at a sub-account that no longer belongs to the org.
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { primaryAccountKey: true },
  });
  if (org?.primaryAccountKey && !accountKeys.includes(org.primaryAccountKey)) {
    await prisma.organization.update({
      where: { id: orgId },
      data: { primaryAccountKey: null },
    });
  }
  return result;
}

/**
 * Resolve a set of org keys to the flat list of their child account keys.
 * Used by auth to expand an org grant into per-account access.
 */
export async function resolveOrgAccountKeys(orgKeys: string[]): Promise<string[]> {
  if (orgKeys.length === 0) return [];
  const accounts = await prisma.account.findMany({
    where: { organization: { key: { in: orgKeys } } },
    select: { key: true },
  });
  return accounts.map((a) => a.key);
}

/** Child account keys for a single organization (by id). */
export async function getOrgChildKeys(orgId: string): Promise<string[]> {
  const accounts = await prisma.account.findMany({
    where: { organizationId: orgId },
    select: { key: true },
  });
  return accounts.map((a) => a.key);
}

/**
 * The account keys of the sibling rooftops that share an organization with
 * `accountKey` (EXCLUDING `accountKey` itself). Empty when the account has no
 * organization. Powers the org-wide suppression cascade so a manual opt-out at
 * one rooftop propagates to every other rooftop in the group.
 */
export async function getOrgSiblingAccountKeys(accountKey: string): Promise<string[]> {
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { organizationId: true },
  });
  if (!account?.organizationId) return [];
  const siblings = await prisma.account.findMany({
    where: { organizationId: account.organizationId, key: { not: accountKey } },
    select: { key: true },
  });
  return siblings.map((a) => a.key);
}
