/**
 * Per-account launch preset — /api/ad-generator/launch-presets/[accountKey]
 *
 * GET  ?platform=meta → the saved preset, or the defaults when none is saved (so a
 *                       caller always has a usable shape and never has to
 *                       reimplement the fallback).
 * PUT  ?platform=meta → upsert.
 *
 * `specialAdCategories` is NOT writable. Meta's financial-products restriction is
 * a consequence of what the ad says, not a preference, so it is derived per launch
 * (see specialAdCategoriesFor). Accepting it here would let someone switch off a
 * restriction the platform applies anyway.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, getAccountScope, canAccessAccount, forbidden, requireRole } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { PRESET_DEFAULTS } from '@/lib/ad-generator/launch-preset';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PLATFORMS = new Set(['meta', 'google']);

function platformOf(req: NextRequest): string | null {
  const p = (req.nextUrl.searchParams.get('platform') || 'meta').trim().toLowerCase();
  return PLATFORMS.has(p) ? p : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ accountKey: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { accountKey } = await params;
  if (!canAccessAccount(getAccountScope(session), accountKey)) return forbidden();
  const platform = platformOf(req);
  if (!platform) return NextResponse.json({ error: 'Unknown platform' }, { status: 400 });

  try {
    const row = await prisma.adLaunchPreset.findUnique({
      where: { accountKey_platform: { accountKey, platform } },
    });
    // `saved: false` matters to the UI: it's the difference between "these are the
    // defaults, nobody has configured this" and "someone chose exactly this".
    return NextResponse.json({
      preset: row ?? { accountKey, platform, ...PRESET_DEFAULTS },
      saved: !!row,
    });
  } catch (err) {
    console.warn('[api/ad-generator/launch-presets] falling back to defaults:', err);
    return NextResponse.json({ preset: { accountKey, platform, ...PRESET_DEFAULTS }, saved: false });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ accountKey: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { accountKey } = await params;
  if (!canAccessAccount(getAccountScope(session), accountKey)) return forbidden();
  const platform = platformOf(req);
  if (!platform) return NextResponse.json({ error: 'Unknown platform' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const str = (k: string): string | null | undefined => {
    if (!(k in body)) return undefined;
    const v = body[k];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const num = (k: string, min: number, max: number): number | undefined => {
    if (!(k in body)) return undefined;
    const n = Number(body[k]);
    if (!Number.isFinite(n)) return undefined;
    return Math.min(max, Math.max(min, Math.round(n)));
  };

  const data: Record<string, unknown> = {};
  const objective = str('objective');
  if (objective !== undefined) data.objective = objective ?? PRESET_DEFAULTS.objective;
  for (const k of [
    'bidStrategy',
    'dailyBudget',
    'geoZip',
    'audienceSpec',
    'urlTemplate',
    'lpTemplateId',
    'lpFormId',
    'utmSource',
    'utmMedium',
    'utmCampaign',
  ]) {
    const v = str(k);
    if (v !== undefined) data[k] = v;
  }
  const destinationMode = str('destinationMode');
  if (destinationMode !== undefined) {
    // Only dealer_site is implemented; the Loomi-hosted destination is Phase D.
    // Accepting the other values now would let a preset promise a page that
    // doesn't exist yet.
    if (destinationMode && destinationMode !== 'dealer_site') {
      return NextResponse.json(
        { error: `destinationMode "${destinationMode}" is not available yet — only dealer_site is implemented.` },
        { status: 400 },
      );
    }
    data.destinationMode = destinationMode ?? 'dealer_site';
  }
  const flightDays = num('flightDays', 1, 365);
  if (flightDays !== undefined) data.flightDays = flightDays;
  // Not floored at 15 here on purpose: the floor depends on the AD (whether it
  // advertises credit), so it's applied at resolve time and explained there. A
  // preset for non-financing ads may legitimately be tighter.
  const geoRadiusMiles = num('geoRadiusMiles', 1, 500);
  if (geoRadiusMiles !== undefined) data.geoRadiusMiles = geoRadiusMiles;
  if ('sizeIds' in body) {
    const ids = Array.isArray(body.sizeIds)
      ? body.sizeIds.filter((x): x is string => typeof x === 'string' && !!x.trim())
      : [];
    data.sizeIds = ids.length ? JSON.stringify(ids) : null;
  }

  try {
    const row = await prisma.adLaunchPreset.upsert({
      where: { accountKey_platform: { accountKey, platform } },
      create: { accountKey, platform, ...PRESET_DEFAULTS, ...data },
      update: data,
    });
    return NextResponse.json({ preset: row, saved: true });
  } catch (err) {
    console.error('[api/ad-generator/launch-presets] save failed:', err);
    return NextResponse.json(
      { error: 'Could not save — has the table been pushed in this environment?' },
      { status: 500 },
    );
  }
}
