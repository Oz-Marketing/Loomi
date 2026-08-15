import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { brandsOfAccountRow } from '@/lib/services/media';

/**
 * GET /api/media/oem-summary
 *
 * The brands that have — or could have — a shared asset library, with the two
 * numbers that make the OEM tier legible:
 *
 *   assetCount  how many shared assets the brand holds
 *   accountCount how many sub-accounts inherit them
 *
 * The second number is the point of the whole scope model. One Audi template
 * with six Audi rooftops is one row doing the work of six copies, and that ratio
 * is invisible unless something states it.
 *
 * Brands with NO assets are included when a sub-account carries them: an empty
 * Honda library is the actionable state ("nothing shared yet"), not an absence
 * worth hiding.
 *
 * Admin-only — it spans every account.
 */
export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { role, accountKeys = [] } = session!.user;
  const unrestricted =
    role === 'developer' || role === 'super_admin' || (role === 'admin' && accountKeys.length === 0);
  if (!unrestricted) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  // Shared assets only: accountKey null AND a brand set. An account-owned asset
  // that merely names its brand is descriptive, not shared, and counting it here
  // would overstate what the library actually holds centrally.
  const grouped = await prisma.mediaAsset
    .groupBy({
      by: ['oem'],
      where: { accountKey: { equals: null }, oem: { not: null }, archivedAt: null },
      _count: { _all: true },
    })
    .catch(() => [] as { oem: string | null; _count: { _all: number } }[]);

  const accounts = await prisma.account
    .findMany({ select: { key: true, oem: true, oems: true } })
    .catch(() => [] as { key: string; oem: string | null; oems: string | null }[]);

  // Internal bookkeeping accounts (leading underscore) aren't rooftops and would
  // inflate the inherit count.
  const realAccounts = accounts.filter((a) => !a.key.startsWith('_'));

  const accountCountByBrand = new Map<string, number>();
  for (const account of realAccounts) {
    for (const brand of brandsOfAccountRow(account)) {
      accountCountByBrand.set(brand, (accountCountByBrand.get(brand) ?? 0) + 1);
    }
  }

  const assetCountByBrand = new Map<string, number>();
  for (const row of grouped) {
    if (row.oem) assetCountByBrand.set(row.oem, row._count._all);
  }

  // Union: a brand shows up if it holds assets OR a rooftop carries it.
  const brands = [...new Set([...assetCountByBrand.keys(), ...accountCountByBrand.keys()])];

  const summary = brands
    .map((brand) => ({
      brand,
      assetCount: assetCountByBrand.get(brand) ?? 0,
      accountCount: accountCountByBrand.get(brand) ?? 0,
    }))
    // Brands holding assets first, then by reach, then alphabetically — so the
    // libraries that exist lead, and the biggest gap is next.
    .sort(
      (a, b) =>
        Number(b.assetCount > 0) - Number(a.assetCount > 0)
        || b.accountCount - a.accountCount
        || a.brand.localeCompare(b.brand),
    );

  const globalCount = await prisma.mediaAsset
    .count({ where: { accountKey: { equals: null }, oem: { equals: null }, archivedAt: null } })
    .catch(() => 0);

  return NextResponse.json({ brands: summary, globalCount });
}
