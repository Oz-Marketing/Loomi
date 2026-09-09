import { prisma } from '@/lib/prisma';
import { anthropicConfigured } from '@/lib/anthropic';
import { generateAdCopy } from '@/lib/ai/ad-copy';
import { evoxConfigured } from '@/lib/integrations/evox';
import { resolveJellybean } from '@/lib/integrations/evox-jellybean';
import type { MarketCheckIncentive } from '@/lib/integrations/marketcheck';
import { createNotification } from '@/lib/notifications/service';
import { brandLogoData } from '../brand-logos';
import { LIVE_TEMPLATE, templatesForAccount } from '../template-access';
import { applyOemDefaults, parseOemRule, requiredFieldsFor, type OemOfferRule } from '../compliance';
import { approvalIsCurrent } from '../coop-approval';
import { approvalStatusFor } from '../coop-approval-store';
import { loadActiveCoopPack } from '../coop-pack-store';
import type { CoopRulePack } from '../coop-rules';
import { resolveTemplateCoopCheck } from '../coop-template-check-store';
import type { TemplateDoc } from '../doc-types';
import { incentiveToFieldPatch } from '../incentive-apply';
import { preflight, summarizePreflight, type CoopDesignVerdict } from '../preflight';
import { mergeRenderData, renderCreativeSizes, renderCreativeToS3 } from '../render-creative';
import { isS3Configured } from '@/lib/s3';
import { resolveDisclaimerText } from '../disclaimer-resolve';
import { designHash, resolveSyncState } from '../template-sync';
import type { AdData } from '../types';
import { offerFingerprint } from './fingerprint';
import {
  offerGroupKey,
  offersToFanOut,
  planVariants,
  previewSizeId,
  variantExpiry,
} from './plan-variants';
import { copyForCreative } from './generate-copy';
import type { SkippedVehicle } from './skip-reasons';
import {
  chooseVehicleImage,
  pickStockUnit,
  stockGate,
  stockGatePassed,
  stockUnitPatch,
  unmetByInventory,
  type StockUnit,
} from './inventory-match';
import { runWindowFor, type AutomationConfigRow } from './poll-offers';
import { resolveEventAsset } from './event-assets';
import { resolveAutomationTemplate, type TemplateCandidate } from './resolve-automation-template';
import { effectiveFanOut } from '@/lib/playbooks/creative';
import { selectOffer, type SelectableOfferType } from './select-offer';
import {
  generateOfferEmail,
  type OfferEmailConfigRow,
  type OfferEmailResult,
} from './generate-offer-email';

/**
 * Phase 3 — generate draft ads from watched OEM offers.
 *
 * Reads the offer history Phase 1 accumulated and turns each live, eligible offer
 * into a rendered `AdCreative`. Everything lands as a DRAFT by default: nothing
 * publishes without a person approving it.
 *
 * Idempotent. Re-running produces the same drafts, updated in place, because
 * `@@unique([accountKey, templateId, offerFingerprint])` plus deterministic
 * template and stock selection mean the same offer always resolves to the same
 * row. That is what makes it safe to retry after a partial failure.
 *
 * CO-OP POSTURE. Phase 2 concluded we shouldn't generate unattended for a make
 * with no co-op pack. Taken literally that means generating nothing at all today,
 * since no packs have been transcribed yet — so the rule is applied where it
 * actually bites: a verified pack is required to mark an ad `ready`, and its
 * absence forces the ad to `draft` with the reason recorded. A human reviewing a
 * draft IS the compliance check; an auto-published ad has none.
 *
 * Server-only.
 */

const NOTIFY_LINK = '/ad-generator';

// The reason vocabulary lives in `skip-reasons` so the run-history UI can label a
// skip without importing this server-only module.
export type { SkipReason, SkippedVehicle } from './skip-reasons';

export interface GeneratedAd {
  creativeId: string;
  vehicle: string;
  offerFingerprint: string;
  /** Identity of the variant group this ad competes in — see `offerGroupKey`. */
  offerGroupKey: string;
  /**
   * The BARE `OemOfferSnapshot.fingerprint` values this ad advertises — one, or
   * two for a dual.
   *
   * Carried separately because `offerFingerprint` above is a COMPOSITE
   * (`vehicle-slug:print[+print]`), and the snapshot table is keyed on the bare
   * hash. The offer email looked its incentives up with the composite, matched
   * nothing, and silently shipped without the manufacturer's program name,
   * description, offer details or eligibility text. Parsing the composite back
   * apart would work and would be a formatted-string dependency; passing the
   * values through cannot drift.
   */
  offerPrints: string[];
  offerSummary: string;
  templateId: string;
  templateName: string;
  templateReason: string;
  /** The design that leads its group. Exactly one per group, at most. */
  recommended: boolean;
  status: 'draft' | 'ready';
  imageSource: string;
  /** Active OEM sales event applied, or null when none was in force. */
  eventName: string | null;
  vin: string | null;
  sizes: number;
  expiresAt: string | null;
  coopVersion: string | null;
  warnings: string[];
  /** True when this run updated an existing draft rather than creating one. */
  updated: boolean;
}

export interface GenerateResult {
  accountKey: string;
  runId: string | null;
  generated: GeneratedAd[];
  skipped: SkippedVehicle[];
  /**
   * The companion offer email, on the scheduled path only. Null on a manual
   * run: an operator generating a slice of offers from the dialog is iterating
   * on creative, and producing a customer-facing email draft as a side effect
   * of that is a surprise nobody asked for.
   */
  email?: OfferEmailResult | null;
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

function jsonRecord(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'),
    );
  } catch {
    return {};
  }
}

function describeOffer(inc: MarketCheckIncentive): string {
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

function safeJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Full config row including the fields the poll doesn't need. */
export interface GenerateConfigRow extends AutomationConfigRow, OfferEmailConfigRow {
  /** JSON string[] of size ids to render; null/empty = every size in the template. */
  sizeIds: string | null;
  /** RETIRED — the cap counts vehicles now. Superseded by maxVehiclesPerRun. */
  maxAdsPerRun: number;
  maxVehiclesPerRun: number;
  minStock: number;
  templateMap: string | null;
  fanOutTemplateIds: string | null;
  mode: string;
  notifyUserIds: string | null;
  /** One ad per qualifying offer type, rather than only the best. */
  expandOfferTypes: boolean;
}

export const GENERATE_CONFIG_SELECT = {
  accountKey: true,
  enabled: true,
  emailEnabled: true,
  emailTemplateId: true,
  emailAudienceId: true,
  emailMaxOffers: true,
  makes: true,
  focusModels: true,
  excludeModels: true,
  zip: true,
  radius: true,
  offerTypePriority: true,
  expandOfferTypes: true,
  runWindowMode: true,
  rollingDays: true,
  sizeIds: true,
  maxAdsPerRun: true,
  maxVehiclesPerRun: true,
  minStock: true,
  templateMap: true,
  fanOutTemplateIds: true,
  mode: true,
  notifyUserIds: true,
} as const;

/** Generate for one sub-account. */
/**
 * Per-run narrowing, from the "Generate from OEM offers" dialog.
 *
 * A scheduled run uses the sub-account's saved config and takes everything.
 * A person triggering a run by hand usually wants a slice of it — this month's
 * lease push, two models — and being made to edit the saved settings to get it
 * would leave the automation misconfigured afterwards.
 */
export interface GenerateScope {
  /** Group keys (`year|make|model`, lower-cased) to include. Absent/empty = all. */
  vehicles?: string[];
  /** Restrict to these offer types. Absent/empty = the sub-account's configured set. */
  offerTypes?: SelectableOfferType[];
}

export async function generateForAccount(
  config: GenerateConfigRow,
  opts: { now?: Date; scope?: GenerateScope } = {},
): Promise<GenerateResult> {
  const now = opts.now ?? new Date();
  const started = new Date();
  const window = runWindowFor(config, now);
  const configured = jsonArray(config.offerTypePriority).filter((t): t is SelectableOfferType =>
    ['lease', 'apr', 'cash'].includes(t),
  );
  // A run-scoped type list narrows the configured one, keeping the configured
  // ORDER — the dialog picks which types are allowed, not which is preferred.
  // If the two don't overlap the explicit choice wins: the alternative is an
  // empty list, which `selectOffer` reads as "unset" and would silently widen
  // the run back to all three types.
  const wanted = opts.scope?.offerTypes?.length ? opts.scope.offerTypes : null;
  const narrowed = wanted ? configured.filter((t) => wanted.includes(t)) : configured;
  const priority = wanted && narrowed.length === 0 ? wanted : narrowed;
  const templateMap = jsonRecord(config.templateMap);
  // Which sizes to render. Empty = every size the template defines, which is what
  // this did before the setting existed, so an unconfigured account is unchanged.
  // Counted in vehicles — see maxVehiclesPerRun. `config.sizeIds` is no longer
  // read here: generation renders only the square preview, and the configured
  // size set governs the render that happens when a dealer picks a design.
  const cap = config.maxVehiclesPerRun > 0 ? config.maxVehiclesPerRun : 25;

  const account = await prisma.account.findUnique({
    where: { key: config.accountKey },
    select: { key: true, dealer: true, branding: true, logos: true },
  });
  const branding = safeJson<{ colors?: Record<string, string> }>(account?.branding ?? null);
  const logos = safeJson<Record<string, string>>(account?.logos ?? null);

  // Candidate templates: published + active, not deleted, and in scope for this
  // sub-account — its own, the shared library, or one shared with it.
  const templateRows = await prisma.adTemplateDoc
    .findMany({
      where: { status: 'published', isActive: true, ...LIVE_TEMPLATE },
      select: { id: true, name: true, accountKey: true, sharedAccountKeys: true, doc: true, updatedAt: true },
    })
    .then((rows) => templatesForAccount(rows, { accountKey: config.accountKey }))
    .catch(() => []);
  // The designs this account's PLAYBOOK permits, if it names any. Empty means
  // unconstrained — every published in-scope template, which is what an account
  // following no playbook has always done.
  //
  // Without this, any plate a designer publishes joins every account's run the
  // next night, including one built for a different brand. `templateMap` can't
  // prevent that: since the fan-out shipped it only decides which design is
  // RECOMMENDED, not which ones exist.
  const permitted = new Set(
    effectiveFanOut({
      // `templateMap.all` is where the playbook writes the lead design.
      adTemplateId: typeof templateMap?.all === 'string' ? templateMap.all : '',
      fanOutTemplateIds: safeJson<string[]>(config.fanOutTemplateIds) ?? [],
    }),
  );

  const candidates: TemplateCandidate[] = [];
  let permittedSkips = 0;
  for (const r of templateRows) {
    if (permitted.size > 0 && !permitted.has(r.id)) {
      permittedSkips += 1;
      continue;
    }
    const doc = safeJson<TemplateDoc>(r.doc);
    if (doc && Array.isArray(doc.sizes) && Array.isArray(doc.elements) && doc.layouts) {
      candidates.push({ id: r.id, name: r.name, accountKey: r.accountKey, doc, updatedAt: r.updatedAt });
    }
  }
  if (permittedSkips > 0) {
    console.log(
      `[generate-ads] ${config.accountKey}: playbook permits ${permitted.size} design(s); skipped ${permittedSkips} other published template(s)`,
    );
  }

  // Live offers on file, grouped by the vehicle they were found for.
  const snapshots = await prisma.oemOfferSnapshot
    .findMany({ where: { accountKey: config.accountKey, endedAt: null } })
    .catch(() => []);

  const groups = new Map<
    string,
    { year: number; make: string; model: string; incentives: MarketCheckIncentive[] }
  >();
  for (const s of snapshots) {
    const key = `${s.year}|${s.make.toLowerCase()}|${s.model.toLowerCase()}`;
    const inc = safeJson<MarketCheckIncentive>(s.payload);
    if (!inc) continue;
    const g = groups.get(key) ?? { year: s.year, make: s.make, model: s.model, incentives: [] };
    g.incentives.push(inc);
    groups.set(key, g);
  }

  // Run-scoped vehicle list. Applied after grouping so the keys match exactly
  // what the dialog was offered.
  const onlyVehicles = opts.scope?.vehicles?.length ? new Set(opts.scope.vehicles) : null;
  if (onlyVehicles) {
    for (const key of [...groups.keys()]) if (!onlyVehicles.has(key)) groups.delete(key);
  }

  // Per-make rules, fetched once each rather than per vehicle.
  const makes = [...new Set([...groups.values()].map((g) => g.make))];
  const oemRules = new Map<string, OemOfferRule | null>();
  const coopPacks = new Map<string, { id: string; pack: CoopRulePack } | null>();
  for (const make of makes) {
    try {
      const row = await prisma.adOemOfferRule.findFirst({
        where: { make: { equals: make, mode: 'insensitive' }, isActive: true },
      });
      oemRules.set(make, row ? parseOemRule(row.make, row.requiredFields, row.defaultValues) : null);
    } catch {
      oemRules.set(make, null);
    }
    coopPacks.set(make, await loadActiveCoopPack(make, now));
  }

  /**
   * Design-time co-op verdicts, memoised per (template, pack) for this run.
   *
   * The store already caches across runs; this map stops a run with eight vehicles
   * on one template from making eight identical round trips to read it back.
   */
  const designVerdicts = new Map<string, CoopDesignVerdict | null>();
  /**
   * @param templateId  Identity to memoise and (when persisting) cache under.
   * @param persist     False for an ad's OWN customized design: it must be
   *                    checked, but storing the result under the template's id
   *                    would overwrite the template's cached verdict with a
   *                    verdict about a different document.
   */
  const designVerdictFor = async (
    templateId: string,
    doc: TemplateDoc,
    entry: { id: string; pack: CoopRulePack } | null,
    persist = true,
  ): Promise<CoopDesignVerdict | null> => {
    if (!entry) return null;
    const key = `${templateId}::${entry.id}`;
    if (designVerdicts.has(key)) return designVerdicts.get(key) ?? null;
    let verdict: CoopDesignVerdict | null = null;
    try {
      const v = await resolveTemplateCoopCheck({ templateId, doc, packId: entry.id, pack: entry.pack, persist });
      verdict = {
        make: v.make,
        packVersion: v.packVersion,
        // `resolveTemplateCoopCheck` recomputes on staleness rather than returning a
        // stale verdict, so anything it hands back is current by construction.
        stale: false,
        findings: v.findings.map((f) => ({
          ruleId: f.ruleId,
          severity: f.severity,
          description: f.description,
          citation: f.citation,
          offerType: f.offerType,
        })),
      };
    } catch (err) {
      // Same failure direction as the pack loader: a broken design check must not
      // take down generation for every brand.
      console.warn(`[generate-ads] design co-op check failed for ${templateId}:`, err);
    }
    designVerdicts.set(key, verdict);
    return verdict;
  };

  const generated: GeneratedAd[] = [];
  const skipped: SkippedVehicle[] = [];

  // ── work list: one entry per AD, not per vehicle ──
  //
  // Stock and offer selection are resolved up front so that `expandOfferTypes`
  // can turn one vehicle into several ads without the 450-line build below
  // having to know anything about it — it just walks the list.
  //
  // The stock read is one query for the whole run rather than one per vehicle,
  // which is also what it should always have been.
  type VehicleGroup = (typeof groups) extends Map<string, infer V> ? V : never;
  type WorkItem = {
    g: VehicleGroup;
    vehicle: string;
    units: StockUnit[];
    /** Slot 1. */
    inc: MarketCheckIncentive;
    /** Slot 2 (`o2_*`) for a dual template; null for a single-offer design. */
    second: MarketCheckIncentive | null;
    /** The design this ad is built from. One work item per design per offer. */
    tpl: TemplateCandidate;
    /** True for the one design in the group that leads the row. */
    recommended: boolean;
    /** Why the recommendation landed where it did — shown in the run log. */
    templateReason: string;
  };
  const work: WorkItem[] = [];

  const allUnits = (
    await prisma.inventoryVehicle
      .findMany({
        where: { accountKey: config.accountKey, condition: 'new', soldAt: null },
        select: {
          vin: true, stockNumber: true, trim: true, price: true, msrp: true,
          color: true, colorDetail: true, imageUrls: true,
          year: true, make: true, model: true,
        },
      })
      .catch(() => [])
  ).map((u) => ({ ...u, imageUrls: jsonArray(u.imageUrls) }));

  const unitsByGroup = new Map<string, StockUnit[]>();
  for (const u of allUnits) {
    const k = `${u.year}|${u.make.toLowerCase()}|${u.model.toLowerCase()}`;
    const list = unitsByGroup.get(k) ?? [];
    list.push(u);
    unitsByGroup.set(k, list);
  }

  /**
   * Vehicles in the order the cap should take them: most units on the lot first,
   * name as tiebreak.
   *
   * NOT alphabetical, which is what this used to be. Alphabetical is harmless
   * while the cap never bites and actively unfair once it does — the same
   * early-alphabet models win every month and the tail never gets an ad at all.
   * Stock-descending is equally deterministic (so a retry plans the same run) and
   * drops the thinnest inventory, which is defensible to a dealer.
   *
   * Counts come from `unitsByGroup`, which is already in memory — no extra query.
   */
  const orderedGroups = [...groups.entries()]
    .map(([key, g]) => ({ key, g, stock: unitsByGroup.get(key)?.length ?? 0 }))
    .sort((a, b) => b.stock - a.stock || a.key.localeCompare(b.key));

  let vehiclesTaken = 0;

  for (const { g } of orderedGroups) {
    const vehicle = `${g.year} ${g.make} ${g.model}`;
    const units = unitsByGroup.get(`${g.year}|${g.make.toLowerCase()}|${g.model.toLowerCase()}`) ?? [];

    // Counted in VEHICLES, and checked before the vehicle contributes anything.
    // A vehicle is taken whole or not at all — a partial fan-out showing 3 of 6
    // designs reads to a dealer as the complete set.
    if (vehiclesTaken >= cap) {
      skipped.push({ vehicle, reason: 'cap_reached', detail: `Run cap of ${cap} vehicle(s) reached.` });
      continue;
    }

    const gate = stockGate(units.length, config.minStock);
    if (!stockGatePassed(gate)) {
      skipped.push({ vehicle, reason: 'stock_gate', detail: gate.reason });
      continue;
    }

    // ── offer ──
    const selection = selectOffer(g.incentives, {
      runWindow: window,
      priority: priority.length ? priority : undefined,
      // The trims actually on the lot, so a trim-specific programme can't be
      // attached to stock that never qualified for it.
      stockedTrims: units.map((u) => u.trim),
      now,
    });
    if (!selection.chosen) {
      // Name the trim case specifically — "no eligible offer" on a vehicle whose
      // OEM clearly published something is the report that sends someone hunting.
      const trimRejects = selection.candidates.filter((c) => c.rejected === 'trim_not_stocked');
      skipped.push({
        vehicle,
        reason: 'no_eligible_offer',
        detail: trimRejects.length
          ? `No offer valid for ${window.start.toISOString().slice(0, 10)} onward among ${g.incentives.length} — ${trimRejects.length} were for trims not in stock.`
          : `No offer valid for ${window.start.toISOString().slice(0, 10)} onward among ${g.incentives.length}.`,
      });
      continue;
    }

    // ── the offers this vehicle fans out across ──
    //
    // `expandOfferTypes` picks the AXIS: every qualifying type, or just the best.
    // Deduping by type is what keeps three lease programs differing only in term
    // from becoming three near-identical designs through every template.
    const fanOffers = offersToFanOut(selection.candidates, config.expandOfferTypes);

    if (candidates.length === 0) {
      skipped.push({
        vehicle,
        reason: 'no_template',
        detail: 'No published templates are in scope for this account.',
      });
      continue;
    }

    // ── which design leads ──
    //
    // The old resolution chain still runs, but it no longer decides which design
    // EXISTS — only which one is marked recommended. When it refuses, the
    // variants still generate and the row simply leads with no recommendation,
    // which is strictly better than the vehicle producing nothing.
    const resolution = resolveAutomationTemplate({
      candidates,
      accountKey: config.accountKey,
      offerType: fanOffers[0].type === 'cash' ? 'discount' : fanOffers[0].type,
      make: g.make,
      runDate: window.start,
      templateMap,
    });

    const plan = planVariants(fanOffers, candidates, resolution.template?.id ?? null);
    for (const sk of plan.skip) {
      skipped.push({
        vehicle,
        reason: sk.reason,
        detail: sk.detail,
        templateName: sk.templateName,
        offerSummary: sk.offer ? describeOffer(sk.offer) : undefined,
      });
    }
    if (plan.build.length === 0) continue;

    vehiclesTaken++;
    const byId = new Map(candidates.map((c) => [c.id, c]));
    for (const v of plan.build) {
      const tpl = byId.get(v.templateId);
      if (!tpl) continue; // unreachable: the plan is built from `candidates`
      work.push({
        g,
        vehicle,
        units,
        inc: v.primary,
        second: v.secondary,
        tpl,
        recommended: v.recommended,
        templateReason: v.recommended
          ? resolution.explanation
          : `One of ${plan.build.length} designs built for this vehicle.`,
      });
    }
  }

  // Everything below is PER VARIANT. A failure here drops that one design and
  // nothing else: before the fan-out a preflight failure or a missing event slot
  // took the whole vehicle with it, which would let one broken template in the
  // shared library silently erase a vehicle five other designs could carry.
  // The cap is not re-checked — it was applied per vehicle when `work` was built,
  // and re-applying it per ad is exactly the truncation that kept
  // `expandOfferTypes` switched off.
  for (const { g, vehicle, units, inc, second, tpl, recommended, templateReason } of work) {
    // Identity of the ad, and of the group the dealer chooses within. Both carry
    // the same string: the group is (vehicle + offers), and the unique key that
    // makes a re-run idempotent is (account, template, this) — the template is
    // what separates siblings, so the group key IS the fingerprint.
    const fingerprint = offerGroupKey(g, inc, second);

    // Review notes for this ad. Declared here because the very first thing worth
    // telling a reviewer — "your customized design was kept" — is decided next.
    const warnings: string[] = [];

    // ── the ad this offer already has, if any ──
    //
    // Looked up BEFORE preflight and render because it decides WHICH design this
    // run is working with. A re-run used to overwrite `doc` with the template's
    // current design unconditionally, which quietly did two things: it pushed
    // template edits into live ads with no prompt, and it destroyed any design
    // change a reviewer had made to the ad. A customized ad now keeps its own
    // design, and everything downstream — the event-slot check, preflight, the
    // render — runs against the design that will actually ship, not the one the
    // template happens to hold.
    const existing = await prisma.adCreative
      .findUnique({
        where: {
          accountKey_templateId_offerFingerprint: {
            accountKey: config.accountKey,
            templateId: tpl.id,
            offerFingerprint: fingerprint,
          },
        },
        select: {
          id: true,
          status: true,
          doc: true,
          autoGenerated: true,
          templateSync: true,
          copy: true,
          copySource: true,
        },
      })
      .catch(() => null);
    const followsTemplate = !existing || resolveSyncState(existing) === 'synced';
    const existingDoc = existing?.doc ? safeJson<TemplateDoc>(existing.doc) : null;
    // Fall back to the template when a detached ad's own doc can't be parsed:
    // refusing to generate would strand the offer over a corrupt blob.
    const activeDoc = followsTemplate ? tpl.doc : (existingDoc ?? tpl.doc);
    if (!followsTemplate && existingDoc) {
      warnings.push(
        `This ad has been customized, so it keeps its own design — edits to "${tpl.name}" were not applied. Reset it to the template if you want them.`,
      );
    }

    // ── data ──
    let data: AdData = incentiveToFieldPatch(inc, {
      year: g.year,
      make: g.make,
      model: g.model,
      zip: config.zip ?? undefined,
    });

    // ── the second offer, for a dual template ──
    //
    // `skipVehicle` because both offers are for the SAME model here (automation
    // refuses two-model duals), so re-writing the vehicle fields under the `o2_`
    // prefix would only duplicate what slot 1 already says.
    //
    // Three keys are shared rather than per-slot — `expiration`,
    // `_oemDisclaimer` and `_oemDisclaimerText` — so applying slot 2 overwrites
    // slot 1's. A person filling a dual template by hand sees that and fixes it;
    // nothing is watching here, so both have to be composed explicitly. Getting
    // this wrong publishes an ad carrying only half its required disclosure.
    if (second) {
      const firstDisclaimer = String(data._oemDisclaimerText ?? '').trim();
      data = {
        ...data,
        ...incentiveToFieldPatch(second, {
          year: g.year,
          make: g.make,
          model: g.model,
          zip: config.zip ?? undefined,
          slot: 'o2_',
          skipVehicle: true,
        }),
      };
      const secondDisclaimer = String(data._oemDisclaimerText ?? '').trim();
      // De-duplicated: two programs from one manufacturer often carry identical
      // fine print, and printing it twice looks like a bug on the finished ad.
      data._oemDisclaimerText = [...new Set([firstDisclaimer, secondDisclaimer].filter(Boolean))].join(' ');
      // The ad is only good while BOTH offers are — see variantExpiry.
      const earliest = variantExpiry(inc, second);
      if (earliest) data.expiration = earliest.toISOString().slice(0, 10);
    }

    data.dealerName = account?.dealer ?? '';
    data.brandColor = branding?.colors?.primary ?? '';
    // Every logo variant, so a template element pinned to one (e.g. the logo on a
    // dark panel) renders that file instead of falling back to the default.
    Object.assign(data, brandLogoData(logos));

    // A specific unit, so makes whose rules demand a VIN can finally be automated.
    const oemRule = oemRules.get(g.make) ?? null;
    const required = requiredFieldsFor(inc.type === 'cash' ? 'discount' : inc.type, oemRule);
    const unit = pickStockUnit(units, inc.trim);
    // Set when an OEM sales event is in force for the run window and the template
    // has somewhere to put its mark.
    let eventName: string | null = null;
    if (unit && required.some((f) => f === 'vin' || f === 'stockNumber' || f === 'msrp')) {
      data = { ...data, ...stockUnitPatch(unit, data) };
    }
    const unmet = unmetByInventory(required, data, unit);
    for (const u of unmet) {
      if (!u.satisfiableFromStock) {
        warnings.push(`${g.make} requires ${u.field} and neither the offer nor inventory supplies it.`);
      }
    }

    // ── image ──
    let evoxUrl: string | null = null;
    if (evoxConfigured()) {
      const jb = await resolveJellybean({
        year: g.year,
        make: g.make,
        model: g.model,
        color: unit?.colorDetail ?? unit?.color ?? null,
      });
      evoxUrl = jb?.url ?? null;
    }
    const image = chooseVehicleImage(evoxUrl, unit);
    if (!image.url) {
      // Skip here rather than letting preflight refuse it downstream: both stop
      // the ad, but this reports WHY in terms someone can act on ("EVOX doesn't
      // cover this model") instead of the mechanical "nothing to render for
      // vehicleImageUrl".
      skipped.push({ vehicle, reason: 'no_vehicle_imagery', detail: image.reason });
      continue;
    }
    data.vehicleImageUrl = image.url;
    // Without a bucket, importEvoxImage returns the ORIGINAL EVOX URL rather than
    // a re-hosted copy — which means the image is UNCROPPED: full 2400×1800 canvas,
    // wide transparent margins, and the "©EVOX IMAGES" watermark still baked in.
    // Say so, because the resulting preview looks like a design fault (tiny,
    // off-centre car with a watermark) when it's purely a missing-S3 artifact.
    if (image.source === 'evox' && !isS3Configured()) {
      warnings.push(
        'No S3 bucket: the EVOX image is the raw uncropped original, so the vehicle sits small and the EVOX watermark is still present. Cropping happens on re-host.',
      );
    }

    // ── OEM sales event ──
    // Resolved against the RUN date, not today: preparing an August flight in July
    // must carry August's event mark. Most OEMs mandate it during the window, so a
    // required event with nowhere to render is a hard stop — an ad that silently
    // omits it looks fine and is not claimable, which is the worst combination.
    const event = await resolveEventAsset(g.make, window.start, data.offerType ?? 'custom');
    if (event) {
      const hasSlot = activeDoc.elements.some(
        (el) => el.binding?.kind === 'field' && el.binding.key === 'eventLogoUrl',
      );
      if (!hasSlot) {
        if (event.required) {
          skipped.push({
            vehicle,
            reason: 'no_event_slot',
            detail: `${g.make} requires the "${event.name}" event mark on ads running ${event.effectiveFrom
              .toISOString()
              .slice(0, 10)}–${event.effectiveTo
              .toISOString()
              .slice(0, 10)}, but "${tpl.name}" has no element bound to eventLogoUrl.`,
          });
          continue;
        }
        warnings.push(
          `"${event.name}" is available for this window but the template has no eventLogoUrl element, so it is omitted. This OEM does not mandate it.`,
        );
      } else {
        data.eventLogoUrl = event.logoUrl;
        eventName = event.name;
      }
    }

    // ── standing OEM defaults ──
    //
    // Some required disclosures belong to the PROGRAMME, not the offer, so the feed
    // never carries them and nothing can derive them: Subaru §6x wants the ad to
    // state whether a security deposit is required, and MarketCheck has no such
    // field. Before these existed every Subaru lease failed preflight on a missing
    // field and was silently skipped.
    //
    // Applied BEFORE the disclaimer so a composed disclaimer can use the value, and
    // every application is recorded as a warning — an approver must be able to see
    // which numbers came from the manufacturer's offer and which a person asserted.
    const { data: withDefaults, applied } = applyOemDefaults(data, oemRule);
    data = withDefaults;
    for (const a of applied) {
      warnings.push(
        `${a.label} was filled from the ${g.make} standing default ("${a.value}") — the offer didn't carry it.`,
      );
    }

    // ── disclaimer ──
    const disclaimer = await resolveDisclaimerText(data, { make: g.make });
    data.disclaimer = disclaimer.text;

    // ── launch copy ──
    //
    // Generated here rather than at launch time so the words are frozen with the
    // offer they describe, and only when the row doesn't already have them: copy
    // is expensive, and re-drafting on every nightly re-run would mean the same
    // ad says something different each morning.
    let copyJson: string | null = existing?.copy ?? null;
    let copySource: string | null = existing?.copySource ?? null;
    if (!copyJson) {
      const outcome = await copyForCreative({
        doc: activeDoc,
        data,
        dealerName: account?.dealer ?? '',
        vehicle: { year: g.year, make: g.make, model: g.model },
        coopPack: coopPacks.get(g.make)?.pack ?? null,
        // AI drafts only where a key is configured; without one every ad gets the
        // deterministic caption, which is a floor rather than a failure.
        draft: anthropicConfigured() ? generateAdCopy : undefined,
      });
      copyJson = JSON.stringify(outcome.copy);
      copySource = outcome.source;
      warnings.push(...outcome.warnings);
    }

    // ── preflight (coherence + permission) ──
    const coopEntry = coopPacks.get(g.make) ?? null;
    const coopPack = coopEntry?.pack ?? null;
    // Keyed by the ad when the ad owns its design, so a customized board is
    // checked on its own merits and never written over the template's verdict.
    const coopDesign = followsTemplate
      ? await designVerdictFor(tpl.id, activeDoc, coopEntry)
      : await designVerdictFor(`creative:${existing!.id}`, activeDoc, coopEntry, false);
    const renderData = mergeRenderData(activeDoc, data);
    /**
     * ONE size at generation — the square preview.
     *
     * Under the fan-out a vehicle produces a design per template per offer type,
     * and rendering every size of every one of them is the entire cost of the
     * feature. A dealer choosing between designs only needs a thumbnail, and
     * `AdCreative` stores its own `doc` and `data`, so the remaining sizes cost
     * nothing to defer until someone actually picks this design.
     *
     * Rendering one size is weaker proof that the template can produce the ad —
     * a design that rasterizes cleanly at 1080×1080 can still break at 160×600.
     * Preflight below covers most of that gap by checking every size statically;
     * what is left is genuine rasterizer failure, which surfaces at pick time and
     * has to be reported loudly there.
     *
     * `config.sizeIds` no longer governs this — it governs the pick-time render.
     */
    const previewId = previewSizeId(activeDoc);
    const renderSizeIds = previewId ? [previewId] : undefined;

    // Checked across EVERY size the template defines, not just the one being
    // rendered. Preflight is a static check — it costs nothing to run wide — so
    // deferring the other renders doesn't have to mean deferring the other
    // checks. This is what keeps "we only rendered the square" from becoming
    // "nobody looked at the leaderboard until a dealer picked it".
    const pf = preflight({ doc: activeDoc, data: renderData, oemRule, coopPack, coopDesign });
    for (const issue of pf.issues.filter((i) => i.severity === 'warning')) warnings.push(issue.message);
    if (!pf.ok) {
      skipped.push({ vehicle, reason: 'preflight_failed', detail: summarizePreflight(pf) });
      continue;
    }

    // ── status: what makes an ad `ready` without a person looking at it ──
    //
    // Two independent forms of evidence, either of which is sufficient:
    //
    //   1. The manufacturer PRE-APPROVED this template's current design. This is
    //      the real-world path: co-op signs off on the plate, and every ad from it
    //      inherits that. The approval is design-scoped, so a template edited
    //      since approval falls back to a draft rather than riding a stale sign-off.
    //   2. A VERIFIED co-op rule pack exists and preflight passed against it —
    //      the machine-checked path, and the original gate.
    //
    // Neither on file means nobody and nothing has vouched for this ad, so it
    // stays a draft and says why. Note that until packs are transcribed, (1) is
    // the ONLY path that can produce a `ready` ad — which is the point of it.
    const approval = await approvalStatusFor({
      templateId: tpl.id,
      doc: activeDoc,
      make: g.make,
      activePackVersion: coopPack?.version ?? null,
    });
    let status: 'draft' | 'ready' = 'draft';
    if (config.mode === 'ready') {
      if (approvalIsCurrent(approval)) status = 'ready';
      else if (coopPack?.verified) status = 'ready';
      else {
        warnings.push(
          `Held as a draft: ${approval.reason}` +
            (coopPack
              ? ` The ${g.make} co-op pack (${coopPack.version}) is also not marked verified.`
              : ` No ${g.make} co-op pack is on file either, so no manufacturer advertising rules were checked.`),
        );
      }
    }
    // Recorded even when it didn't change the status, because "this ad rode a
    // template approval" is the answer to who permitted it, and a reviewer must be
    // able to see a stale approval on an ad that is otherwise fine.
    if (approval.state !== 'none' && approval.state !== 'current') {
      warnings.push(approval.reason);
    }

    // ── render ──
    // The render is ALWAYS performed, because actually rasterizing the ad is what
    // proves the template can produce it — that's the check, not the artifact.
    //
    // Persisting to S3 is separate and optional. A creative stores its own `doc`
    // and `data`, so it is fully re-renderable on demand by the existing render
    // route; the stored PNG is only a thumbnail convenience. Requiring a bucket in
    // order to CREATE a draft would make the whole feature unavailable in any
    // environment without one (local dev included) for no correctness gain.
    const renderKey = `${config.accountKey}-${tpl.id}-${fingerprint}`.slice(0, 120);
    let thumbnailUrl: string | null = null;
    let sizeCount = 0;
    try {
      if (isS3Configured()) {
        const persisted = await renderCreativeToS3({
          creativeId: renderKey,
          doc: activeDoc,
          data,
          accountKey: config.accountKey,
          sizeIds: renderSizeIds,
        });
        thumbnailUrl = persisted[0]?.url ?? null;
        sizeCount = persisted.length;
      } else {
        const pixels = await renderCreativeSizes({
          doc: activeDoc,
          data,
          accountKey: config.accountKey,
          sizeIds: renderSizeIds,
        });
        sizeCount = pixels.length;
        warnings.push('No S3 bucket configured — the ad renders but no preview image was stored.');
      }
    } catch (err) {
      skipped.push({
        vehicle,
        reason: 'render_failed',
        detail: err instanceof Error ? err.message : 'Unknown render error',
      });
      continue;
    }

    // For a dual ad this is the EARLIER of the two offers — the ad dies with
    // whichever program ends first, because the plate is still showing the dead
    // one. See variantExpiry.
    const expiresAt = variantExpiry(inc, second);
    // Names the OFFER, not the design — siblings in a group deliberately share a
    // name, because the list shows them side by side under one heading and each
    // design is identified by its template name beneath its thumbnail.
    const name = second
      ? `${vehicle} — ${describeOffer(inc)} + ${describeOffer(second)}`
      : `${vehicle} — ${describeOffer(inc)}`;

    // Never demote an ad a human already promoted to `ready`.
    const nextStatus = existing?.status === 'ready' ? 'ready' : status;
    const row = await prisma.adCreative.upsert({
      where: {
        accountKey_templateId_offerFingerprint: {
          accountKey: config.accountKey,
          templateId: tpl.id,
          offerFingerprint: fingerprint,
        },
      },
      create: {
        accountKey: config.accountKey,
        name,
        templateId: tpl.id,
        doc: JSON.stringify(tpl.doc),
        data: JSON.stringify(data),
        status: nextStatus,
        thumbnailUrl,
        autoGenerated: true,
        offerFingerprint: fingerprint,
        offerGroupKey: fingerprint,
        recommended,
        expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
        coopCheckedVersion: coopPack?.version ?? null,
        reviewNotes: warnings.length ? JSON.stringify(warnings) : null,
        createdByName: 'Ad automation',
        copy: copyJson,
        copySource,
        // Automated ads follow their template by default — that is the whole
        // point of them: the template is the only place a person can correct
        // fifty machine-built ads at once.
        templateSync: 'synced',
        templateDocHash: designHash(tpl.doc),
      },
      update: {
        name,
        data: JSON.stringify(data),
        status: nextStatus,
        thumbnailUrl,
        offerGroupKey: fingerprint,
        // Re-asserted every run, because which design leads can legitimately
        // change: a seasonal template opening its window takes the recommendation
        // from the brand fallback. Deliberately does NOT touch `selectedAt` — a
        // dealer's pick outranks the ranking and must survive every re-run.
        recommended,
        expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
        coopCheckedVersion: coopPack?.version ?? null,
        reviewNotes: warnings.length ? JSON.stringify(warnings) : null,
        // Written on update too, so a row that predates copy generation (or whose
        // earlier run had no key configured) picks it up on the next pass. A row
        // that already had copy kept it — `copyJson` is that same value here.
        copy: copyJson,
        copySource,
        // The DESIGN is only rewritten while the ad still follows the template.
        // A customized ad keeps its own board; its offer VALUES still refresh
        // above, because those belong to the OEM programme, not to the design.
        ...(followsTemplate
          ? { doc: JSON.stringify(tpl.doc), templateDocHash: designHash(tpl.doc) }
          : {}),
      },
    });

    generated.push({
      creativeId: row.id,
      vehicle,
      offerFingerprint: fingerprint,
      offerGroupKey: fingerprint,
      offerPrints: [offerFingerprint(inc), ...(second ? [offerFingerprint(second)] : [])],
      offerSummary: second ? `${describeOffer(inc)} + ${describeOffer(second)}` : describeOffer(inc),
      templateId: tpl.id,
      templateName: tpl.name,
      templateReason,
      recommended,
      status: nextStatus,
      imageSource: image.source,
      eventName,
      vin: data.vin ?? null,
      sizes: sizeCount,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      coopVersion: coopPack?.version ?? null,
      warnings,
      updated: !!existing,
    });
  }

  // ── run record (heartbeat — written even when nothing generated) ──
  let runId: string | null = null;
  try {
    const run = await prisma.adAutomationRun.create({
      data: {
        accountKey: config.accountKey,
        kind: 'generate',
        startedAt: started,
        finishedAt: new Date(),
        scopesChecked: groups.size,
        offersSeen: snapshots.length,
        issueCount: skipped.length,
        detail: JSON.stringify({
          window: { start: window.start.toISOString(), end: window.end.toISOString() },
          generated,
          skipped,
        }),
      },
    });
    runId = run.id;
    // Stamp the run onto the ads it produced, so a draft can be traced back.
    if (generated.length) {
      await prisma.adCreative.updateMany({
        where: { id: { in: generated.map((g) => g.creativeId) } },
        data: { runId: run.id },
      });
    }
  } catch (err) {
    console.warn('[generate-ads] could not record run:', err);
  }

  await notifyReviewers(config, generated, runId);
  await notifyClients(config, generated, runId);
  return { accountKey: config.accountKey, runId, generated, skipped };
}

/**
 * Who to tell about new drafts.
 *
 * `notifyUserIds` is empty by default, so relying on it alone means the normal
 * case is: ads get generated and nobody is ever informed — which quietly breaks
 * the entire draft-for-review premise. So fall back to the sub-account's assigned
 * rep, and then to admins, so the loop closes with no configuration at all.
 */
export async function resolveReviewers(
  // Structural, not `GenerateConfigRow`: the offer POLL needs the same reviewer
  // list and reads a narrower row. Widening the parameter beats a second copy
  // of the fallback chain that could disagree about who gets told.
  config: { accountKey: string; notifyUserIds: string | null },
): Promise<string[]> {
  const explicit = jsonArray(config.notifyUserIds);
  if (explicit.length) return explicit;

  try {
    const account = await prisma.account.findUnique({
      where: { key: config.accountKey },
      select: { accountRepId: true },
    });
    if (account?.accountRepId) return [account.accountRepId];
  } catch {
    // fall through to the admin sweep
  }

  try {
    const admins = await prisma.user.findMany({
      where: { role: { in: ['developer', 'super_admin', 'admin'] } },
      select: { id: true },
      take: 5,
    });
    return admins.map((a) => a.id);
  } catch {
    return [];
  }
}

/**
 * The client-side users on this account — the people whose ads these are.
 *
 * Distinct from the reviewers above, who are Oz staff. Before this, generation
 * told the account rep and the admins and nobody else, so a dealer had no way to
 * learn that this month's offers had been built except by opening the page and
 * noticing. That is a poor deal for the surface they are redirected to on login.
 *
 * `accountKeys` is a JSON array on the user, and `accountScope: 'all'` means
 * every account — deliberately NOT treated as "notify about everything" here,
 * because an all-scope client would then hear about all 19 accounts' offers.
 * Only an explicit assignment counts.
 */
export async function resolveClientWatchers(accountKey: string): Promise<string[]> {
  try {
    const clients = await prisma.user.findMany({
      where: { role: 'client' },
      select: { id: true, accountKeys: true },
    });
    return clients
      .filter((u) => jsonArray(u.accountKeys).includes(accountKey))
      .map((u) => u.id);
  } catch {
    // Never let the notification lookup take down a run that already produced ads.
    return [];
  }
}

/** Tell the reviewers there are drafts waiting. Best-effort. */
async function notifyReviewers(
  config: GenerateConfigRow,
  generated: GeneratedAd[],
  runId: string | null,
): Promise<void> {
  const fresh = generated.filter((g) => !g.updated);
  if (fresh.length === 0) return; // nothing new to look at
  const recipients = await resolveReviewers(config);
  if (recipients.length === 0) {
    console.warn(`[generate-ads] ${config.accountKey}: ${fresh.length} draft(s) with no one to notify`);
    return;
  }

  const heldBack = generated.filter((g) => g.status === 'draft' && g.warnings.length > 0).length;
  const body =
    `${fresh.length} new draft ad(s) from OEM offers` +
    (heldBack ? `, ${heldBack} with review notes` : '') +
    '. Nothing publishes until approved.';

  for (const userId of recipients) {
    try {
      await createNotification({
        userId,
        type: 'incentive_ads_ready',
        severity: 'info',
        title: `${fresh.length} offer ad(s) ready to review`,
        body,
        link: NOTIFY_LINK,
        meta: { accountKey: config.accountKey, runId, count: fresh.length },
        // One notification per run, not per ad.
        dedupeKey: `adgen:${config.accountKey}:${runId ?? 'norun'}`,
        dedupeWindowHours: 12,
      });
    } catch (err) {
      console.warn('[generate-ads] notification failed:', err);
    }
  }
}

/**
 * Tell the account's own people that this month's ads exist.
 *
 * Separate from `notifyReviewers`, which reaches Oz staff. A client lands on the
 * Ad Generator when they sign in, and before this the only way they learned that
 * new offers had been built was to go looking — which makes an automation that
 * runs at 6am overnight effectively invisible to the people whose ads they are.
 *
 * IN-APP ONLY. `createNotification` emails only when `sendEmailNow` is set, and
 * it is deliberately not set here: this fires on every run that produces
 * anything, and turning that into dealer email without anyone asking is how a
 * useful feature becomes a complaint. It still honors each user's own
 * `NotificationPreference`, so a client who has muted this type hears nothing.
 *
 * Counts what needs a DECISION, not what was produced. "12 new ads" reads as
 * work; "4 offers ready to review" is the true size of the ask, because the
 * designs for one offer are one choice.
 */
async function notifyClients(
  config: GenerateConfigRow,
  generated: GeneratedAd[],
  runId: string | null,
): Promise<void> {
  const fresh = generated.filter((g) => !g.updated);
  if (fresh.length === 0) return;

  const recipients = await resolveClientWatchers(config.accountKey);
  if (recipients.length === 0) return;

  // One entry per offer group — several designs for one offer are one decision.
  const offers = new Set(fresh.map((g) => g.offerGroupKey)).size;
  const choices = new Set(
    fresh.filter((g) => !g.recommended).map((g) => g.offerGroupKey),
  ).size;

  const title = `${offers} new offer ad${offers === 1 ? '' : 's'} ready to review`;
  const body =
    `This month's manufacturer offers have been built into ad designs` +
    (choices ? `, with more than one design to choose from on ${choices} of them` : '') +
    '. Nothing runs until you approve it.';

  for (const userId of recipients) {
    try {
      await createNotification({
        userId,
        type: 'incentive_ads_ready',
        severity: 'info',
        title,
        body,
        link: NOTIFY_LINK,
        meta: { accountKey: config.accountKey, runId, offers },
        // One per run, matching the reviewer notification.
        dedupeKey: `adgen-client:${config.accountKey}:${runId ?? 'norun'}`,
        dedupeWindowHours: 12,
      });
    } catch (err) {
      console.warn('[generate-ads] client notification failed:', err);
    }
  }
}

/** Generate for every enabled sub-account. */
export async function generateAllAccounts(now = new Date()): Promise<GenerateResult[]> {
  let configs: GenerateConfigRow[] = [];
  try {
    configs = (await prisma.adAutomationConfig.findMany({
      where: { enabled: true },
      select: GENERATE_CONFIG_SELECT,
    })) as GenerateConfigRow[];
  } catch (err) {
    console.warn('[generate-ads] config table unavailable:', err);
    return [];
  }

  const out: GenerateResult[] = [];
  for (const config of configs) {
    try {
      const result = await generateForAccount(config, { now });
      // The companion email. Isolated in its own try: an email that fails to
      // build must never lose the ads that were already generated and recorded
      // — they are the thing the run exists to produce.
      let email: OfferEmailResult | null = null;
      try {
        email = await generateOfferEmail(config, result.generated, { runId: result.runId });
      } catch (err) {
        console.error(`[generate-ads] ${config.accountKey} offer email failed:`, err);
      }
      out.push({ ...result, email });
    } catch (err) {
      console.error(`[generate-ads] ${config.accountKey} failed:`, err);
    }
  }
  return out;
}
