import { prisma } from '@/lib/prisma';
import {
  ancestorKeys,
  expandWithDescendants,
  relatedKeys,
  type AccountEdge,
} from '@/lib/account-hierarchy';

const ACCOUNT_REP_SELECT = {
  id: true,
  name: true,
  title: true,
  email: true,
  avatarUrl: true,
} as const;

// ── Slug helpers ──

export function dealerToSlug(dealer: string): string {
  return dealer
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function generateUniqueSlug(dealer: string, city?: string | null): Promise<string> {
  let base = dealerToSlug(dealer);
  if (!base) base = 'account';

  const existing = await prisma.account.findUnique({ where: { slug: base }, select: { id: true } });
  if (!existing) return base;

  if (city) {
    const withCity = `${base}-${dealerToSlug(city)}`;
    const existsWithCity = await prisma.account.findUnique({ where: { slug: withCity }, select: { id: true } });
    if (!existsWithCity) return withCity;
  }

  let counter = 2;
  for (;;) {
    const candidate = `${base}-${counter}`;
    const exists = await prisma.account.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!exists) return candidate;
    counter++;
  }
}

export async function getAccountBySlug(slug: string) {
  return prisma.account.findUnique({
    where: { slug },
    include: { accountRep: { select: ACCOUNT_REP_SELECT } },
  });
}

/**
 * Internal account keys (e.g. `_customValueDefaults`) start with `_`.
 * NOTE: Do NOT use Prisma `startsWith('_')` to filter these — SQL LIKE treats
 * `_` as a single-character wildcard, so `NOT LIKE '_%'` excludes ALL rows.
 * Always filter in JS instead.
 */
const INTERNAL_KEY_PREFIX = '_';
function excludeInternal<T extends { key: string }>(accounts: T[]): T[] {
  return accounts.filter((a) => !a.key.startsWith(INTERNAL_KEY_PREFIX));
}

export async function getAccounts(userAccountKeys?: string[]) {
  if (userAccountKeys && userAccountKeys.length > 0) {
    const accounts = await prisma.account.findMany({
      where: { key: { in: userAccountKeys } },
      orderBy: { dealer: 'asc' },
      include: { accountRep: { select: ACCOUNT_REP_SELECT } },
    });
    return excludeInternal(accounts);
  }
  const accounts = await prisma.account.findMany({
    orderBy: { dealer: 'asc' },
    include: { accountRep: { select: ACCOUNT_REP_SELECT } },
  });
  return excludeInternal(accounts);
}

export async function getAccount(key: string) {
  return prisma.account.findUnique({
    where: { key },
    include: { accountRep: { select: ACCOUNT_REP_SELECT } },
  });
}

export async function createAccount(data: {
  key: string;
  dealer: string;
  slug?: string;
  category?: string;
  oem?: string;
  oems?: string;
  email?: string;
  phone?: string;
  salesPhone?: string;
  servicePhone?: string;
  partsPhone?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  website?: string;
  timezone?: string;
  logos?: string;
  branding?: string;
  customFonts?: string;
  customValues?: string;
  accountRepId?: string;
  // Parent account (group) this rooftop belongs to, when created as part of one.
  parentAccountKey?: string | null;
}) {
  const slug = data.slug || await generateUniqueSlug(data.dealer, data.city);
  return prisma.account.create({ data: { ...data, slug } });
}

export async function updateAccount(
  key: string,
  data: Partial<{
    dealer: string;
    category: string;
    oem: string;
    oems: string;
    email: string;
    phone: string;
    salesPhone: string;
    servicePhone: string;
    partsPhone: string;
    address: string;
    city: string;
    state: string;
    postalCode: string;
    website: string;
    timezone: string;
    logos: string;
    branding: string;
    customFonts: string;
    customValues: string;
    accountRepId: string | null;
    // Pacer markup rate override. `null` clears the override and the
    // Meta Ads Pacer calculator falls back to its global default.
    markup: number | null;
    // Loomi-native sending identity (Phase 1 of in-house send engine).
    // Empty string clears the override; sends then fall back to SMTP_FROM.
    senderEmail: string;
    senderName: string;
    sendingDomain: string;
    replyToEmail: string;
    // Ad-reporting per-account settings (ids + margins) + GoHighLevel PIT.
    // Margins are nullable Float (% markup); empty clears the override.
    metaAdAccountId: string;
    facebookAdsMargin: number | null;
    stackadaptAdvertiserId: string;
    stackadaptMargin: number | null;
    googleAdsCustomerId: string;
    googleAdsMargin: number | null;
    ghlApiKey: string;
    ghlLocationId: string;
  }>,
) {
  return prisma.account.update({ where: { key }, data });
}

export async function deleteAccount(key: string) {
  return prisma.account.delete({ where: { key } });
}

export async function getAllAccountKeys() {
  const accounts = await prisma.account.findMany({ select: { key: true } });
  return excludeInternal(accounts).map((a) => a.key);
}

/** The whole parent/child edge list — one query, reused by the walks below. */
function hierarchyEdges(): Promise<AccountEdge[]> {
  return prisma.account.findMany({ select: { key: true, parentAccountKey: true } });
}

/**
 * Expand account grants down the hierarchy: granting a group account (e.g.
 * `youngAutomotiveGroup`) implies access to every rooftop beneath it, so all
 * the existing accountKey-scoped queries keep working unchanged.
 *
 */
export async function expandAccountKeysWithDescendants(keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  return expandWithDescendants(await hierarchyEdges(), keys);
}

/**
 * The account's ancestors, nearest first — its parent, then grandparent, etc.
 *
 * Powers "author once, inherit down": a rooftop sees templates/forms/landing
 * pages owned by its group account — inheritance is simply
 * "mine + my ancestors'".
 */
export async function getAncestorAccountKeys(accountKey: string): Promise<string[]> {
  return ancestorKeys(await hierarchyEdges(), accountKey);
}

/**
 * Every OTHER account grouped with `accountKey` — the set a suppression must
 * cascade to, so an opt-out at one rooftop silences the whole group.
 *
 * See `relatedKeys` in `lib/account-hierarchy.ts` for why this is deliberately
 * wider than the roll-up set.
 */
export async function getRelatedAccountKeys(accountKey: string): Promise<string[]> {
  return relatedKeys(await hierarchyEdges(), accountKey);
}
