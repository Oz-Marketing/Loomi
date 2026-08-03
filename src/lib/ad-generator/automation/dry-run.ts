import { prisma } from '@/lib/prisma';
import { getIncentives, marketcheckConfigured } from '@/lib/integrations/marketcheck';
import { evoxConfigured } from '@/lib/integrations/evox';
import { resolveJellybean } from '@/lib/integrations/evox-jellybean';
import { incentiveToFieldPatch } from '../incentive-apply';
import { resolveDisclaimerText } from '../disclaimer-resolve';
import { brandLogoData } from '../brand-logos';
import { parseOemRule, type OemOfferRule } from '../compliance';
import { loadActiveCoopPack } from '../coop-pack-store';
import { splitCoopPack, type CoopRulePack } from '../coop-rules';
import { summarizeTemplateCoop } from '../coop-template-check';
import { resolveTemplateCoopCheck } from '../coop-template-check-store';
import { preflight, summarizePreflight, type CoopDesignVerdict } from '../preflight';
import { mergeRenderData, renderCreativeSizes } from '../render-creative';
import type { TemplateDoc } from '../doc-types';
import type { AdData } from '../types';
import { selectOffer, type SelectableOfferType } from './select-offer';
import type { RunWindow } from './offer-timing';
import { runWindowFor } from './poll-offers';

/**
 * Phase 0 dry run — walk the whole autonomous chain for ONE vehicle and report
 * what happened at every step, WITHOUT writing anything.
 *
 * The point is to prove the chain end-to-end (and to make it watchable) before
 * any of it is put on a schedule: no `AdCreative` is created, no PNG is uploaded,
 * no offer state is persisted. Everything it touches is a read.
 *
 * Each step returns a `summary` for humans and a JSON-serializable `detail` for
 * the inspector UI, so a failure is legible without reading the logs.
 */

export type DryRunStatus = 'ok' | 'warn' | 'failed' | 'skipped';

export interface DryRunStep {
  id: string;
  label: string;
  status: DryRunStatus;
  ms: number;
  summary: string;
  detail?: unknown;
}

export interface DryRunPreview {
  sizeId: string;
  label: string;
  width: number;
  height: number;
  /** base64 PNG data URL — a dry run holds pixels in memory, never in S3. */
  dataUrl: string;
}

export interface DryRunResult {
  ok: boolean;
  steps: DryRunStep[];
  previews: DryRunPreview[];
}

export interface DryRunInput {
  accountKey: string;
  /** Defaults to the sub-account's OEM. */
  make?: string;
  model: string;
  year?: number;
  /** Defaults to the sub-account's postal code. */
  zip?: string;
  /** Explicit template. Defaults to the newest published one in scope. */
  templateId?: string;
  sizeIds?: string[];
  priority?: SelectableOfferType[];
  minDaysRemaining?: number;
}

/** Time a step and fold it into the trace. */
async function step<T>(
  steps: DryRunStep[],
  id: string,
  label: string,
  fn: () => Promise<{ status?: DryRunStatus; summary: string; detail?: unknown; value?: T }>,
): Promise<T | undefined> {
  const started = Date.now();
  try {
    const r = await fn();
    steps.push({ id, label, status: r.status ?? 'ok', ms: Date.now() - started, summary: r.summary, detail: r.detail });
    return r.value;
  } catch (err) {
    steps.push({
      id,
      label,
      status: 'failed',
      ms: Date.now() - started,
      summary: err instanceof Error ? err.message : 'Unexpected error',
    });
    return undefined;
  }
}

function fail(steps: DryRunStep[], id: string, label: string, summary: string): DryRunResult {
  steps.push({ id, label, status: 'failed', ms: 0, summary });
  return { ok: false, steps, previews: [] };
}

/**
 * The template an automated ad would use. Phase 0 keeps this deliberately dumb —
 * an explicit id, else the newest published doc scoped to this sub-account (its
 * own first, then globals). The real resolution chain (monthly pin → schedule
 * window → per-offer-type default → brand default) lands with the config model.
 */
async function resolveAutomationTemplate(
  accountKey: string,
  templateId?: string,
): Promise<{ doc: TemplateDoc; id: string; name: string; how: string } | null> {
  if (templateId) {
    const row = await prisma.adTemplateDoc.findUnique({ where: { id: templateId } });
    if (!row) return null;
    return { doc: JSON.parse(row.doc) as TemplateDoc, id: row.id, name: row.name, how: 'explicitly selected' };
  }
  const rows = await prisma.adTemplateDoc.findMany({
    where: { status: 'published', isActive: true, OR: [{ accountKey }, { accountKey: null }] },
    orderBy: { updatedAt: 'desc' },
  });
  // Sub-account-owned templates outrank globals.
  const row = rows.find((r) => r.accountKey === accountKey) ?? rows[0];
  if (!row) return null;
  return {
    doc: JSON.parse(row.doc) as TemplateDoc,
    id: row.id,
    name: row.name,
    how: row.accountKey ? 'newest published template for this sub-account' : 'newest published global template',
  };
}

/**
 * The run window this sub-account plans against — read from its automation config
 * so the inspector judges eligibility exactly as the generator does. Falls back
 * to next month, matching the config default, when no config row exists yet.
 */
async function accountRunWindow(accountKey: string, now: Date): Promise<RunWindow> {
  try {
    const cfg = await prisma.adAutomationConfig.findUnique({
      where: { accountKey },
      select: { runWindowMode: true, rollingDays: true },
    });
    if (cfg) return runWindowFor(cfg, now);
  } catch {
    // Unmigrated or unreadable — the default below is the honest fallback.
  }
  return runWindowFor({ runWindowMode: 'next_month', rollingDays: 30 }, now);
}

export async function dryRunOneVehicle(input: DryRunInput): Promise<DryRunResult> {
  const steps: DryRunStep[] = [];
  const now = new Date();

  // ── 1. Sub-account ──
  const account = await prisma.account.findUnique({
    where: { key: input.accountKey },
    select: { key: true, dealer: true, oem: true, postalCode: true, branding: true, logos: true },
  });
  if (!account) return fail(steps, 'account', 'Sub-account', `No sub-account "${input.accountKey}".`);

  const make = (input.make || account.oem || '').trim();
  const model = input.model.trim();
  const zip = (input.zip || account.postalCode || '').trim();
  const year = input.year ?? new Date().getFullYear();

  steps.push({
    id: 'account',
    label: 'Sub-account',
    status: 'ok',
    ms: 0,
    summary: `${account.dealer} — ${make || 'no OEM set'}${zip ? ` · ${zip}` : ''}`,
    detail: { key: account.key, dealer: account.dealer, make, zip, year, model },
  });
  if (!make) return fail(steps, 'account', 'Sub-account', 'No make: set the sub-account OEM or pass one explicitly.');

  // ── 2. Offers ──
  if (!marketcheckConfigured()) {
    return fail(steps, 'offers', 'MarketCheck offers', 'MARKETCHECK_API_KEY is not set in this environment.');
  }
  const feed = await step(steps, 'offers', 'MarketCheck offers', async () => {
    const res = await getIncentives(make, model, year, zip || undefined);
    const notes: string[] = [];
    if (res.usedYear !== year) notes.push(`no ${year} programs — using ${res.usedYear}`);
    if (res.usedNational) notes.push('none near that ZIP — national programs');
    return {
      status: res.incentives.length ? ('ok' as const) : ('failed' as const),
      summary: res.incentives.length
        ? `${res.incentives.length} program(s)${notes.length ? ` (${notes.join('; ')})` : ''}`
        : 'No incentives returned for that vehicle.',
      detail: { usedYear: res.usedYear, usedNational: res.usedNational, incentives: res.incentives },
      value: res,
    };
  });
  if (!feed?.incentives.length) return { ok: false, steps, previews: [] };

  // ── 3. Selection ──
  // Gate on the sub-account's RUN WINDOW, the same rule the generator uses.
  //
  // This previously defaulted to `minDaysRemaining: 7`, which made the diagnostic
  // disagree with the thing it diagnoses: on 2026-07-29 the generator produced
  // seven Chevrolet drafts while the dry run reported "no eligible offer among 6
  // candidates" for the same vehicle, because GM's programmes end 08-03 and are
  // therefore under a 7-day floor yet perfectly valid for an August flight. A
  // debugging tool that contradicts production is worse than none.
  //
  // `minDaysRemaining` is still honoured when passed explicitly, so the inspector
  // can be used to ask the "what if" question deliberately.
  const runWindow = input.minDaysRemaining == null ? await accountRunWindow(input.accountKey, now) : undefined;
  const selection = selectOffer(feed.incentives, {
    priority: input.priority,
    runWindow,
    minDaysRemaining: input.minDaysRemaining,
    now,
  });
  steps.push({
    id: 'select',
    label: 'Offer selection',
    status: selection.chosen ? 'ok' : 'failed',
    ms: 0,
    summary: selection.chosen
      ? `Chose ${selection.chosen.reason}`
      : `No eligible offer among ${selection.candidates.length} candidate(s).`,
    detail: {
      chosen: selection.chosen && { key: selection.chosen.key, reason: selection.chosen.reason },
      candidates: selection.candidates.map((c) => ({
        key: c.key,
        type: c.incentive.type,
        rank: c.rank,
        rejected: c.rejected,
        reason: c.reason,
        offerDetails: c.incentive.offerDetails || c.incentive.description,
      })),
    },
  });
  const chosen = selection.chosen;
  if (!chosen) return { ok: false, steps, previews: [] };

  // ── 4. Template ──
  const tpl = await step(steps, 'template', 'Template', async () => {
    const t = await resolveAutomationTemplate(input.accountKey, input.templateId);
    if (!t) {
      return { status: 'failed' as const, summary: 'No published template in scope for this sub-account.' };
    }
    return {
      status: 'ok' as const,
      summary: `${t.name} — ${t.how}`,
      detail: { id: t.id, name: t.name, how: t.how, sizes: t.doc.sizes.map((s) => s.id) },
      value: t,
    };
  });
  if (!tpl) return { ok: false, steps, previews: [] };

  // ── 5. Field patch ──
  let data: AdData = incentiveToFieldPatch(chosen.incentive, { year, make, model, zip });
  steps.push({
    id: 'patch',
    label: 'Offer → fields',
    status: 'ok',
    ms: 0,
    summary: `${Object.keys(data).length} field(s) filled from the incentive`,
    detail: { ...data },
  });

  // Brand context the template binds to (same values the generator supplies).
  const branding = safeJson<{ colors?: Record<string, string> }>(account.branding);
  const logos = safeJson<Record<string, string>>(account.logos);
  data = {
    ...data,
    dealerName: account.dealer,
    brandColor: branding?.colors?.primary ?? '',
    ...brandLogoData(logos),
  };

  // ── 6. Vehicle image ──
  await step(steps, 'image', 'EVOX jellybean', async () => {
    if (!evoxConfigured()) {
      return { status: 'skipped' as const, summary: 'EVOX_API_KEY is not set — rendering without a vehicle image.' };
    }
    const jb = await resolveJellybean({ year, make, model });
    if (!jb) return { status: 'warn' as const, summary: 'No EVOX match for this vehicle.' };
    data.vehicleImageUrl = jb.url;
    return {
      status: 'ok' as const,
      summary: `${jb.matchedColor ?? 'default colour'}${jb.cached ? ' (S3 cache hit)' : ' (fetched + re-hosted)'}`,
      detail: { url: jb.url, matchedColor: jb.matchedColor, cached: jb.cached },
    };
  });

  // ── 7. Disclaimer ──
  await step(steps, 'disclaimer', 'Disclaimer', async () => {
    const d = await resolveDisclaimerText(data, { make });
    data.disclaimer = d.text;
    return {
      status: 'ok' as const,
      summary: `${d.source.replace('_', ' ')}${d.templateName ? ` — ${d.templateName}` : ''}`,
      detail: { source: d.source, templateName: d.templateName, text: d.text },
    };
  });

  // ── 8. Preflight ──
  // Against the MERGED data — what the renderer will actually see. Checking the
  // raw patch would miss placeholder defaults filling the gaps.
  const renderData = mergeRenderData(tpl.doc, data);
  let oemRule: OemOfferRule | null = null;
  try {
    const row = await prisma.adOemOfferRule.findFirst({
      where: { make: { equals: make, mode: 'insensitive' }, isActive: true },
    });
    if (row) oemRule = parseOemRule(row.make, row.requiredFields, row.defaultValues);
  } catch {
    // Unmigrated table — the code baseline still applies.
  }
  // The make's co-op pack, if one has been transcribed. Absent = no co-op checks,
  // which is reported explicitly rather than passing silently — "no pack" and
  // "no rules" look identical to the evaluator but mean very different things
  // when a co-op claim is at stake.
  const coopEntry = await loadActiveCoopPack(make);
  const coopPack: CoopRulePack | null = coopEntry?.pack ?? null;
  const split = coopPack ? splitCoopPack(coopPack) : null;
  steps.push({
    id: 'coop',
    label: 'Co-op rules',
    status: coopPack ? (coopPack.verified ? 'ok' : 'warn') : 'skipped',
    ms: 0,
    summary: !coopPack
      ? `No co-op pack on file for ${make} — no manufacturer advertising rules were checked.`
      : `${coopPack.make} ${coopPack.version} — ${split!.design.rules.length} layout rule(s) checked against the ` +
        `template, ${split!.content.rules.length} content rule(s) checked per ad${
          coopPack.verified ? '' : '. UNVERIFIED, so findings cannot block'
        }`,
    detail: coopPack
      ? {
          make: coopPack.make,
          version: coopPack.version,
          source: coopPack.source,
          verified: coopPack.verified,
          designRules: split!.design.rules,
          contentRules: split!.content.rules,
        }
      : undefined,
  });

  // The template's layout verdict, resolved through the same call production uses
  // so the two paths cannot diverge — a dry run that gated differently from
  // generate has already caused one contradiction (7 drafts vs "no eligible
  // offer"). `persist: false` keeps this function's no-writes promise; the verdict
  // is identical either way, only whether it's cached differs.
  let coopDesign: CoopDesignVerdict | null = null;
  if (coopEntry) {
    const v = await resolveTemplateCoopCheck({
      templateId: tpl.id,
      doc: tpl.doc,
      packId: coopEntry.id,
      pack: coopEntry.pack,
      persist: false,
    });
    coopDesign = {
      make: v.make,
      packVersion: v.packVersion,
      stale: false,
      findings: v.findings.map((f) => ({
        ruleId: f.ruleId,
        severity: f.severity,
        description: f.description,
        citation: f.citation,
        offerType: f.offerType,
      })),
    };
    steps.push({
      id: 'coop_template',
      label: 'Template layout check',
      status: v.ok ? (v.warningCount ? 'warn' : 'ok') : 'failed',
      ms: 0,
      summary: summarizeTemplateCoop(v) + (v.fresh ? ' (computed now)' : ' (cached)'),
      detail: { offerTypes: v.offerTypes, ruleCount: v.ruleCount, findings: v.findings },
    });
  }

  const pf = preflight({ doc: tpl.doc, data: renderData, oemRule, coopPack, coopDesign, sizeIds: input.sizeIds });
  steps.push({
    id: 'preflight',
    label: 'Preflight',
    status: pf.ok ? (pf.issues.length ? 'warn' : 'ok') : 'failed',
    ms: 0,
    summary: pf.ok
      ? `Passed — ${pf.boundFields.length} bound field(s) checked${
          pf.issues.length ? `, ${pf.issues.length} warning(s)` : ''
        }`
      : summarizePreflight(pf),
    detail: { ok: pf.ok, issues: pf.issues, boundFields: pf.boundFields, oemRule },
  });
  if (!pf.ok) return { ok: false, steps, previews: [] };

  // ── 9. Render ──
  const previews =
    (await step(steps, 'render', 'Render', async () => {
      // scale 1: a dry run streams PNGs back as base64 for the inspector, and
      // retina would quadruple that payload for no extra insight.
      const rendered = await renderCreativeSizes({
        doc: tpl.doc,
        data,
        accountKey: input.accountKey,
        sizeIds: input.sizeIds,
        scale: 1,
      });
      const out: DryRunPreview[] = rendered.map((r) => ({
        sizeId: r.sizeId,
        label: r.label,
        width: r.width,
        height: r.height,
        dataUrl: `data:image/png;base64,${r.png.toString('base64')}`,
      }));
      const kb = Math.round(rendered.reduce((n, r) => n + r.png.length, 0) / 1024);
      return { summary: `${rendered.length} size(s), ${kb} KB`, value: out };
    })) ?? [];

  return { ok: previews.length > 0, steps, previews };
}

function safeJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
