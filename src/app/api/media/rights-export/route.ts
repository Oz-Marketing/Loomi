import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { canAccessAsset, isUnrestrictedAdmin } from '@/lib/services/media';
import { rightsExportCsv, rightsExportFilename } from '@/lib/media-rights-export';

/**
 * POST /api/media/rights-export
 *
 * A CSV of what's licensed, to whom, through when, and what has lapsed.
 *
 * Body (all optional):
 *   ids          export exactly these assets (the current selection)
 *   accountKey   'all' | a key | omitted for admin-level
 *   oem          a brand, or 'none' for brand-agnostic
 *   datedOnly    only assets that carry a licence or campaign date
 *
 * POST rather than GET because a selection can be hundreds of ids, which is
 * more than a query string should carry.
 *
 * Read-only by design — there is no import counterpart. Bulk edit covers the
 * write path, and OEM terms are uniform per programme, so a per-row editor
 * would solve variation this problem doesn't have.
 */

/** Bounded: the whole file is built in memory before it's sent. */
const MAX_ROWS = 5000;

export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => ({}));

  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((v: unknown): v is string => typeof v === 'string')
    : [];
  const accountKeyParam = typeof body?.accountKey === 'string' ? body.accountKey : undefined;
  const oem = typeof body?.oem === 'string' ? body.oem : undefined;
  const datedOnly = body?.datedOnly === true;

  const where: Record<string, unknown> = { archivedAt: null };

  if (ids.length > 0) {
    where.id = { in: ids.slice(0, MAX_ROWS) };
  } else {
    // Mirrors the library's own scope rules, so an export matches the view it
    // was taken from rather than quietly covering something wider.
    if (accountKeyParam === 'all') {
      if (!isUnrestrictedAdmin(session!)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    } else if (accountKeyParam) {
      if (!canAccessAsset(session!, accountKeyParam)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
      where.accountKey = accountKeyParam;
    } else {
      if (!canAccessAsset(session!, null)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
      where.accountKey = { equals: null };
    }

    if (oem) where.oem = oem === 'none' ? { equals: null } : oem;
  }

  // A rights review usually wants only what HAS terms; everything else is the
  // backlog, which is a different question the Unclassified facet answers.
  if (datedOnly) {
    where.OR = [{ licenseExpiresAt: { not: null } }, { expiresAt: { not: null } }];
  }

  const assets = await prisma.mediaAsset.findMany({
    where,
    // Soonest expiry first: the point of the sheet is what needs attention.
    orderBy: [{ licenseExpiresAt: 'asc' }, { filename: 'asc' }],
    take: MAX_ROWS,
  });

  // Filter by read access per asset — an id list can span scopes, and the
  // per-asset check is the only thing that catches it.
  const readable = assets.filter((a) => a.accountKey === null || canAccessAsset(session!, a.accountKey));

  if (readable.length === 0) {
    return NextResponse.json({ error: 'Nothing to export' }, { status: 404 });
  }

  // Leading BOM so Excel reads it as UTF-8 rather than mangling a dealer name
  // with an accent. Harmless everywhere else.
  const csv = `\uFEFF${rightsExportCsv(readable)}`;
  const filename = rightsExportFilename();

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Row-Count': String(readable.length),
      ...(readable.length >= MAX_ROWS ? { 'X-Truncated': 'true' } : {}),
    },
  });
}
