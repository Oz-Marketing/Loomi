import { prisma } from '@/lib/prisma';
import { parseCoopPack, type CoopRulePack } from './coop-rules';

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
    return { ...pack, make: row.make, version: row.version, source: row.source ?? pack.source, verified: row.verified };
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
  ruleCount: number;
  /** Rules missing a citation — these can't be audited, so they're worth surfacing. */
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
      const rules = pack?.rules ?? [];
      return {
        id: r.id,
        make: r.make,
        version: r.version,
        source: r.source,
        verified: r.verified,
        isActive: r.isActive,
        ruleCount: rules.length,
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
      prisma.adCoopRulePack.findMany({ where: { isActive: true }, select: { make: true } }),
    ]);
    const have = new Set(packs.map((p) => p.make.trim().toLowerCase()));
    return stock
      .map((s) => s.make)
      .filter((m) => m && !have.has(m.trim().toLowerCase()))
      .sort();
  } catch {
    return [];
  }
}
