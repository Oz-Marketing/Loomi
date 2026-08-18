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
import { templatesForAccount } from '../template-access';
import { stockGate, stockGatePassed } from './inventory-match';
import { isV2Template } from '@/lib/email/types';
import { templateHasOffersMarker } from './offer-email-doc';
import {
  parseDefinition,
  detachedSteps,
  type CreativeDefinition,
  type CreativeStep,
} from '@/lib/playbooks/creative';

/**
 * The ad template a config renders from. `templateMap` is a per-offer-type map
 * whose `all` key is the only one the settings form writes today, so the
 * playbook comparison reads that one key rather than the whole map.
 */
function templateIdFor(templateMap: string | null): string {
  if (!templateMap) return '';
  try {
    const v = JSON.parse(templateMap) as Record<string, unknown>;
    return typeof v?.all === 'string' ? v.all : '';
  } catch {
    return '';
  }
}

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
    /** Whether the run also drafts the companion offer email. */
    emailEnabled: boolean;
    /** `Template.slug` of the v2 shell; null = compose from the brand kit. */
    emailTemplateId: string | null;
    /** `Audience` id the draft is pre-targeted at; null = no recipients. */
    emailAudienceId: string | null;
    emailMaxOffers: number;
    /** `Playbook.id` this account follows, or null for a hand-picked setup. */
    playbookId: string | null;
    /** One ad per qualifying offer type, rather than only the best. */
    expandOfferTypes: boolean;
  };
  /**
   * The followed playbook, resolved. `detached` names the steps this
   * account has diverged from — DERIVED by comparing the config to the
   * definition, never stored, so it can't go stale (docs/playbooks.md §5).
   */
  playbook: {
    id: string;
    name: string;
    version: number;
    definition: CreativeDefinition;
    detached: CreativeStep[];
  } | null;
  /** Published playbooks, definitions included so the picker can preset. */
  playbookOptions: {
    id: string;
    name: string;
    scopeValue: string | null;
    version: number;
    definition: CreativeDefinition;
  }[];
  /** v2 email templates on this account, as offer-email shell candidates. */
  emailTemplates: { slug: string; title: string; hasOffersBlock: boolean }[];
  /** Saved audiences, for pre-targeting the offer email draft. */
  audiences: { id: string; name: string }[];
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
    /**
     * The coverage chain, in the terms the automation actually works in:
     * VINs on the lot → distinct trims → model groups with a usable offer →
     * ads a run would produce.
     *
     * This is the "is it working" answer. Every other number here describes a
     * part; this describes the funnel, and a drop between any two links is a
     * specific, findable problem.
     */
    vins: number;
    trimGroups: number;
    /** Model groups that would produce an ad right now, after every gate. */
    adsThisRun: number;
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

/** Build the whole shadow report for one account. */
export async function buildShadowReport(accountKey: string, now = new Date()): Promise<ShadowReport> {
  // ── config (absent is normal — an account isn't watched until enabled) ──
  // The poll's row shape plus the template mapping, which only generation reads.
  let config:
    | (AutomationConfigRow & {
        templateMap: string | null;
        sizeIds: string | null;
        maxAdsPerRun: number;
        minStock: number;
        mode: string;
        emailEnabled: boolean;
        emailTemplateId: string | null;
        emailAudienceId: string | null;
        emailMaxOffers: number;
        playbookId: string | null;
        expandOfferTypes: boolean;
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
        emailEnabled: true,
        emailTemplateId: true,
        emailAudienceId: true,
        emailMaxOffers: true,
        playbookId: true,
        expandOfferTypes: true,
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
  // Grouped by TRIM as well as model, then folded back: the counts are still
  // per model (that's the unit an ad advertises), but the trim list rides along
  // so "would choose" can apply the same trim eligibility generation does.
  // Without it the panel would recommend an offer the run then refuses.
  let stockRows: { year: number; make: string; model: string; count: number; trims: (string | null)[] }[] = [];
  try {
    const groupedByTrim = await prisma.inventoryVehicle.groupBy({
      by: ['year', 'make', 'model', 'trim'],
      where: { accountKey, condition: 'new', soldAt: null },
      _count: { _all: true },
    });
    const byModel = new Map<string, { year: number; make: string; model: string; count: number; trims: (string | null)[] }>();
    for (const r of groupedByTrim) {
      const k = `${r.year}|${r.make.toLowerCase()}|${r.model.toLowerCase()}`;
      const hit = byModel.get(k) ?? { year: r.year, make: r.make, model: r.model, count: 0, trims: [] };
      hit.count += r._count._all;
      // One entry per VIN, matching what generation passes — a trim held by 20
      // units and one held by a single unit are equally "in stock".
      for (let i = 0; i < r._count._all; i += 1) hit.trims.push(r.trim);
      byModel.set(k, hit);
    }
    stockRows = [...byModel.values()].sort(
      (a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model),
    );
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
  const groups = new Map<
    string,
    { year: number; make: string; model: string; stock: number; trims: (string | null)[] }
  >();
  for (const s of stockRows) {
    groups.set(keyOf(s.year, s.make, s.model), {
      year: s.year,
      make: s.make,
      model: s.model,
      stock: s.count,
      trims: s.trims,
    });
  }
  for (const snap of snapshots) {
    const k = keyOf(snap.year, snap.make, snap.model);
    if (!groups.has(k)) {
      // Offers on file but nothing on the lot. An empty trim list means the trim
      // check can't judge, which is the right answer here — there is no stock to
      // judge against, and the stock gate refuses the vehicle anyway.
      groups.set(k, { year: snap.year, make: snap.make, model: snap.model, stock: 0, trims: [] });
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
      ? selectOffer(incentives, {
          runWindow: window,
          priority: priority.length ? priority : undefined,
          // Same trim eligibility generation applies, so "would choose" cannot
          // recommend an offer the run would then refuse.
          stockedTrims: g.trims,
          now,
        })
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
      // Shared-with counts as in scope; a shared global one no longer does.
      where: { status: 'published', isActive: true },
      select: { id: true, name: true, accountKey: true, sharedAccountKeys: true, doc: true },
      orderBy: { updatedAt: 'desc' },
    })
    .catch(() => []);

  // ── options for the companion-email settings ──
  //
  // Only v2 (visual) templates can be a shell, because the `{{offers}}` marker
  // is a block — a legacy HTML template has nowhere to put one. Filtering here
  // rather than in the dropdown means an unusable template is never offered.
  const emailTemplateRows = await prisma.template
    .findMany({
      where: { accountKey, type: 'design' },
      select: { slug: true, title: true, content: true },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    })
    .catch(() => []);

  // ── the followed playbook, and what this account has diverged from ──
  //
  // Both reads are unconditional so the picker always has its options, but the
  // detached-step comparison only means anything when a playbook is linked.
  const [playbookRow, playbookOptionRows] = await Promise.all([
    config?.playbookId
      ? prisma.playbook
          .findUnique({
            where: { id: config.playbookId },
            select: { id: true, name: true, version: true, definition: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
    prisma.playbook
      .findMany({
        where: { scope: 'creative', publishedAt: { not: null } },
        // The definition ships with every option, not just the followed one:
        // picking a playbook has to preset the fields IMMEDIATELY, and a client
        // that had to fetch it first would apply nothing until a save
        // round-tripped. The list is small and the payload is four fields.
        select: { id: true, name: true, scopeValue: true, version: true, definition: true },
        orderBy: { name: 'asc' },
      })
      .catch(() => []),
  ]);

  const audienceRows = await prisma.audience
    .findMany({
      where: { accountKey },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
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
      // Companion offer email. No `mode` counterpart on purpose — the email is
      // always drafted for a person to send.
      emailEnabled: !!config?.emailEnabled,
      emailTemplateId: config?.emailTemplateId ?? null,
      emailAudienceId: config?.emailAudienceId ?? null,
      emailMaxOffers: config?.emailMaxOffers ?? 6,
      playbookId: config?.playbookId ?? null,
      expandOfferTypes: !!config?.expandOfferTypes,
    },
    playbook: (() => {
      if (!playbookRow) return null;
      const definition = parseDefinition(playbookRow.definition);
      // The config columns are the truth; the definition is what they were
      // preset from. Anything that differs is a deliberate local override.
      const detached = detachedSteps(
        {
          adTemplateId: templateIdFor(config?.templateMap ?? null),
          sizeIds: jsonArray(config?.sizeIds ?? null),
          emailTemplateSlug: config?.emailTemplateId ?? '',
          emailMaxOffers: config?.emailMaxOffers ?? 6,
        },
        definition,
      );
      return {
        id: playbookRow.id,
        name: playbookRow.name,
        version: playbookRow.version,
        definition,
        detached,
      };
    })(),
    playbookOptions: playbookOptionRows.map((p) => ({
      id: p.id,
      name: p.name,
      scopeValue: p.scopeValue,
      version: p.version,
      definition: parseDefinition(p.definition),
    })),
    // Shell candidates for the offer email. `hasOffersBlock` is surfaced rather
    // than filtered on, so a template that's missing the marker can be shown as
    // unusable with a reason instead of silently vanishing from the list.
    emailTemplates: emailTemplateRows
      .filter((t) => isV2Template(t.content))
      .map((t) => ({
        slug: t.slug,
        title: t.title,
        hasOffersBlock: templateHasOffersMarker(t.content),
      })),
    audiences: audienceRows.map((a) => ({ id: a.id, name: a.name })),
    templates: templatesForAccount(templateRows, { accountKey }).map((t) => ({
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
      // One InventoryVehicle row IS one VIN.
      vins: stockRows.reduce((n, s) => n + s.count, 0),
      trimGroups: stockRows.reduce((n, s) => n + new Set(s.trims.map((t) => (t ?? '').toLowerCase())).size, 0),
      // Mirrors generation exactly by reusing its own gate rather than
      // re-deriving the rule — note `minStock: 0` means NOT ENFORCED, so a
      // vehicle with offers and no stock still counts.
      adsThisRun: Math.min(
        vehicles.filter(
          (v) => v.wouldChoose && stockGatePassed(stockGate(v.stock, config?.minStock ?? 0)),
        ).length,
        config?.maxAdsPerRun ?? 10,
      ),
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
