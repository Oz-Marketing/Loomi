import { prisma } from '@/lib/prisma';
import { evoxConfigured } from '@/lib/integrations/evox';
import { resolveJellybean } from '@/lib/integrations/evox-jellybean';
import type { MarketCheckIncentive } from '@/lib/integrations/marketcheck';
import { createNotification } from '@/lib/notifications/service';
import { applyOemDefaults, parseOemRule, requiredFieldsFor, type OemOfferRule } from '../compliance';
import { loadActiveCoopPack } from '../coop-pack-store';
import type { CoopRulePack } from '../coop-rules';
import { resolveTemplateCoopCheck } from '../coop-template-check-store';
import type { TemplateDoc } from '../doc-types';
import { incentiveToFieldPatch } from '../incentive-apply';
import { preflight, summarizePreflight, type CoopDesignVerdict } from '../preflight';
import { mergeRenderData, renderCreativeSizes, renderCreativeToS3 } from '../render-creative';
import { isS3Configured } from '@/lib/s3';
import { resolveDisclaimerText } from '../disclaimer-resolve';
import type { AdData } from '../types';
import { creativeOfferKey, offerFingerprint } from './fingerprint';
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
import { selectOffer, type SelectableOfferType } from './select-offer';

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

export type SkipReason =
  | 'stock_gate'
  | 'no_eligible_offer'
  | 'no_template'
  /** EVOX has no licensed imagery for the model, and dealer photos are never
   *  used. Reported separately from `preflight_failed` because it's the one skip
   *  reason with a purely commercial fix — extending EVOX coverage — rather than
   *  anything to change in the data or the template. */
  | 'no_vehicle_imagery'
  /** A required OEM sales-event mark has no element to render into. */
  | 'no_event_slot'
  | 'preflight_failed'
  | 'render_failed'
  | 'cap_reached';

export interface GeneratedAd {
  creativeId: string;
  vehicle: string;
  offerFingerprint: string;
  offerSummary: string;
  templateId: string;
  templateName: string;
  templateReason: string;
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

export interface SkippedVehicle {
  vehicle: string;
  reason: SkipReason;
  detail: string;
}

export interface GenerateResult {
  accountKey: string;
  runId: string | null;
  generated: GeneratedAd[];
  skipped: SkippedVehicle[];
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
export interface GenerateConfigRow extends AutomationConfigRow {
  /** JSON string[] of size ids to render; null/empty = every size in the template. */
  sizeIds: string | null;
  maxAdsPerRun: number;
  minStock: number;
  templateMap: string | null;
  mode: string;
  notifyUserIds: string | null;
}

export const GENERATE_CONFIG_SELECT = {
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
  sizeIds: true,
  maxAdsPerRun: true,
  minStock: true,
  templateMap: true,
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
  const wantedSizes = jsonArray(config.sizeIds);
  const cap = config.maxAdsPerRun > 0 ? config.maxAdsPerRun : 10;

  const account = await prisma.account.findUnique({
    where: { key: config.accountKey },
    select: { key: true, dealer: true, branding: true, logos: true },
  });
  const branding = safeJson<{ colors?: Record<string, string> }>(account?.branding ?? null);
  const logos = safeJson<Record<string, string>>(account?.logos ?? null);

  // Candidate templates: published + active, this sub-account's own or global.
  const templateRows = await prisma.adTemplateDoc
    .findMany({
      where: { status: 'published', isActive: true, OR: [{ accountKey: config.accountKey }, { accountKey: null }] },
      select: { id: true, name: true, accountKey: true, doc: true, updatedAt: true },
    })
    .catch(() => []);
  const candidates: TemplateCandidate[] = [];
  for (const r of templateRows) {
    const doc = safeJson<TemplateDoc>(r.doc);
    if (doc && Array.isArray(doc.sizes) && Array.isArray(doc.elements) && doc.layouts) {
      candidates.push({ id: r.id, name: r.name, accountKey: r.accountKey, doc, updatedAt: r.updatedAt });
    }
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
  const designVerdictFor = async (
    templateId: string,
    doc: TemplateDoc,
    entry: { id: string; pack: CoopRulePack } | null,
  ): Promise<CoopDesignVerdict | null> => {
    if (!entry) return null;
    const key = `${templateId}::${entry.id}`;
    if (designVerdicts.has(key)) return designVerdicts.get(key) ?? null;
    let verdict: CoopDesignVerdict | null = null;
    try {
      const v = await resolveTemplateCoopCheck({ templateId, doc, packId: entry.id, pack: entry.pack });
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

  for (const [, g] of [...groups.entries()].sort()) {
    const vehicle = `${g.year} ${g.make} ${g.model}`;
    if (generated.length >= cap) {
      skipped.push({ vehicle, reason: 'cap_reached', detail: `Run cap of ${cap} ad(s) reached.` });
      continue;
    }

    // ── stock ──
    const units: StockUnit[] = (
      await prisma.inventoryVehicle
        .findMany({
          where: {
            accountKey: config.accountKey,
            condition: 'new',
            soldAt: null,
            year: g.year,
            make: { equals: g.make, mode: 'insensitive' },
            model: { equals: g.model, mode: 'insensitive' },
          },
          select: {
            vin: true, stockNumber: true, trim: true, price: true, msrp: true,
            color: true, colorDetail: true, imageUrls: true,
          },
        })
        .catch(() => [])
    ).map((u) => ({ ...u, imageUrls: jsonArray(u.imageUrls) }));

    const gate = stockGate(units.length, config.minStock);
    if (!stockGatePassed(gate)) {
      skipped.push({ vehicle, reason: 'stock_gate', detail: gate.reason });
      continue;
    }

    // ── offer ──
    const selection = selectOffer(g.incentives, {
      runWindow: window,
      priority: priority.length ? priority : undefined,
      now,
    });
    if (!selection.chosen) {
      skipped.push({
        vehicle,
        reason: 'no_eligible_offer',
        detail: `No offer valid for ${window.start.toISOString().slice(0, 10)} onward among ${g.incentives.length}.`,
      });
      continue;
    }
    const inc = selection.chosen.incentive;
    // Vehicle-scoped: two vehicles can share one identical OEM programme, and each
    // still needs its own ad. See creativeOfferKey.
    const fingerprint = creativeOfferKey(g, offerFingerprint(inc));

    // ── template ──
    const resolution = resolveAutomationTemplate({
      candidates,
      accountKey: config.accountKey,
      offerType: inc.type === 'cash' ? 'discount' : inc.type,
      make: g.make,
      runDate: window.start,
      templateMap,
    });
    if (!resolution.template) {
      skipped.push({ vehicle, reason: 'no_template', detail: resolution.explanation });
      continue;
    }
    const tpl = resolution.template;

    // ── data ──
    let data: AdData = incentiveToFieldPatch(inc, {
      year: g.year,
      make: g.make,
      model: g.model,
      zip: config.zip ?? undefined,
    });
    data.dealerName = account?.dealer ?? '';
    data.brandColor = branding?.colors?.primary ?? '';
    data.logoUrl = logos?.light ?? logos?.dark ?? '';

    // A specific unit, so makes whose rules demand a VIN can finally be automated.
    const oemRule = oemRules.get(g.make) ?? null;
    const required = requiredFieldsFor(inc.type === 'cash' ? 'discount' : inc.type, oemRule);
    const unit = pickStockUnit(units, inc.trim);
    const warnings: string[] = [];
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
      const hasSlot = tpl.doc.elements.some(
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

    // ── preflight (coherence + permission) ──
    const coopEntry = coopPacks.get(g.make) ?? null;
    const coopPack = coopEntry?.pack ?? null;
    const coopDesign = await designVerdictFor(tpl.id, tpl.doc, coopEntry);
    const renderData = mergeRenderData(tpl.doc, data);
    // Intersect with what this template actually has: a size selected before a
    // template swap can name an id the new one doesn't define, and rendering an
    // empty set throws. Falling back to "all" beats failing the run.
    const docSizeIds = tpl.doc.sizes.map((s) => s.id);
    const sizeIds = wantedSizes.length ? docSizeIds.filter((id) => wantedSizes.includes(id)) : [];
    const renderSizeIds = sizeIds.length ? sizeIds : undefined;
    if (wantedSizes.length && !sizeIds.length) {
      warnings.push(
        `None of the configured sizes (${wantedSizes.join(', ')}) exist in ${tpl.name} — rendered every size instead.`,
      );
    }

    const pf = preflight({ doc: tpl.doc, data: renderData, oemRule, coopPack, coopDesign, sizeIds: renderSizeIds });
    for (const issue of pf.issues.filter((i) => i.severity === 'warning')) warnings.push(issue.message);
    if (!pf.ok) {
      skipped.push({ vehicle, reason: 'preflight_failed', detail: summarizePreflight(pf) });
      continue;
    }

    // ── status: `ready` requires a VERIFIED co-op pack ──
    let status: 'draft' | 'ready' = 'draft';
    if (config.mode === 'ready') {
      if (coopPack?.verified) status = 'ready';
      else {
        warnings.push(
          coopPack
            ? `Held as a draft: the ${g.make} co-op pack (${coopPack.version}) is not marked verified.`
            : `Held as a draft: no ${g.make} co-op pack is on file, so no manufacturer advertising rules were checked.`,
        );
      }
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
          doc: tpl.doc,
          data,
          accountKey: config.accountKey,
          sizeIds: renderSizeIds,
        });
        thumbnailUrl = persisted[0]?.url ?? null;
        sizeCount = persisted.length;
      } else {
        const pixels = await renderCreativeSizes({
          doc: tpl.doc,
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

    const expiresAt = inc.endDate ? new Date(inc.endDate) : null;
    const name = `${vehicle} — ${describeOffer(inc)}`;
    const existing = await prisma.adCreative.findUnique({
      where: {
        accountKey_templateId_offerFingerprint: {
          accountKey: config.accountKey,
          templateId: tpl.id,
          offerFingerprint: fingerprint,
        },
      },
      select: { id: true, status: true },
    });

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
        expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
        coopCheckedVersion: coopPack?.version ?? null,
        reviewNotes: warnings.length ? JSON.stringify(warnings) : null,
        createdByName: 'Ad automation',
      },
      update: {
        name,
        data: JSON.stringify(data),
        doc: JSON.stringify(tpl.doc),
        status: nextStatus,
        thumbnailUrl,
        expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
        coopCheckedVersion: coopPack?.version ?? null,
        reviewNotes: warnings.length ? JSON.stringify(warnings) : null,
      },
    });

    generated.push({
      creativeId: row.id,
      vehicle,
      offerFingerprint: fingerprint,
      offerSummary: describeOffer(inc),
      templateId: tpl.id,
      templateName: tpl.name,
      templateReason: resolution.explanation,
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
export async function resolveReviewers(config: GenerateConfigRow): Promise<string[]> {
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
      out.push(await generateForAccount(config, { now }));
    } catch (err) {
      console.error(`[generate-ads] ${config.accountKey} failed:`, err);
    }
  }
  return out;
}
