import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { buildAssetMetadata, canAccessAsset } from '@/lib/services/media';

/**
 * PATCH /api/media/bulk
 *
 * Apply the same metadata to many assets at once.
 *
 * Body: { ids: string[], ...metadata fields }
 *
 * ── Why this and not a spreadsheet round-trip ──
 *
 * The obvious alternative was export-to-Excel and re-import, which is what
 * enterprise DAMs offer. But a spreadsheet's advantage is per-ROW variation, and
 * the problem here doesn't have any: OEM licence terms are uniform per
 * programme ("Audi MY25 DAG, licensed through Aug 2027" covers all seventeen
 * files). Exporting forty rows to paste identical values down four columns is a
 * worse form, with a file format, a parser and partial-import failures attached.
 *
 * So: filter to the set, select it, apply once. The facets and collections are
 * what make selecting the right set precise.
 *
 * ── Blank means "leave alone", never "clear" ──
 *
 * Only fields present in the body are written. Mass-clearing is a footgun with
 * almost no legitimate use — losing licence dates across two hundred assets
 * because a field was left empty is not a mistake worth enabling — so clearing
 * stays a single-asset operation.
 */

/** Bounded so one request can't lock a large slice of the table. */
const MAX_IDS = 500;

export async function PATCH(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => ({}));

  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((v: unknown): v is string => typeof v === 'string')
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 });
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: `Too many assets in one edit (max ${MAX_IDS})` },
      { status: 400 },
    );
  }

  // Same validator the single-asset PATCH uses, so a value rejected there can't
  // slip in here. Undefined-vs-present is what makes the sparse semantics work.
  const metadataInput: Record<string, unknown> = {};
  for (const key of [
    'oem', 'assetSource', 'assetCategory', 'modelYear', 'vehicleModel', 'rightsHolder', 'tags',
    'licenseType', 'licenseRef', 'licenseStartsAt', 'licenseExpiresAt',
    'usageScope', 'territoryScope', 'exclusive', 'talentReleaseOnFile',
    'derivativesPermitted', 'sublicensingPermitted', 'expiresAt',
  ]) {
    if (key in body) metadataInput[key] = body[key];
  }

  if (Object.keys(metadataInput).length === 0) {
    return NextResponse.json({ error: 'No fields to apply' }, { status: 400 });
  }

  const result = buildAssetMetadata(metadataInput);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Drop anything that would clear a value. The form shouldn't send these, but
  // the rule belongs here too — a client bug must not blank two hundred rows.
  const data = Object.fromEntries(
    Object.entries(result.data).filter(([, v]) => v !== null && v !== undefined),
  );
  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: 'Nothing to apply — bulk edit sets values, it does not clear them.' },
      { status: 400 },
    );
  }

  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: ids } },
    select: { id: true, accountKey: true, filename: true },
  });

  // Access is per asset, not per request: a selection can span scopes, and an
  // admin-level asset needs rights an account grant doesn't confer.
  const allowed: string[] = [];
  const denied: string[] = [];
  for (const a of assets) {
    if (canAccessAsset(session!, a.accountKey)) allowed.push(a.id);
    else denied.push(a.filename);
  }

  if (allowed.length === 0) {
    return NextResponse.json({ error: 'You can’t edit any of the selected assets' }, { status: 403 });
  }

  // One query: the payload is identical for every asset, which is the whole
  // premise of the feature.
  const updated = await prisma.mediaAsset.updateMany({
    where: { id: { in: allowed } },
    data,
  });

  return NextResponse.json({
    updated: updated.count,
    // Named rather than counted: "2 skipped" leaves someone guessing which.
    skipped: denied,
    fields: Object.keys(data),
  });
}
