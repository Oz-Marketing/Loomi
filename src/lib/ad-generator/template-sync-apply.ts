import { prisma } from '@/lib/prisma';
import { isS3Configured } from '@/lib/s3';
import { parseOemRule, type OemOfferRule } from './compliance';
import { loadActiveCoopPack } from './coop-pack-store';
import type { CoopRulePack } from './coop-rules';
import { resolveTemplateCoopCheck } from './coop-template-check-store';
import type { TemplateDoc } from './doc-types';
import { preflight, summarizePreflight, type CoopDesignVerdict } from './preflight';
import { mergeRenderData, renderCreativeSizes, renderCreativeToS3 } from './render-creative';
import { designHash, resolveSyncState } from './template-sync';
import type { AdData } from './types';

/**
 * Template → ad design sync: the side-effecting half.
 *
 * Pushing a template edit into an existing ad is NOT a doc copy. A template edit
 * can move an ad out of compliance — shrink a disclaimer below the co-op
 * legibility minimum and you have just made nine unclaimable ads, all of which
 * still look fine. So every ad is re-preflighted against the new design, and one
 * that fails KEEPS ITS CURRENT DESIGN and is reported, rather than being switched
 * to a design it can't legally render.
 *
 * The ad's `data` is never touched here. The design belongs to the template; the
 * values belong to the offer and to whoever filled them in.
 *
 * Server-only: reads the DB, launches Chromium, writes to S3.
 */

export type ApplyOutcome = 'updated' | 'blocked' | 'skipped_detached' | 'unchanged' | 'failed';

export interface ApplyResult {
  creativeId: string;
  name: string;
  outcome: ApplyOutcome;
  /** Why, for anything that isn't a plain `updated`. */
  detail?: string;
  /** Set when the ad was `ready` and had to be demoted for review. */
  demoted?: boolean;
  sizes?: number;
}

function safeJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseNotes(raw: string | null): string[] {
  const v = safeJson<unknown>(raw);
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return typeof raw === 'string' && raw.trim() ? [raw] : [];
}

/**
 * Per-make rule lookups, memoised for one apply pass.
 *
 * A template edit typically fans out to many ads of the SAME make, so without
 * this a 25-ad batch makes 25 identical round trips for the pack and 25 identical
 * design checks.
 */
export class RuleCache {
  private oem = new Map<string, OemOfferRule | null>();
  private packs = new Map<string, { id: string; pack: CoopRulePack } | null>();
  private designs = new Map<string, CoopDesignVerdict | null>();

  constructor(private now: Date) {}

  async oemRule(make: string): Promise<OemOfferRule | null> {
    const key = make.toLowerCase();
    if (this.oem.has(key)) return this.oem.get(key) ?? null;
    let rule: OemOfferRule | null = null;
    try {
      const row = await prisma.adOemOfferRule.findFirst({
        where: { make: { equals: make, mode: 'insensitive' }, isActive: true },
      });
      rule = row ? parseOemRule(row.make, row.requiredFields, row.defaultValues) : null;
    } catch {
      rule = null;
    }
    this.oem.set(key, rule);
    return rule;
  }

  async coopPack(make: string): Promise<{ id: string; pack: CoopRulePack } | null> {
    const key = make.toLowerCase();
    if (this.packs.has(key)) return this.packs.get(key) ?? null;
    const entry = await loadActiveCoopPack(make, this.now);
    this.packs.set(key, entry);
    return entry;
  }

  async designVerdict(
    templateId: string,
    doc: TemplateDoc,
    entry: { id: string; pack: CoopRulePack } | null,
  ): Promise<CoopDesignVerdict | null> {
    if (!entry) return null;
    const key = `${templateId}::${entry.id}`;
    if (this.designs.has(key)) return this.designs.get(key) ?? null;
    let verdict: CoopDesignVerdict | null = null;
    try {
      const v = await resolveTemplateCoopCheck({ templateId, doc, packId: entry.id, pack: entry.pack });
      verdict = {
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
    } catch (err) {
      // Same failure direction as generation: a broken design check must not stop
      // a legitimate sync for every brand.
      console.warn(`[template-sync] design co-op check failed for ${templateId}:`, err);
    }
    this.designs.set(key, verdict);
    return verdict;
  }
}

export interface ApplyOptions {
  /** Force the push even though the ad is detached (the explicit per-ad reset). */
  force?: boolean;
  /** Which sizes to render. Defaults to every size the new doc defines. */
  sizeIds?: string[];
  now?: Date;
}

/**
 * Push `doc` into one ad.
 *
 * Returns rather than throws for every expected refusal, because the caller is a
 * batch that must report per-ad outcomes — one non-compliant ad can't abort the
 * other twenty-four.
 */
export async function applyTemplateDocToCreative(
  creativeId: string,
  templateDoc: TemplateDoc,
  opts: ApplyOptions = {},
  cache = new RuleCache(opts.now ?? new Date()),
): Promise<ApplyResult> {
  const row = await prisma.adCreative
    .findUnique({
      where: { id: creativeId },
      select: {
        id: true,
        name: true,
        accountKey: true,
        templateId: true,
        doc: true,
        data: true,
        status: true,
        autoGenerated: true,
        templateSync: true,
        templateDocHash: true,
        reviewNotes: true,
      },
    })
    .catch(() => null);
  if (!row) return { creativeId, name: '', outcome: 'failed', detail: 'Ad not found.' };

  if (!opts.force && resolveSyncState(row) === 'detached') {
    return {
      creativeId,
      name: row.name,
      outcome: 'skipped_detached',
      detail: 'This ad has been customized, so it keeps its own design.',
    };
  }

  const nextHash = designHash(templateDoc);
  // Already on this design — measured from the ad's own doc, so an ad that
  // predates the hash column isn't re-rendered just because the column is null.
  const ownDoc = safeJson<TemplateDoc>(row.doc);
  const ownHash = ownDoc ? designHash(ownDoc) : row.templateDocHash;
  if (ownHash === nextHash) {
    // Record the hash anyway: it costs one small write and stops this ad being
    // re-examined on every future pass.
    if (row.templateDocHash !== nextHash) {
      await prisma.adCreative
        .update({ where: { id: row.id }, data: { templateDocHash: nextHash } })
        .catch(() => null);
    }
    return { creativeId, name: row.name, outcome: 'unchanged' };
  }

  const data = safeJson<AdData>(row.data) ?? ({} as AdData);
  // The make drives which OEM + co-op rules apply. The ad's own value wins over
  // the template's: a shared multi-make plate carries no make of its own.
  const make = (data.make ?? templateDoc.make ?? '').trim();
  const oemRule = make ? await cache.oemRule(make) : null;
  const coopEntry = make ? await cache.coopPack(make) : null;
  const coopDesign = await cache.designVerdict(row.templateId, templateDoc, coopEntry);

  const docSizeIds = templateDoc.sizes.map((s) => s.id);
  const wanted = opts.sizeIds?.length ? docSizeIds.filter((id) => opts.sizeIds!.includes(id)) : [];
  const renderSizeIds = wanted.length ? wanted : undefined;

  const renderData = mergeRenderData(templateDoc, data);
  const pf = preflight({
    doc: templateDoc,
    data: renderData,
    oemRule,
    coopPack: coopEntry?.pack ?? null,
    coopDesign,
    sizeIds: renderSizeIds,
  });

  if (!pf.ok) {
    // The ad keeps its working design. Demote a `ready` ad, because the template
    // it is supposed to represent has moved away from it and a person needs to
    // decide which one is right.
    const reason = `Template update not applied — the new design fails preflight for this ad: ${summarizePreflight(pf)}`;
    const notes = [...parseNotes(row.reviewNotes).filter((n) => !n.startsWith('Template update not applied')), reason];
    const demoted = row.status === 'ready';
    try {
      await prisma.adCreative.update({
        where: { id: row.id },
        data: { reviewNotes: JSON.stringify(notes), ...(demoted ? { status: 'draft' } : {}) },
      });
    } catch (err) {
      console.warn(`[template-sync] could not record block on ${row.id}:`, err);
    }
    // templateDocHash is deliberately left alone: the ad is still behind, so the
    // prompt keeps offering the update once the template is fixed.
    return { creativeId: row.id, name: row.name, outcome: 'blocked', detail: reason, demoted };
  }

  // ── render ──
  // As in generation, rasterizing IS the proof the ad can be produced from the
  // new design; the stored PNG is only a thumbnail convenience, since the ad
  // stores its own doc + data and is re-renderable on demand.
  let thumbnailUrl: string | null = null;
  let sizes = 0;
  try {
    if (isS3Configured()) {
      const persisted = await renderCreativeToS3({
        creativeId: row.id,
        doc: templateDoc,
        data,
        accountKey: row.accountKey,
        sizeIds: renderSizeIds,
      });
      thumbnailUrl = persisted[0]?.url ?? null;
      sizes = persisted.length;
    } else {
      sizes = (
        await renderCreativeSizes({
          doc: templateDoc,
          data,
          accountKey: row.accountKey,
          sizeIds: renderSizeIds,
        })
      ).length;
    }
  } catch (err) {
    return {
      creativeId: row.id,
      name: row.name,
      outcome: 'failed',
      detail: err instanceof Error ? err.message : 'Unknown render error',
    };
  }

  const warnings = pf.issues.filter((i) => i.severity === 'warning').map((i) => i.message);
  try {
    await prisma.adCreative.update({
      where: { id: row.id },
      data: {
        doc: JSON.stringify(templateDoc),
        templateDocHash: nextHash,
        // An explicit re-link (force on a detached ad) makes it follow again —
        // otherwise the next template edit would silently skip it and the user
        // would have to reset it every single time.
        templateSync: 'synced',
        docEditedAt: opts.force ? null : undefined,
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
        reviewNotes: warnings.length ? JSON.stringify(warnings) : null,
      },
    });
  } catch (err) {
    return {
      creativeId: row.id,
      name: row.name,
      outcome: 'failed',
      detail: err instanceof Error ? err.message : 'Could not save the updated ad',
    };
  }

  return { creativeId: row.id, name: row.name, outcome: 'updated', sizes };
}

/**
 * Push a template's design into several ads, one at a time.
 *
 * Sequential on purpose: each ad is a Chromium render, and running a batch of
 * them concurrently on a 2-vCPU droplet is how you turn a sync into an outage.
 */
export async function applyTemplateDocToCreatives(
  creativeIds: string[],
  templateDoc: TemplateDoc,
  opts: ApplyOptions = {},
): Promise<ApplyResult[]> {
  const cache = new RuleCache(opts.now ?? new Date());
  const out: ApplyResult[] = [];
  for (const id of creativeIds) {
    try {
      out.push(await applyTemplateDocToCreative(id, templateDoc, opts, cache));
    } catch (err) {
      out.push({
        creativeId: id,
        name: '',
        outcome: 'failed',
        detail: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }
  return out;
}
