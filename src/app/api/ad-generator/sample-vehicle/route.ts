/**
 * A REAL vehicle image for the builder canvas — /api/ad-generator/sample-vehicle
 *
 * An unfilled vehicle slot used to preview as a drawn silhouette, which told a
 * designer roughly nothing: the layout lives or dies on the proportions of an
 * actual jellybean. So preview with a real one, picked from this sub-account's own
 * on-lot stock, in the order production ads resolve imagery:
 *
 *   1. EVOX jellybean for a model the dealer actually has — the same transparent
 *      PNG a generated ad would carry.
 *   2. The dealer's own feed photo for that unit, which the generator already
 *      accepts for models EVOX has no licensed imagery for.
 *   3. An EVOX jellybean for a stock model of the sub-account's OEM. Needed because
 *      plenty of sub-accounts have no inventory feed attached yet, and those are
 *      exactly the ones opening the builder for the first time.
 *   4. Nothing, and the builder falls back to its drawn silhouette.
 *
 * PREVIEW ONLY. Nothing here is written to a template or an ad; the builder drops
 * the URL into canvas data, never into `doc`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, getAccountScope, canAccessAccount } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { evoxConfigured } from '@/lib/integrations/evox';
import { resolveJellybean } from '@/lib/integrations/evox-jellybean';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One well-covered model per make, for accounts with no inventory feed.
 *
 * High-volume nameplates, because EVOX coverage is per-model and the misses are on
 * the thin ones — there's no point sampling a trim nobody stocks. A make that isn't
 * here just falls through to the silhouette; that's a better outcome than guessing a
 * model and 404ing on every builder open.
 */
const SAMPLE_MODEL_BY_MAKE: Record<string, string> = {
  subaru: 'Crosstrek',
  chevrolet: 'Silverado 1500',
  gmc: 'Sierra 1500',
  buick: 'Encore GX',
  cadillac: 'XT5',
  ford: 'F-150',
  toyota: 'RAV4',
  honda: 'CR-V',
  nissan: 'Rogue',
  hyundai: 'Tucson',
  kia: 'Sportage',
  mazda: 'CX-5',
  volkswagen: 'Tiguan',
  jeep: 'Grand Cherokee',
  ram: '1500',
  dodge: 'Durango',
  chrysler: 'Pacifica',
  lincoln: 'Corsair',
  genesis: 'GV70',
  mitsubishi: 'Outlander',
  volvo: 'XC60',
  audi: 'Q5',
  bmw: 'X3',
  lexus: 'RX',
  acura: 'MDX',
  infiniti: 'QX60',
};

function firstPhoto(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    const url = v.find((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u));
    return url ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const accountKey = req.nextUrl.searchParams.get('accountKey')?.trim();
  if (!accountKey) return NextResponse.json({ vehicle: null });
  if (!canAccessAccount(getAccountScope(session), accountKey)) {
    return NextResponse.json({ vehicle: null });
  }

  try {
    // A new unit the dealer currently has: the most recently seen, so the sample
    // tracks what's actually on the lot rather than a stale row.
    const unit = await prisma.inventoryVehicle.findFirst({
      where: { accountKey, condition: 'new', soldAt: null },
      orderBy: { lastSeenAt: 'desc' },
      select: { year: true, make: true, model: true, colorDetail: true, color: true, imageUrls: true },
    });
    if (!unit) {
      return NextResponse.json({ vehicle: await sampleFromOem(accountKey) });
    }

    const label = `${unit.year} ${unit.make} ${unit.model}`;

    if (evoxConfigured()) {
      const jb = await resolveJellybean({
        year: unit.year,
        make: unit.make,
        model: unit.model,
        color: unit.colorDetail || unit.color || undefined,
      }).catch(() => null);
      if (jb?.url) {
        return NextResponse.json({ vehicle: { url: jb.url, label, source: 'evox' } });
      }
    }

    const photo = firstPhoto(unit.imageUrls);
    if (photo) return NextResponse.json({ vehicle: { url: photo, label, source: 'dealer_photo' } });

    return NextResponse.json({ vehicle: null });
  } catch (err) {
    // A sample image is a nicety — never let it break opening the builder.
    console.warn('[api/ad-generator/sample-vehicle] falling back to null:', err);
    return NextResponse.json({ vehicle: null });
  }
}

/** The OEM fallback: a stock model for this sub-account's brand. */
async function sampleFromOem(accountKey: string) {
  if (!evoxConfigured()) return null;
  const account = await prisma.account.findUnique({ where: { key: accountKey }, select: { oem: true } });
  const make = account?.oem?.trim();
  if (!make) return null;
  const model = SAMPLE_MODEL_BY_MAKE[make.toLowerCase()];
  if (!model) return null;
  // Last year's model year, which has full EVOX coverage all year round; the
  // current one can lag early in a cycle.
  const year = new Date().getFullYear() - 1;
  const jb = await resolveJellybean({ year, make, model }).catch(() => null);
  return jb?.url ? { url: jb.url, label: `${year} ${make} ${model}`, source: 'evox_oem' } : null;
}
