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

/**
 * Resolve the account that should inherit an org's owned resources: the
 * account sharing the org's key (the group account under the new hierarchy),
 * else the designated primary/"house" account. Null when neither exists.
 */
async function resolveOrgOwnerAccountKey(org: {
  key: string;
  primaryAccountKey: string | null;
}): Promise<string | null> {
  const sameKey = await prisma.account.findUnique({
    where: { key: org.key },
    select: { key: true },
  });
  if (sameKey) return sameKey.key;
  if (org.primaryAccountKey) {
    const primary = await prisma.account.findUnique({
      where: { key: org.primaryAccountKey },
      select: { key: true },
    });
    if (primary) return primary.key;
  }
  return null;
}

export class OrganizationHasOwnedResourcesError extends Error {
  constructor(
    message: string,
    readonly counts: { templates: number; forms: number; landingPages: number; adTemplates: number },
  ) {
    super(message);
    this.name = 'OrganizationHasOwnedResourcesError';
  }
}

/**
 * Delete an organization, reassigning anything it owns first.
 *
 * Account.organizationId is onDelete: SetNull, so rooftops merely detach. But
 * Template / Form / LandingPage declare onDelete: **Cascade** — deleting the org
 * row would DESTROY every org-authored template, form and landing page. So we
 * hand those to the org's account (its same-key group account, else its house
 * account) inside one transaction before removing the org.
 *
 * If the org owns resources and no account can inherit them, we refuse rather
 * than either destroying them (cascade) or orphaning them into the shared Loomi
 * library (which would expose them to every account). Caller must reassign or
 * designate a primary account first.
 */
export async function deleteOrganization(id: string) {
  const org = await prisma.organization.findUnique({
    where: { id },
    select: { id: true, key: true, primaryAccountKey: true },
  });
  if (!org) return null;

  const [templates, forms, landingPages, adTemplates] = await Promise.all([
    prisma.template.count({ where: { organizationId: id } }),
    prisma.form.count({ where: { organizationId: id } }),
    prisma.landingPage.count({ where: { organizationId: id } }),
    prisma.adTemplateDoc.count({ where: { organizationId: id } }),
  ]);
  const owned = templates + forms + landingPages + adTemplates;

  if (owned === 0) {
    return prisma.organization.delete({ where: { id } });
  }

  const ownerKey = await resolveOrgOwnerAccountKey(org);
  if (!ownerKey) {
    throw new OrganizationHasOwnedResourcesError(
      `Organization "${org.key}" owns ${owned} resource(s) and has no account to inherit them. ` +
        'Designate a primary sub-account (or create an account with the org key), then delete again.',
      { templates, forms, landingPages, adTemplates },
    );
  }

  const reassign = { accountKey: ownerKey, organizationId: null };
  return prisma.$transaction(async (tx) => {
    await tx.template.updateMany({ where: { organizationId: id }, data: reassign });
    await tx.form.updateMany({ where: { organizationId: id }, data: reassign });
    await tx.landingPage.updateMany({ where: { organizationId: id }, data: reassign });
    await tx.adTemplateDoc.updateMany({ where: { organizationId: id }, data: reassign });
    return tx.organization.delete({ where: { id } });
  });
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
  return getRelatedAccountKeys(accountKey);
}

/**
 * Every OTHER account grouped with `accountKey` — the set a suppression must
 * cascade to, so an opt-out at one rooftop silences the whole group.
 *
 * Unions two groupings, because we're mid-migration from Organization to the
 * Account hierarchy and an account may be described by either (or both):
 *   - org membership   — same organizationId
 *   - account hierarchy — same tree: walk up to the root via parentAccountKey,
 *     then take every descendant of that root
 *
 * Note this is deliberately NOT the `self + descendants` set a roll-up view
 * uses. A rooftop's suppression must also reach its PARENT and its siblings,
 * not just accounts beneath it — under-propagating here is a compliance
 * failure, so we take the wider union.
 */
export async function getRelatedAccountKeys(accountKey: string): Promise<string[]> {
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { organizationId: true, parentAccountKey: true },
  });
  if (!account) return [];

  const related = new Set<string>();

  // 1) Legacy: same organization.
  if (account.organizationId) {
    const orgMembers = await prisma.account.findMany({
      where: { organizationId: account.organizationId },
      select: { key: true },
    });
    for (const a of orgMembers) related.add(a.key);
  }

  // 2) Hierarchy: find this account's root, then everything under it.
  const all = await prisma.account.findMany({
    select: { key: true, parentAccountKey: true },
  });
  const parentOf = new Map(all.map((a) => [a.key, a.parentAccountKey]));

  let root = accountKey;
  const climbed = new Set<string>([root]);
  for (;;) {
    const parent = parentOf.get(root) ?? null;
    if (!parent || climbed.has(parent)) break; // null parent, or a malformed cycle
    climbed.add(parent);
    root = parent;
  }

  if (root !== accountKey || all.some((a) => a.parentAccountKey === accountKey)) {
    const childrenOf = new Map<string, string[]>();
    for (const a of all) {
      if (!a.parentAccountKey) continue;
      const list = childrenOf.get(a.parentAccountKey) ?? [];
      list.push(a.key);
      childrenOf.set(a.parentAccountKey, list);
    }
    const stack = [root];
    const seen = new Set<string>();
    while (stack.length) {
      const key = stack.pop()!;
      if (seen.has(key)) continue;
      seen.add(key);
      related.add(key);
      for (const child of childrenOf.get(key) ?? []) stack.push(child);
    }
  }

  related.delete(accountKey);
  return [...related];
}
