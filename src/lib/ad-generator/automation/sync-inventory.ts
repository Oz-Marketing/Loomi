import { prisma } from '@/lib/prisma';
import {
  DEFAULT_VLA_MAPPING,
  parseVlaFeed,
  type NormalizedVehicle,
  type ParsedFeed,
  type VlaFieldMapping,
} from './vla-feed';

/**
 * Inventory feed sync — pull each configured VLA feed, normalize, upsert.
 *
 * A feed is a weaker contract than an API: it can change shape, arrive
 * truncated, or go stale for a week without ever returning an error. So the
 * sync's job is as much about making staleness VISIBLE as about loading rows —
 * every attempt records its outcome on the feed, and vehicles that vanish are
 * marked sold rather than deleted.
 *
 * Server-only. Writes InventoryVehicle + InventoryFeed freshness; touches
 * nothing to do with creatives.
 */

const FETCH_TIMEOUT_MS = 30_000;
/**
 * Guard against a truncated or half-generated file. A feed that suddenly reports
 * a tiny fraction of its previous size is far more likely to be broken than to
 * reflect a dealer selling their whole lot overnight, and acting on it would
 * mark almost every car sold. Below this ratio we record the run and bail
 * without touching vehicle rows.
 */
const MIN_PLAUSIBLE_RATIO = 0.5;

export interface FeedSyncResult {
  feedId: string;
  name: string;
  status: 'ok' | 'error' | 'rejected';
  message: string;
  totalRows: number;
  vehicles: number;
  newVehicles: number;
  created: number;
  updated: number;
  markedSold: number;
  issues: string[];
  /** Mapped columns absent from the file — earliest signal of a schema change. */
  missingColumns: string[];
}

function parseMapping(raw: string | null): VlaFieldMapping {
  if (!raw) return DEFAULT_VLA_MAPPING;
  try {
    return { ...DEFAULT_VLA_MAPPING, ...(JSON.parse(raw) as Partial<VlaFieldMapping>) };
  } catch {
    return DEFAULT_VLA_MAPPING;
  }
}

/** Fetch a feed body. Throws with a useful message — the caller records it. */
export async function fetchFeedBody(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching feed`);
  const body = await res.text();
  if (!body.trim()) throw new Error('Feed returned an empty body');
  return body;
}

/** Round a nullable currency value for an Int column. */
function int(n: number | null): number | null {
  return n == null ? null : Math.round(n);
}

function vehicleData(v: NormalizedVehicle, accountKey: string) {
  return {
    accountKey,
    stockNumber: v.stockNumber || null,
    year: v.year,
    make: v.make,
    model: v.model,
    trim: v.trim || null,
    condition: v.condition,
    price: int(v.price),
    msrp: int(v.msrp),
    color: v.color || null,
    colorDetail: v.colorDetail || null,
    mileage: int(v.mileage),
    bodyStyle: v.bodyStyle || null,
    title: v.title || null,
    detailUrl: v.detailUrl || null,
    imageUrls: v.imageUrls.length ? JSON.stringify(v.imageUrls) : null,
  };
}

/**
 * Sync one feed. Never throws — a transport failure is recorded on the feed row
 * and returned, because one dead feed must not abort a sweep across the others.
 */
export async function syncInventoryFeed(feed: {
  id: string;
  accountKey: string;
  name: string;
  url: string;
  fieldMapping: string | null;
  vehicleCount: number;
}): Promise<FeedSyncResult> {
  const base: FeedSyncResult = {
    feedId: feed.id,
    name: feed.name,
    status: 'ok',
    message: '',
    totalRows: 0,
    vehicles: 0,
    newVehicles: 0,
    created: 0,
    updated: 0,
    markedSold: 0,
    issues: [],
    missingColumns: [],
  };

  let parsed: ParsedFeed;
  try {
    const body = await fetchFeedBody(feed.url);
    parsed = parseVlaFeed(body, parseMapping(feed.fieldMapping));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown fetch error';
    await recordFeedOutcome(feed.id, 'error', message);
    return { ...base, status: 'error', message };
  }

  base.totalRows = parsed.totalRows;
  base.vehicles = parsed.vehicles.length;
  base.newVehicles = parsed.vehicles.filter((v) => v.condition === 'new').length;
  base.issues = parsed.issues.slice(0, 50).map((i) => `row ${i.row}: ${i.reason}`);
  base.missingColumns = parsed.missingColumns;

  // Refuse an implausible collapse rather than marking the lot sold.
  if (
    feed.vehicleCount > 0 &&
    parsed.vehicles.length < Math.floor(feed.vehicleCount * MIN_PLAUSIBLE_RATIO)
  ) {
    const message = `Feed returned ${parsed.vehicles.length} vehicles, down from ${feed.vehicleCount} — treating as truncated and leaving inventory untouched.`;
    await recordFeedOutcome(feed.id, 'error', message);
    return { ...base, status: 'rejected', message };
  }

  if (parsed.missingColumns.length) {
    base.issues.unshift(`missing expected columns: ${parsed.missingColumns.join(', ')}`);
  }

  const now = new Date();
  for (const v of parsed.vehicles) {
    const data = vehicleData(v, feed.accountKey);
    const res = await prisma.inventoryVehicle.upsert({
      where: { feedId_vin: { feedId: feed.id, vin: v.vin } },
      create: { feedId: feed.id, vin: v.vin, ...data, firstSeenAt: now, lastSeenAt: now },
      // A VIN reappearing after being marked sold is a relist — clear soldAt.
      update: { ...data, lastSeenAt: now, soldAt: null },
    });
    if (res.firstSeenAt.getTime() === now.getTime()) base.created++;
    else base.updated++;
  }

  // Anything not in this pull has left the lot.
  const sold = await prisma.inventoryVehicle.updateMany({
    where: { feedId: feed.id, soldAt: null, lastSeenAt: { lt: now } },
    data: { soldAt: now },
  });
  base.markedSold = sold.count;

  base.message = `${base.vehicles} vehicles (${base.newVehicles} new), ${base.created} added, ${base.markedSold} marked sold`;
  await recordFeedOutcome(feed.id, 'ok', base.message, {
    vehicleCount: base.vehicles,
    newVehicleCount: base.newVehicles,
  });
  return base;
}

async function recordFeedOutcome(
  feedId: string,
  status: 'ok' | 'error',
  message: string,
  counts?: { vehicleCount: number; newVehicleCount: number },
): Promise<void> {
  try {
    await prisma.inventoryFeed.update({
      where: { id: feedId },
      data: {
        lastSyncedAt: new Date(),
        lastSyncStatus: status,
        lastSyncMessage: message.slice(0, 2000),
        ...(counts ?? {}),
      },
    });
  } catch (err) {
    console.warn('[sync-inventory] could not record feed outcome:', err);
  }
}

export interface InventorySweepResult {
  runId: string | null;
  feeds: FeedSyncResult[];
}

/**
 * Sync every active feed and write ONE AdAutomationRun for the sweep — including
 * when there was nothing to do. That heartbeat is the whole point: without it,
 * "no new ads" and "the sync died three weeks ago" are indistinguishable.
 */
export async function syncAllInventoryFeeds(accountKey?: string): Promise<InventorySweepResult> {
  const started = new Date();
  let feeds: {
    id: string;
    accountKey: string;
    name: string;
    url: string;
    fieldMapping: string | null;
    vehicleCount: number;
  }[] = [];
  try {
    feeds = await prisma.inventoryFeed.findMany({
      where: { isActive: true, ...(accountKey ? { accountKey } : {}) },
      select: { id: true, accountKey: true, name: true, url: true, fieldMapping: true, vehicleCount: true },
    });
  } catch (err) {
    console.warn('[sync-inventory] feed table unavailable (unmigrated?):', err);
    return { runId: null, feeds: [] };
  }

  const results: FeedSyncResult[] = [];
  for (const feed of feeds) results.push(await syncInventoryFeed(feed));

  let runId: string | null = null;
  try {
    const run = await prisma.adAutomationRun.create({
      data: {
        accountKey: accountKey ?? null,
        kind: 'feed_sync',
        startedAt: started,
        finishedAt: new Date(),
        scopesChecked: results.length,
        vehiclesSeen: results.reduce((n, r) => n + r.vehicles, 0),
        issueCount: results.reduce((n, r) => n + r.issues.length, 0),
        detail: JSON.stringify({ feeds: results }),
        error: results.some((r) => r.status !== 'ok')
          ? results
              .filter((r) => r.status !== 'ok')
              .map((r) => `${r.name}: ${r.message}`)
              .join(' | ')
              .slice(0, 2000)
          : null,
      },
    });
    runId = run.id;
  } catch (err) {
    console.warn('[sync-inventory] could not record run:', err);
  }

  return { runId, feeds: results };
}

/** Current on-lot NEW stock grouped by year/make/model, from the DB rather than
 *  a live feed pull — what the offer poll uses to decide what to watch. */
export async function currentNewStock(
  accountKey: string,
): Promise<{ year: number; make: string; model: string; count: number }[]> {
  try {
    const rows = await prisma.inventoryVehicle.groupBy({
      by: ['year', 'make', 'model'],
      where: { accountKey, condition: 'new', soldAt: null },
      _count: { _all: true },
    });
    return rows
      .map((r) => ({ year: r.year, make: r.make, model: r.model, count: r._count._all }))
      .sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model));
  } catch {
    return [];
  }
}
