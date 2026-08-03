import { prisma } from '@/lib/prisma';
import type { MarketCheckIncentive } from '@/lib/integrations/marketcheck';
import {
  evaluateOfferCycle,
  observedLeadDays,
  type OfferCycleState,
  type RunWindow,
} from './offer-timing';
import { runWindowFor, type AutomationConfigRow } from './poll-offers';
import { selectOffer, type SelectableOfferType } from './select-offer';
import type { SkippedVehicle } from './skip-reasons';

/**
 * Shadow-mode reporting — everything the Phase 1 dashboard shows, read from the
 * tables the poll and sync jobs write.
 *
 * This is the surface that has to answer, before anything generates unattended:
 * is the offer feed noisy? how far ahead does each OEM actually publish? what
 * fraction of on-lot stock even has an advertisable programme? Those questions
 * are why Phase 1 exists, so they get first-class read models rather than being
 * inferred from logs.
 *
 * Server-only. Reads exclusively — this module never writes.
 */

function jsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function safeJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** The `skipped` entries out of a run's `detail`, defensively — the column is
 *  free-form JSON written by whichever build recorded the run. Capped so one bad
 *  run over a big feed can't bloat the report. */
function parseSkips(raw: unknown): SkippedVehicle[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is SkippedVehicle => {
      if (!s || typeof s !== 'object') return false;
      const r = s as Record<string, unknown>;
      return typeof r.vehicle === 'string' && typeof r.reason === 'string';
    })
    .slice(0, 20)
    .map((s) => ({ vehicle: s.vehicle, reason: s.reason, detail: typeof s.detail === 'string' ? s.detail : '' }));
}

function parseIncentive(payload: string): MarketCheckIncentive | null {
  try {
    return JSON.parse(payload) as MarketCheckIncentive;
  } catch {
    return null;
  }
}

export interface FeedStatus {
  id: string;
  name: string;
  url: string;
  storeCode: string | null;
  isActive: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncMessage: string | null;
  vehicleCount: number;
  newVehicleCount: number;
  /** Hours since the last successful sync — the staleness signal. */
  ageHours: number | null;
  /** True when the feed has never synced or is over a day old. */
  stale: boolean;
}

export interface WatchedVehicle {
  year: number;
  make: string;
  model: string;
  /** On-lot new units. 0 when inventory isn't loaded for this vehicle. */
  stock: number;
  liveOffers: number;
  endedOffers: number;
  cycleState: OfferCycleState | 'unwatched';
  cycleSummary: string;
  /** Distinct types among the live offers (`lease` | `apr` | `cash` | …). */
  offerTypes: string[];
  /** The type of the offer `wouldChoose` describes. */
  wouldChooseType: string | null;
  /** Latest end date across live offers (yyyy-mm-dd). */
  latestEnd: string | null;
  /** What the policy would pick today — recorded, never acted on in Phase 1. */
  wouldChoose: string | null;
  /** First time any offer for this vehicle was seen. */
  firstSeenAt: string | null;
}

export interface LeadTimeStat {
  make: string;
  median: number;
  min: number;
  max: number;
  n: number;
}

export interface GeneratedDraft {
  id: string;
  name: string;
  status: string;
  thumbnailUrl: string | null;
  /** Null means NO co-op pack was evaluated — a reviewer must be able to see that. */
  coopCheckedVersion: string | null;
  expiresAt: string | null;
  /** Non-blocking preflight/co-op findings recorded at generation time. */
  reviewNotes: string[];
  updatedAt: string;
}

export interface RunSummary {
  id: string;
  kind: string;
  startedAt: string;
  finishedAt: string | null;
  scopesChecked: number;
  offersSeen: number;
  offersNew: number;
  offersEnded: number;
  vehiclesSeen: number;
  issueCount: number;
  error: string | null;
  /** Why a generate run passed vehicles over — read back out of the run's own
   *  `detail`, which has recorded this since generation shipped. Without it the
   *  history could only say "1 skipped", which answers nothing. */
  skipped: SkippedVehicle[];
  /** How many ads the run produced, for runs that recorded it. */
  generatedCount: number | null;
}

export interface ShadowReport {
  accountKey: string;
  configured: boolean;
  enabled: boolean;
  /** The saved watch scope, so the UI can round-trip it without a second call. */
  scope: {
    makes: string[];
    focusModels: string[];
    excludeModels: string[];
    zip: string | null;
    /** offerType (or `all`) → template id. Generation refuses without a match. */
    templateMap: Record<string, string>;
    /** Size ids to render; empty = every size the template defines. */
    sizeIds: string[];
    radius: number;
    maxAdsPerRun: number;
    minStock: number;
    offerTypePriority: string[];
    /** draft | ready. `ready` still needs a verified co-op pack to take effect. */
    mode: string;
  };
  /** Published templates in scope, for the mapping dropdown. */
  templates: {
    id: string;
    name: string;
    owned: boolean;
    /** The sizes this template defines — what the size picker offers.
     *  Dimensions travel with them so the picker can show the aspect ratio,
     *  which is what someone choosing "Story vs Landscape" actually cares about. */
    sizes: { id: string; label: string; width: number; height: number }[];
  }[];
  /** Auto-generated drafts, newest first — the review queue. */
  drafts: GeneratedDraft[];
  runWindow: { start: string; end: string; mode: string };
  feeds: FeedStatus[];
  vehicles: WatchedVehicle[];
  leadTimes: LeadTimeStat[];
  runs: RunSummary[];
  totals: {
    newUnits: number;
    stockGroups: number;
    /** Stock groups with at least one live, usable offer. */
    groupsWithOffer: number;
    /** groupsWithOffer / stockGroups, as a percentage (0 when no stock). */
    matchRatePct: number;
    liveOffers: number;
    /** Groups whose OEM has let the cycle lapse without publishing the next. */
    awaitingNextCycle: number;
  };
}

const DAY_MS = 86_400_000;

function describeChoice(inc: MarketCheckIncentive): string {
  switch (inc.type) {
    case 'lease':
      return `$${Math.round(inc.payment)}/mo · ${inc.term}mo`;
    case 'apr':
      return `${inc.rate}% APR · ${inc.term}mo`;
    case 'cash':
      return `$${Math.round(inc.amount)} cash`;
    default:
      return inc.description || 'offer';
  }
}

/** Build the whole shadow report for one sub-account. */
export async function buildShadowReport(accountKey: string, now = new Date()): Promise<ShadowReport> {
  // ── config (absent is normal — a sub-account isn't watched until enabled) ──
  // The poll's row shape plus the template mapping, which only generation reads.
  let config:
    | (AutomationConfigRow & {
        templateMap: string | null;
        sizeIds: string | null;
        maxAdsPerRun: number;
        minStock: number;
        mode: string;
      })
    | null = null;
  try {
    config = await prisma.adAutomationConfig.findUnique({
      where: { accountKey },
      select: {
        accountKey: true,
        enabled: true,
        makes: true,
        focusModels: true,
        excludeModels: true,
        zip: true,
        radius: true,
        offerTypePriority: true,
        runWindowMode: true,
        rollingDays: true,
        templateMap: true,
        sizeIds: true,
        maxAdsPerRun: true,
        minStock: true,
        mode: true,
      },
    });
  } catch {
    config = null;
  }

  const windowMode = config?.runWindowMode ?? 'next_month';
  const window: RunWindow = runWindowFor(
    { runWindowMode: windowMode, rollingDays: config?.rollingDays ?? 30 },
    now,
  );
  const priority = jsonArray(config?.offerTypePriority ?? null).filter((t): t is SelectableOfferType =>
    ['lease', 'apr', 'cash'].includes(t),
  );

  // ── feeds + freshness ──
  const feedRows = await prisma.inventoryFeed
    .findMany({ where: { accountKey }, orderBy: { name: 'asc' } })
    .catch(() => []);
  const feeds: FeedStatus[] = feedRows.map((f) => {
    const ageHours = f.lastSyncedAt ? (now.getTime() - f.lastSyncedAt.getTime()) / 3_600_000 : null;
    return {
      id: f.id,
      name: f.name,
      url: f.url,
      storeCode: f.storeCode,
      isActive: f.isActive,
      lastSyncedAt: f.lastSyncedAt?.toISOString() ?? null,
      lastSyncStatus: f.lastSyncStatus,
      lastSyncMessage: f.lastSyncMessage,
      vehicleCount: f.vehicleCount,
      newVehicleCount: f.newVehicleCount,
      ageHours: ageHours == null ? null : Math.round(ageHours * 10) / 10,
      // Never synced, last sync errored, or over a day old — all mean "don't
      // trust this inventory".
      stale: !f.lastSyncedAt || f.lastSyncStatus !== 'ok' || (ageHours ?? 0) > 24,
    };
  });

  // ── on-lot new stock, grouped the way offers are advertised ──
  // Normalized to a plain shape immediately: leaving Prisma's groupBy union in
  // place (via a typed .catch fallback) makes downstream reduce/map inference
  // fail in confusing ways.
  let stockRows: { year: number; make: string; model: string; count: number }[] = [];
  try {
    const grouped = await prisma.inventoryVehicle.groupBy({
      by: ['year', 'make', 'model'],
      where: { accountKey, condition: 'new', soldAt: null },
      _count: { _all: true },
    });
    stockRows = grouped.map((r) => ({
      year: r.year,
      make: r.make,
      model: r.model,
      count: r._count._all,
    }));
  } catch {
    stockRows = [];
  }

  // ── offer snapshots ──
  const snapshots = await prisma.oemOfferSnapshot
    .findMany({ where: { accountKey }, orderBy: { firstSeenAt: 'asc' } })
    .catch(() => []);

  const keyOf = (year: number, make: string, model: string) =>
    `${year}|${make.toLowerCase()}|${model.toLowerCase()}`;

  // Union of "has stock" and "has offers on file" — a vehicle can have offers
  // recorded after its last unit sold, and stock can arrive before any offer.
  const groups = new Map<string, { year: number; make: string; model: string; stock: number }>();
  for (const s of stockRows) {
    groups.set(keyOf(s.year, s.make, s.model), {
      year: s.year,
      make: s.make,
      model: s.model,
      stock: s.count,
    });
  }
  for (const snap of snapshots) {
    const k = keyOf(snap.year, snap.make, snap.model);
    if (!groups.has(k)) {
      groups.set(k, { year: snap.year, make: snap.make, model: snap.model, stock: 0 });
    }
  }

  // Which scopes the most recent poll actually covered. Needed to tell
  // "we haven't looked at this vehicle" apart from "we looked and the OEM
  // publishes nothing for it" — both leave zero snapshot rows behind, but they
  // mean completely different things to someone deciding whether to trust the
  // match rate. Read from the run's detail rather than a new column, since the
  // poll already records a per-scope report for every scope including empty ones.
  const polledScopes = new Set<string>();
  try {
    const lastPoll = await prisma.adAutomationRun.findFirst({
      where: { accountKey, kind: 'offer_poll' },
      orderBy: { startedAt: 'desc' },
      select: { detail: true },
    });
    if (lastPoll?.detail) {
      const parsed = JSON.parse(lastPoll.detail) as {
        scopes?: { year: number; make: string; model: string }[];
      };
      for (const s of parsed.scopes ?? []) polledScopes.add(keyOf(s.year, s.make, s.model));
    }
  } catch {
    // No usable run detail — every vehicle without snapshots stays "never polled",
    // which is the honest fallback.
  }

  const vehicles: WatchedVehicle[] = [];
  let liveOffers = 0;
  let groupsWithOffer = 0;
  let awaitingNextCycle = 0;

  for (const [k, g] of [...groups.entries()].sort()) {
    const mine = snapshots.filter((s) => keyOf(s.year, s.make, s.model) === k);
    const live = mine.filter((s) => s.endedAt == null);
    const ended = mine.filter((s) => s.endedAt != null);
    liveOffers += live.length;

    const incentives = live.map((s) => parseIncentive(s.payload)).filter((i): i is MarketCheckIncentive => !!i);
    // Assess the cycle whenever we have EITHER offers on file or evidence the
    // last poll covered this vehicle. Zero offers after a real poll is the
    // meaningful 'none' state, not "unknown".
    const assessable = mine.length > 0 || polledScopes.has(k);
    const cycle = assessable ? evaluateOfferCycle(incentives, window) : null;
    const selection = incentives.length
      ? selectOffer(incentives, { runWindow: window, priority: priority.length ? priority : undefined, now })
      : null;

    if (selection?.chosen) groupsWithOffer++;
    if (cycle?.state === 'expiring_unrenewed') awaitingNextCycle++;

    const firstSeen = mine[0]?.firstSeenAt ?? null;
    vehicles.push({
      year: g.year,
      make: g.make,
      model: g.model,
      stock: g.stock,
      liveOffers: live.length,
      endedOffers: ended.length,
      cycleState: cycle?.state ?? 'unwatched',
      cycleSummary: cycle?.summary ?? 'Never polled — no offer history for this vehicle yet.',
      latestEnd: cycle?.latestEnd?.toISOString().slice(0, 10) ?? null,
      wouldChoose: selection?.chosen ? describeChoice(selection.chosen.incentive) : null,
      // The TYPE behind `wouldChoose`. The Generate dialog needs it to know when
      // its own type filter has invalidated that pick — excluding leases makes
      // "$299/mo" the wrong thing to promise for a vehicle that also has APR.
      wouldChooseType: selection?.chosen ? selection.chosen.incentive.type : null,
      // Which offer types are actually on file for this vehicle. The Generate
      // dialog filters its list by this, so narrowing to "lease only" shows the
      // vehicles that can really produce a lease ad rather than all of them.
      offerTypes: [...new Set(incentives.map((i) => i.type))].sort(),
      firstSeenAt: firstSeen?.toISOString() ?? null,
    });
  }

  // ── measured publication lead time, per make ──
  // The whole reason Phase 1 runs before Phase 3: Honda published ~6 weeks out
  // while Mazda and GM published only to month-end, so a hardcoded lead time
  // would have been wrong for two of three brands. This measures it instead.
  const byMake = new Map<string, { firstSeenAt: Date; endDate: string | null }[]>();
  for (const s of snapshots) {
    const list = byMake.get(s.make) ?? [];
    list.push({ firstSeenAt: s.firstSeenAt, endDate: s.endDate });
    byMake.set(s.make, list);
  }
  const leadTimes: LeadTimeStat[] = [];
  for (const [make, samples] of byMake) {
    const stat = observedLeadDays(samples);
    if (stat) leadTimes.push({ make, ...stat });
  }
  leadTimes.sort((a, b) => a.make.localeCompare(b.make));

  // ── run history (the heartbeat) ──
  const runRows = await prisma.adAutomationRun
    .findMany({ where: { OR: [{ accountKey }, { accountKey: null }] }, orderBy: { startedAt: 'desc' }, take: 15 })
    .catch(() => []);
  const runs: RunSummary[] = runRows.map((r) => {
    const detail = safeJson<{ skipped?: unknown; generated?: unknown }>(r.detail);
    return {
      id: r.id,
      kind: r.kind,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      scopesChecked: r.scopesChecked,
      offersSeen: r.offersSeen,
      offersNew: r.offersNew,
      offersEnded: r.offersEnded,
      vehiclesSeen: r.vehiclesSeen,
      issueCount: r.issueCount,
      error: r.error,
      skipped: parseSkips(detail?.skipped),
      generatedCount: Array.isArray(detail?.generated) ? detail.generated.length : null,
    };
  });

  // ── templates in scope + the auto-generated review queue ──
  const templateRows = await prisma.adTemplateDoc
    .findMany({
      where: { status: 'published', isActive: true, OR: [{ accountKey }, { accountKey: null }] },
      select: { id: true, name: true, accountKey: true, doc: true },
      orderBy: { updatedAt: 'desc' },
    })
    .catch(() => []);

  const draftRows = await prisma.adCreative
    .findMany({
      where: { accountKey, autoGenerated: true },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      select: {
        id: true, name: true, status: true, thumbnailUrl: true,
        coopCheckedVersion: true, expiresAt: true, reviewNotes: true, updatedAt: true,
      },
    })
    .catch(() => []);

  const stockGroups = stockRows.length;
  return {
    accountKey,
    configured: !!config,
    enabled: !!config?.enabled,
    scope: {
      makes: jsonArray(config?.makes ?? null),
      focusModels: jsonArray(config?.focusModels ?? null),
      excludeModels: jsonArray(config?.excludeModels ?? null),
      zip: config?.zip ?? null,
      sizeIds: (() => {
        try {
          const v = JSON.parse(config?.sizeIds ?? '[]');
          return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
        } catch {
          return [];
        }
      })(),
      templateMap: (() => {
        try {
          const v = JSON.parse(config?.templateMap ?? '{}');
          if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
          return Object.fromEntries(
            Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'),
          );
        } catch {
          return {};
        }
      })(),
      radius: config?.radius ?? 75,
      maxAdsPerRun: config?.maxAdsPerRun ?? 10,
      minStock: config?.minStock ?? 0,
      offerTypePriority: jsonArray(config?.offerTypePriority ?? null),
      mode: config?.mode ?? 'draft',
    },
    templates: templateRows.map((t) => ({
      id: t.id,
      name: t.name,
      owned: t.accountKey === accountKey,
      sizes: (() => {
        try {
          const d = JSON.parse(t.doc) as {
            sizes?: { id?: string; label?: string; width?: number; height?: number }[];
          };
          return (d.sizes ?? [])
            .filter((x): x is { id: string; label?: string; width?: number; height?: number } =>
              typeof x?.id === 'string',
            )
            .map((x) => ({
              id: x.id,
              label: x.label || x.id,
              width: Number(x.width) || 0,
              height: Number(x.height) || 0,
            }));
        } catch {
          return [];
        }
      })(),
    })),
    drafts: draftRows.map((d) => ({
      id: d.id,
      name: d.name,
      status: d.status,
      thumbnailUrl: d.thumbnailUrl,
      coopCheckedVersion: d.coopCheckedVersion,
      expiresAt: d.expiresAt?.toISOString() ?? null,
      reviewNotes: jsonArray(d.reviewNotes),
      updatedAt: d.updatedAt.toISOString(),
    })),
    runWindow: {
      start: window.start.toISOString().slice(0, 10),
      end: window.end.toISOString().slice(0, 10),
      mode: windowMode,
    },
    feeds,
    vehicles,
    leadTimes,
    runs,
    totals: {
      newUnits: stockRows.reduce((n, s) => n + s.count, 0),
      stockGroups,
      groupsWithOffer,
      matchRatePct: stockGroups === 0 ? 0 : Math.round((groupsWithOffer / stockGroups) * 100),
      liveOffers,
      awaitingNextCycle,
    },
  };
}

/** Hours since the most recent run of `kind`, or null if it has never run. */
export async function hoursSinceLastRun(kind: string, now = new Date()): Promise<number | null> {
  try {
    const last = await prisma.adAutomationRun.findFirst({
      where: { kind },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    });
    if (!last) return null;
    return Math.round(((now.getTime() - last.startedAt.getTime()) / DAY_MS) * 240) / 10;
  } catch {
    return null;
  }
}
