import { prisma } from '@/lib/prisma';
import { parseCoopPack, type CoopRule, type CoopRulePack } from './coop-rules';

/**
 * Loading co-op rule packs.
 *
 * Split from the pure evaluator so `coop-rules.ts` stays DB-free and trivially
 * testable. Server-only.
 *
 * Resilient by design: an unmigrated table, a corrupt pack, or no pack at all
 * all resolve to "no co-op checks". That's the right failure direction for
 * Phase 2 — the alternative (throwing) would take down generation for every
 * brand because one pack was malformed. The cost is that a missing pack is
 * silent, which is why {@link listCoopPacks} exists for the UI to show coverage.
 */

/**
 * The pack in force for `make` on `at`, or null.
 *
 * Selection: active, make-matched (case-insensitive), effective window contains
 * `at`, newest `effectiveFrom` first so a reissued pack supersedes its
 * predecessor without needing the old one deleted.
 */
export async function loadCoopPack(make: string, at = new Date()): Promise<CoopRulePack | null> {
  return (await loadActiveCoopPack(make, at))?.pack ?? null;
}

/**
 * As {@link loadCoopPack}, but also returns the ROW ID — and, like every loader
 * except {@link loadCoopPackForReview}, it withholds unreviewed proposals.
 *
 * The design-time template check is cached against the pack's id, not its make: a
 * make can have several packs (a superseded edition still queryable, a draft for
 * next quarter), and a verdict keyed on the make alone would be silently
 * overwritten when either changed.
 *
 * ── WHY THE FILTER LIVES HERE ──
 *
 * Once rules can be AI-drafted, the stored blob holds accepted rules mixed with
 * proposals. There are eight callers that act on rules, and filtering at each of
 * them is eight chances to forget — plus a ninth every time someone adds a caller.
 * Filtering in the loader makes the safe thing the default and leaves exactly one
 * function, named for the purpose, that can see a proposal.
 */
export async function loadActiveCoopPack(
  make: string,
  at = new Date(),
): Promise<{ id: string; pack: CoopRulePack } | null> {
  const entry = await loadCoopPackForReview(make, at);
  if (!entry) return null;
  return { id: entry.id, pack: splitByReviewState(entry.pack).accepted };
}

/**
 * THE UNFILTERED PACK — every rule, including unreviewed proposals.
 *
 * ONLY the review queue should call this. Everything that acts on rules — the
 * per-ad preflight, unattended generation, the design-time template check, launch
 * gating — must take {@link loadActiveCoopPack} instead, which withholds proposals.
 * The name is deliberately awkward so that reaching for it is a decision.
 */
export async function loadCoopPackForReview(
  make: string,
  at = new Date(),
): Promise<{ id: string; pack: CoopRulePack } | null> {
  const m = (make ?? '').trim();
  if (!m) return null;
  try {
    const rows = await prisma.adCoopRulePack.findMany({
      where: {
        make: { equals: m, mode: 'insensitive' },
        isActive: true,
        AND: [
          { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: at } }] },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] },
        ],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { updatedAt: 'desc' }],
      take: 1,
    });
    const row = rows[0];
    if (!row) return null;
    const pack = parseCoopPack(row.rules);
    if (!pack) {
      console.warn(`[coop-pack-store] pack ${row.make}/${row.version} is unparseable — skipping co-op checks`);
      return null;
    }
    // The ROW is authoritative for identity and verification, not the JSON blob:
    // someone editing the JSON must not be able to self-certify a pack as
    // verified, since verification means a human checked it against the source.
    return {
      id: row.id,
      pack: { ...pack, make: row.make, version: row.version, source: row.source ?? pack.source, verified: row.verified },
    };
  } catch (err) {
    console.warn('[coop-pack-store] lookup failed, continuing without co-op checks:', err);
    return null;
  }
}

export interface CoopPackSummary {
  id: string;
  make: string;
  version: string;
  source: string | null;
  verified: boolean;
  isActive: boolean;
  /** ACCEPTED rules — what actually gets enforced. */
  ruleCount: number;
  /** Drafted rules awaiting review. Enforced by nothing until accepted. */
  proposedCount: number;
  /**
   * ACCEPTED rules missing a citation — these can't be audited, so they're worth
   * surfacing. Proposals are excluded: a drafted rule always carries a verified
   * quote, and counting them here would report a problem that doesn't exist yet.
   */
  uncitedRuleCount: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  updatedAt: string;
}

/** Every pack, for a coverage view: which makes have one, and is it verified. */
export async function listCoopPacks(): Promise<CoopPackSummary[]> {
  try {
    const rows = await prisma.adCoopRulePack.findMany({ orderBy: [{ make: 'asc' }, { version: 'desc' }] });
    return rows.map((r) => {
      const pack = parseCoopPack(r.rules);
      const counts = pack ? splitByReviewState(pack) : null;
      const accepted = counts?.accepted ?? null;
      const rules = accepted?.rules ?? [];
      return {
        id: r.id,
        make: r.make,
        version: r.version,
        source: r.source,
        verified: r.verified,
        isActive: r.isActive,
        ruleCount: rules.length,
        proposedCount: counts?.proposedCount ?? 0,
        uncitedRuleCount: rules.filter((rule) => !rule.citation?.trim()).length,
        effectiveFrom: r.effectiveFrom?.toISOString() ?? null,
        effectiveTo: r.effectiveTo?.toISOString() ?? null,
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Makes that have on-lot stock or watched offers but NO co-op pack — the gap
 * list. Phase 3 must not generate unattended for a make on this list, because
 * "no pack" is indistinguishable from "no rules" to the evaluator, and the two
 * are very different when a co-op claim is at stake.
 */
export async function makesMissingCoopPack(accountKey?: string): Promise<string[]> {
  try {
    const [stock, packs] = await Promise.all([
      prisma.inventoryVehicle.findMany({
        where: { condition: 'new', soldAt: null, ...(accountKey ? { accountKey } : {}) },
        distinct: ['make'],
        select: { make: true },
      }),
      prisma.adCoopRulePack.findMany({ where: { isActive: true }, select: { make: true, rules: true } }),
    ]);
    // A pack whose rules are ALL unreviewed proposals enforces nothing, so it is not
    // coverage. Counting rows instead would tell unattended generation that a brand
    // was checked when nothing about it had been.
    const have = new Set(
      packs
        .filter((p) => {
          const pack = parseCoopPack(p.rules);
          return !!pack && splitByReviewState(pack).accepted.rules.length > 0;
        })
        .map((p) => p.make.trim().toLowerCase()),
    );
    return stock
      .map((s) => s.make)
      .filter((m) => m && !have.has(m.trim().toLowerCase()))
      .sort();
  } catch {
    return [];
  }
}

/**
 * A pack's rules split by review state. Pure, so the filtering rule is testable
 * without a database.
 *
 * ABSENT `reviewState` COUNTS AS ACCEPTED. Every rule transcribed by hand predates
 * the field, and the alternative — treating absence as unreviewed — would silently
 * switch off the only three packs that exist.
 */
export function splitByReviewState(pack: CoopRulePack): {
  accepted: CoopRulePack;
  proposedCount: number;
  rejectedCount: number;
} {
  const state = (r: CoopRule) => r.reviewState ?? 'accepted';
  return {
    accepted: { ...pack, rules: pack.rules.filter((r) => state(r) === 'accepted') },
    proposedCount: pack.rules.filter((r) => state(r) === 'proposed').length,
    rejectedCount: pack.rules.filter((r) => state(r) === 'rejected').length,
  };
}

/** The one document every drafted rule cites, or null if they disagree / none do. */
function soleSourceDocId(rules: CoopRule[]): string | null {
  const ids = new Set(rules.map((r) => r.sourceDocId).filter((id): id is string => !!id));
  return ids.size === 1 ? [...ids][0] : null;
}

export interface AcceptedCoopPack {
  /** The row id. `AdTemplateCoopCheck` caches against this, not the make. */
  packId: string;
  /** ACCEPTED rules only. Never contains a proposal. */
  pack: CoopRulePack;
  /** From the DB ROW, never the JSON blob — a hand-edited pack cannot self-certify. */
  verified: boolean;
  version: string;
  /**
   * The `AdGuidelineDoc` the pack was drafted from, when every drafted rule agrees
   * on one — enough to deep-link a rule into the reader.
   *
   * DERIVED from the rules, because `AdCoopRulePack` has no such column: it stores
   * `sourceAssetId` (a MediaAsset) and `sourceUrl`, which are not document ids. Null
   * for a hand-transcribed pack, which recorded no document link at all. A pack-level
   * column would be cleaner and is worth adding when drafted packs are first written;
   * deriving it avoids a migration for a field only drafted rules can populate.
   */
  sourceDocId: string | null;
  /**
   * Drafted rules awaiting review. Report the COUNT; never state what they say.
   *
   * ⚠️ NEVER DERIVE THIS BY SUBTRACTION. `total − accepted` folds REJECTED rules into
   * "awaiting review", which both overstates the queue and implies a rule someone has
   * already declined might still come back. A rejected rule HAS been reviewed. That is
   * why the two counts are returned separately rather than left to arithmetic.
   * (Found for real in a sibling implementation that computed pending that way.)
   */
  proposedCount: number;
}

/**
 * The pack as anything outside the review queue should see it.
 *
 * WHY THIS EXISTS RATHER THAN A FILTER AT EACH CALLER. Once rules can be
 * AI-drafted, `AdCoopRulePack.rules` holds a mixture of accepted rules and
 * unreviewed proposals. Any caller reading the blob directly will eventually
 * present a proposal as settled — a compliance check that blocks an ad on an
 * unreviewed rule, or an assistant that answers "Chevrolet requires X" citing one.
 * Both launder a draft into an authority. A filter every caller must remember is
 * the same defect with extra steps, so the filtering lives here and callers take
 * this instead.
 *
 * `proposedCount` is deliberately part of the return: "there are 3 drafted rules
 * awaiting review" is useful and safe, where the rules themselves are not.
 *
 * Resilient in the same way as {@link loadCoopPack} — an unmigrated or unreadable
 * table degrades to null, meaning "no checks", never a thrown request.
 */
export async function loadAcceptedCoopPack(
  make: string,
  at = new Date(),
): Promise<AcceptedCoopPack | null> {
  const active = await loadCoopPackForReview(make, at);
  if (!active) return null;
  const { accepted, proposedCount } = splitByReviewState(active.pack);
  return {
    packId: active.id,
    pack: accepted,
    // `loadActiveCoopPack` already overwrites this from the row; restated here so a
    // future change to either function can't quietly make the blob authoritative.
    verified: active.pack.verified === true,
    version: active.pack.version,
    sourceDocId: soleSourceDocId(accepted.rules),
    proposedCount,
  };
}
