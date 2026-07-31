import { prisma } from '@/lib/prisma';

/**
 * OEM sales-event assets — the time-boxed campaign mark a manufacturer requires
 * on ads running inside an event window.
 *
 * This is a THIRD brand asset, distinct from the two we already handle:
 *   1. the dealer's co-branded lockup (`logoUrl`) — the brandmark, always present
 *   2. the vehicle image (`vehicleImageUrl`) — EVOX
 *   3. the event mark (`eventLogoUrl`) — present only during its window
 *
 * The window is the whole reason this can't be a template element or a config
 * field: the same template, run on 20 February and again on 20 March, must carry
 * different marks. So it's resolved per run, against the date the ad WILL RUN
 * rather than the date it was generated — preparing next month's flight has to
 * pick next month's event.
 *
 * Selection is deterministic (see pickActiveEvent) because the generate job is
 * idempotent: a retry that chose a different event would silently change an
 * approved ad's artwork.
 */

export interface EventAsset {
  id: string;
  make: string;
  name: string;
  logoUrl: string;
  effectiveFrom: Date;
  effectiveTo: Date;
  required: boolean;
  /** Offer types this event applies to. Empty = all. */
  offerTypes: string[];
}

function jsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Inclusive on both ends — an event that "ends 28 Feb" is valid ON 28 Feb. */
export function coversDate(asset: Pick<EventAsset, 'effectiveFrom' | 'effectiveTo'>, date: Date): boolean {
  const day = date.getTime();
  return day >= asset.effectiveFrom.getTime() && day <= asset.effectiveTo.getTime();
}

/**
 * Pick the one event that applies, from those on file for a make.
 *
 * Ordering, and why:
 *   1. In-window only.
 *   2. Applicable to this offer type — an event scoped to specific types beats a
 *      catch-all, because the narrower rule is the more deliberate one.
 *   3. The SHORTEST window wins. OEMs routinely run a brief holiday push inside a
 *      long seasonal campaign, and the specific short event is the one they expect
 *      on the ad.
 *   4. Latest start, then id — a total order, so a retry can never pick
 *      differently and mutate an already-approved creative.
 */
export function pickActiveEvent(
  assets: EventAsset[],
  runDate: Date,
  offerType: string,
): EventAsset | null {
  const applicable = assets.filter((a) => {
    if (!coversDate(a, runDate)) return false;
    if (a.offerTypes.length && !a.offerTypes.includes(offerType)) return false;
    return true;
  });
  if (applicable.length === 0) return null;

  const span = (a: EventAsset) => a.effectiveTo.getTime() - a.effectiveFrom.getTime();
  return [...applicable].sort((a, b) => {
    const scoped = (x: EventAsset) => (x.offerTypes.length ? 0 : 1);
    if (scoped(a) !== scoped(b)) return scoped(a) - scoped(b);
    if (span(a) !== span(b)) return span(a) - span(b);
    const start = b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
    if (start !== 0) return start;
    return a.id.localeCompare(b.id);
  })[0];
}

/**
 * The active event mark for a make on a run date, or null. Resilient: an
 * unmigrated or unreadable table degrades to "no event", which is the same as an
 * OEM not running one.
 */
export async function resolveEventAsset(
  make: string,
  runDate: Date,
  offerType: string,
): Promise<EventAsset | null> {
  if (!make.trim()) return null;
  try {
    const rows = await prisma.adOemEventAsset.findMany({
      where: {
        make: { equals: make.trim(), mode: 'insensitive' },
        isActive: true,
        effectiveFrom: { lte: runDate },
        effectiveTo: { gte: runDate },
      },
    });
    return pickActiveEvent(
      rows.map((r) => ({
        id: r.id,
        make: r.make,
        name: r.name,
        logoUrl: r.logoUrl,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo,
        required: r.required,
        offerTypes: jsonArray(r.offerTypes),
      })),
      runDate,
      offerType,
    );
  } catch (err) {
    console.warn('[event-assets] lookup failed, treating as no active event:', err);
    return null;
  }
}

/** Every event on file for a make, for the management UI and run logs. */
export async function listEventAssets(make?: string): Promise<EventAsset[]> {
  try {
    const rows = await prisma.adOemEventAsset.findMany({
      where: make ? { make: { equals: make.trim(), mode: 'insensitive' } } : {},
      orderBy: [{ make: 'asc' }, { effectiveFrom: 'desc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      make: r.make,
      name: r.name,
      logoUrl: r.logoUrl,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      required: r.required,
      offerTypes: jsonArray(r.offerTypes),
    }));
  } catch {
    return [];
  }
}
