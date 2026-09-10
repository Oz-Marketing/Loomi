import { prisma } from '@/lib/prisma';
import { isS3Configured } from '@/lib/s3';
import { parseOemRule, type OemOfferRule } from './compliance';
import { loadActiveCoopPack } from './coop-pack-store';
import type { CoopRulePack } from './coop-rules';
import { resolveTemplateCoopCheck } from './coop-template-check-store';
import type { TemplateDoc } from './doc-types';
import { previewSizeId } from './automation/plan-variants';
import { preflight, summarizePreflight, type CoopDesignVerdict } from './preflight';
import { openAdRenderSession, type AdRenderSession } from './render';
import { mergeRenderData, renderCreativeSizes, renderCreativeToS3 } from './render-creative';
import { designHash, resolveSyncState } from './template-sync';
import { vehicleFromData } from './vehicle-fields';
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
  /**
   * This ad failed IN THE RENDERER, as opposed to a lookup or a write.
   *
   * The batch shares one Chromium, and a browser that dies takes every later ad
   * with it unless it is replaced — so the batch uses this to throw the session
   * away and open a fresh one. Narrower than `outcome === 'failed'` on purpose:
   * an ad that was simply not found says nothing about the browser's health, and
   * relaunching over it would pay a second of launch for no reason.
   */
  renderFailed?: boolean;
}

/**
 * How long one ad's render may take before the run gives up on it.
 *
 * Generous — a size measures well under a second locally and a remote vehicle
 * photo adds at most the renderer's own 8-second image wait — so reaching this
 * does not mean "slow", it means wedged.
 *
 * It has to exist. `page.screenshot()` takes no timeout, and under real resource
 * pressure it can simply never return: reproduced here with several Chromium
 * instances competing, where the screenshot hung indefinitely while the same
 * page rendered in 74 ms once the machine was clear. Nothing downstream would
 * have caught it. The web request that used to wrap this work at least died with
 * nginx; a worker job has no such backstop, so 24 ads sat at 0 processed with
 * the queue entry held `active` until pg-boss expired it an hour later.
 */
const RENDER_TIMEOUT_MS = 120_000;

/**
 * Bound a render, and make sure abandoning it stays quiet.
 *
 * The losing promise is deliberately given a `catch`: it rejects later, when the
 * recycled browser closes underneath it, and an unhandled rejection there would
 * take the whole worker process down — the one outcome worse than a failed ad.
 */
async function withRenderTimeout<T>(work: Promise<T>, ms = RENDER_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Rendering did not finish within ${Math.round(ms / 1000)}s, so this ad was left alone.`)),
      ms,
    );
  });
  try {
    return await Promise.race([work, guard]);
  } finally {
    if (timer) clearTimeout(timer);
    void work.catch(() => {});
  }
}

/** Per-outcome tallies for a run, in the shape the dialog and the run row use. */
export interface ApplyTally {
  updated: number;
  blocked: number;
  failed: number;
  skipped: number;
}

/**
 * Reduce results to counts.
 *
 * One place, because the progress row, the finished dialog and the completion
 * notification all show these numbers and two of them disagreeing would read as
 * ads going missing. `skipped` folds `unchanged` in with `skipped_detached`:
 * both mean "we left this ad exactly as it was", which is the only distinction
 * a tally needs to carry.
 */
export function summarizeApplyResults(results: ApplyResult[]): ApplyTally {
  const tally: ApplyTally = { updated: 0, blocked: 0, failed: 0, skipped: 0 };
  for (const r of results) {
    if (r.outcome === 'updated') tally.updated += 1;
    else if (r.outcome === 'blocked') tally.blocked += 1;
    else if (r.outcome === 'failed') tally.failed += 1;
    else tally.skipped += 1;
  }
  return tally;
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
  /**
   * Which sizes to render. Defaults to the ONE preview size (see
   * {@link syncRenderSizeIds}), not to every size the doc defines.
   */
  sizeIds?: string[];
  now?: Date;
  /** Render on a Chromium the caller owns — see `RenderCreativeInput.session`. */
  session?: AdRenderSession;
  /**
   * Called after each ad, so a long run can report progress while it is still
   * running. Failures here are swallowed: reporting must never fail the work
   * it is reporting on.
   */
  onResult?: (result: ApplyResult) => void | Promise<void>;
}

/**
 * Which sizes a sync re-renders. ONE size, the squarest, unless told otherwise.
 *
 * The old default was "every size the doc defines", and that is what made this
 * feature unusable: a 9-size template pushed to 214 ads is 1,926 retina
 * screenshots and 1,926 uploads, which no HTTP request can survive and which
 * spends minutes of Chromium on artifacts nothing reads.
 *
 * Because nothing does read them. The stored PNGs are a thumbnail (`persisted[0]`)
 * and nothing else: launching to Meta, the ZIP export, the launch kit and the ad
 * detail preview all re-render from the ad's own stored doc. So a size rendered
 * here is written to S3 and never fetched.
 *
 * The proof-of-renderability argument for rasterizing is answered the same way
 * generation answers it — `previewSizeId` there, this here — because `preflight`
 * checks EVERY size statically and costs nothing. What one render leaves
 * uncovered is genuine rasterizer failure at some other size, which surfaces at
 * pick time and is reported loudly there.
 */
export function syncRenderSizeIds(doc: TemplateDoc, sizeIds?: string[]): string[] | undefined {
  const defined = doc.sizes.map((s) => s.id);
  if (sizeIds?.length) {
    const wanted = defined.filter((id) => sizeIds.includes(id));
    // A caller naming nothing this design has is a misconfiguration, not a
    // reason to render nothing — same fallback as generation and the pick.
    if (wanted.length) return wanted;
  }
  const preview = previewSizeId(doc);
  return preview ? [preview] : undefined;
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
  //
  // Read through vehicleFromData, NOT `data.make` — the stored key is `_vehMake`.
  // Getting this wrong silently disables the manufacturer half of the re-preflight
  // below, because an empty make reads as "no rules apply" everywhere.
  const make = (vehicleFromData(data).make || templateDoc.make || '').trim();
  const oemRule = make ? await cache.oemRule(make) : null;
  const coopEntry = make ? await cache.coopPack(make) : null;
  const coopDesign = await cache.designVerdict(row.templateId, templateDoc, coopEntry);

  const renderSizeIds = syncRenderSizeIds(templateDoc, opts.sizeIds);

  const renderData = mergeRenderData(templateDoc, data);
  // Deliberately NOT narrowed to `renderSizeIds`. Preflight is a static check
  // over the whole design, so it costs nothing to run wide, and rendering one
  // size must never shrink what gets CHECKED — that would let a template edit
  // break the legibility minimum on a leaderboard and still report compliant.
  // Generation makes the same split for the same reason.
  const pf = preflight({
    doc: templateDoc,
    data: renderData,
    oemRule,
    coopPack: coopEntry?.pack ?? null,
    coopDesign,
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
      const persisted = await withRenderTimeout(
        renderCreativeToS3({
          creativeId: row.id,
          doc: templateDoc,
          data,
          accountKey: row.accountKey,
          sizeIds: renderSizeIds,
          session: opts.session,
        }),
      );
      thumbnailUrl = persisted[0]?.url ?? null;
      sizes = persisted.length;
    } else {
      sizes = (
        await withRenderTimeout(
          renderCreativeSizes({
            doc: templateDoc,
            data,
            accountKey: row.accountKey,
            sizeIds: renderSizeIds,
            session: opts.session,
          }),
        )
      ).length;
    }
  } catch (err) {
    return {
      creativeId: row.id,
      name: row.name,
      outcome: 'failed',
      detail: err instanceof Error ? err.message : 'Unknown render error',
      renderFailed: true,
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
 * them concurrently is how you turn a sync into an outage — the web process is
 * capped at 1536 MB and one retina screenshot costs 60-80 MB of transient CDP
 * buffers.
 *
 * ONE browser for the whole run. `renderAdBatch` launches and closes its own
 * Chromium per call, so this used to pay a launch (~1s, and more under load) for
 * every single ad. The session is opened here and closed in `finally`, including
 * on the throw path, or the Chromium process leaks.
 */
export async function applyTemplateDocToCreatives(
  creativeIds: string[],
  templateDoc: TemplateDoc,
  opts: ApplyOptions = {},
): Promise<ApplyResult[]> {
  const cache = new RuleCache(opts.now ?? new Date());
  const out: ApplyResult[] = [];

  // A caller that already holds a session keeps ownership of it; otherwise this
  // run owns the one it opens, and only an owned session may be recycled.
  const borrowed = opts.session ?? null;
  // A holder rather than a bare `let`: the assignments below happen inside
  // nested functions, which TypeScript's flow analysis cannot see, so a plain
  // local would still read as `null` in the `finally` and the close would be
  // typed away as unreachable.
  const held: { session: AdRenderSession | null } = { session: null };

  /** Open lazily, so a run of zero ads never launches a browser. */
  async function liveSession(): Promise<AdRenderSession> {
    if (!held.session) held.session = await openAdRenderSession();
    return held.session;
  }

  /**
   * Throw away a browser that has died, so the next ad gets a fresh one.
   *
   * Without this, sharing one Chromium across the run traded a real property
   * away: a crash used to cost the ONE ad that was mid-render, because every ad
   * launched its own browser. Shared, a dead target makes every later ad fail
   * with "Session closed" — observed, three ads in, on the first live run of
   * this code. A relaunch is about a second and only happens after a render has
   * actually failed.
   */
  async function recycle(): Promise<void> {
    const dead = held.session;
    held.session = null;
    if (dead) await dead.close().catch(() => {});
  }

  try {
    for (const id of creativeIds) {
      let result: ApplyResult;
      try {
        const session = borrowed ?? (await liveSession());
        result = await applyTemplateDocToCreative(id, templateDoc, { ...opts, session }, cache);
      } catch (err) {
        // Reaching here means the browser would not start at all, or the apply
        // threw outside its own handling. Reported against this ad and the run
        // carries on: the next ad retries the launch, which is what makes a
        // transient Chromium failure self-heal instead of ending the run.
        result = {
          creativeId: id,
          name: '',
          outcome: 'failed',
          detail: err instanceof Error ? err.message : 'Unknown error',
          renderFailed: true,
        };
      }
      if (result.renderFailed && !borrowed) await recycle();

      out.push(result);
      if (opts.onResult) {
        // Progress reporting must never fail the work it reports on.
        try {
          await opts.onResult(result);
        } catch (err) {
          console.warn('[template-sync] progress callback failed:', err);
        }
      }
    }
  } finally {
    if (held.session) await held.session.close().catch(() => {});
  }
  return out;
}
