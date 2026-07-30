import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { TemplateDoc } from './doc-types';
import type { CoopRulePack } from './coop-rules';
import {
  checkTemplateCoop,
  templateDocShape,
  type TemplateCoopFinding,
  type TemplateCoopVerdict,
} from './coop-template-check';

/**
 * Persistence for design-time co-op verdicts.
 *
 * Split from the pure checker so `coop-template-check.ts` stays DB-free and
 * node-free. Server-only.
 *
 * The cached verdict is keyed on (templateId, packId) and carries the template's
 * shape hash. A cache entry is STALE when the shape hash moved (someone edited the
 * design) or the pack version moved (co-op reissued the rules). Anything else is a
 * hit, which is the normal case — a template's standing genuinely does not change
 * between two ads generated the same morning.
 *
 * Failure direction matches `coop-pack-store`: an unmigrated table or a write
 * failure degrades to "compute it fresh and don't cache", never to a throw that
 * would take down generation for every brand.
 */

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function docHashFor(doc: TemplateDoc): string {
  return sha256Hex(templateDocShape(doc));
}

export interface CachedVerdict extends TemplateCoopVerdict {
  /** True when this was computed now rather than read from cache. */
  fresh: boolean;
  checkedAt: Date;
  checkedBy: string | null;
}

interface ResolveArgs {
  templateId: string;
  doc: TemplateDoc;
  packId: string;
  pack: CoopRulePack;
  /** Force a recompute even on a cache hit — for the "re-check" button. */
  force?: boolean;
  /** Who asked, when a person did. Null for automated runs. */
  checkedBy?: string | null;
  /**
   * Write the computed verdict back to the cache. The dry run passes false: it
   * promises to write nothing, and the VERDICT is identical either way — only
   * whether it's remembered differs, so honouring that promise costs nothing.
   */
  persist?: boolean;
}

/**
 * The template's standing against this pack, computed if absent or stale.
 *
 * Writes through so the next run and the UI see the same verdict — the alternative
 * (compute per run, never persist) would leave the designer with no way to see a
 * failure except by triggering a generation.
 */
export async function resolveTemplateCoopCheck({
  templateId,
  doc,
  packId,
  pack,
  force = false,
  checkedBy = null,
  persist = true,
}: ResolveArgs): Promise<CachedVerdict> {
  const docHash = docHashFor(doc);

  if (!force) {
    const cached = await readCheck(templateId, packId);
    if (cached && cached.docHash === docHash && cached.packVersion === pack.version) {
      return {
        make: pack.make,
        packVersion: cached.packVersion,
        ok: cached.ok,
        errorCount: cached.errorCount,
        warningCount: cached.warningCount,
        findings: cached.findings,
        offerTypes: cached.offerTypes,
        ruleCount: cached.ruleCount,
        fresh: false,
        checkedAt: cached.checkedAt,
        checkedBy: cached.checkedBy,
      };
    }
  }

  const verdict = checkTemplateCoop(doc, pack);
  const checkedAt = new Date();
  if (persist) await writeCheck({ templateId, packId, docHash, verdict, checkedBy, checkedAt });
  return { ...verdict, fresh: true, checkedAt, checkedBy };
}

interface StoredCheck {
  docHash: string;
  packVersion: string;
  ok: boolean;
  errorCount: number;
  warningCount: number;
  findings: TemplateCoopFinding[];
  offerTypes: string[];
  ruleCount: number;
  checkedAt: Date;
  checkedBy: string | null;
}

/** Findings blob shape — offerTypes/ruleCount ride along so a cache hit can
 *  reconstruct the whole verdict without re-deriving it from the doc. */
interface FindingsBlob {
  findings?: TemplateCoopFinding[];
  offerTypes?: string[];
  ruleCount?: number;
}

async function readCheck(templateId: string, packId: string): Promise<StoredCheck | null> {
  try {
    const row = await prisma.adTemplateCoopCheck.findUnique({
      where: { templateId_packId: { templateId, packId } },
    });
    if (!row) return null;
    let blob: FindingsBlob = {};
    try {
      blob = JSON.parse(row.findings) as FindingsBlob;
    } catch {
      // A corrupt blob must read as a miss, not as a pass.
      return null;
    }
    return {
      docHash: row.docHash,
      packVersion: row.packVersion,
      ok: row.ok,
      errorCount: row.errorCount,
      warningCount: row.warningCount,
      findings: Array.isArray(blob.findings) ? blob.findings : [],
      offerTypes: Array.isArray(blob.offerTypes) ? blob.offerTypes : [],
      ruleCount: typeof blob.ruleCount === 'number' ? blob.ruleCount : 0,
      checkedAt: row.checkedAt,
      checkedBy: row.checkedBy,
    };
  } catch {
    return null;
  }
}

async function writeCheck(args: {
  templateId: string;
  packId: string;
  docHash: string;
  verdict: TemplateCoopVerdict;
  checkedBy: string | null;
  checkedAt: Date;
}): Promise<void> {
  const { templateId, packId, docHash, verdict, checkedBy, checkedAt } = args;
  const data = {
    templateId,
    make: verdict.make,
    packId,
    packVersion: verdict.packVersion,
    docHash,
    ok: verdict.ok,
    errorCount: verdict.errorCount,
    warningCount: verdict.warningCount,
    findings: JSON.stringify({
      findings: verdict.findings,
      offerTypes: verdict.offerTypes,
      ruleCount: verdict.ruleCount,
    }),
    checkedBy,
    checkedAt,
  };
  try {
    await prisma.adTemplateCoopCheck.upsert({
      where: { templateId_packId: { templateId, packId } },
      create: data,
      update: data,
    });
  } catch (err) {
    // Losing the cache write is survivable — the verdict was still computed and is
    // being returned. Losing generation over it would not be.
    console.warn('[coop-template-check-store] could not persist verdict:', err);
  }
}

export interface TemplateCheckRow {
  templateId: string;
  make: string;
  packId: string;
  packVersion: string;
  ok: boolean;
  errorCount: number;
  warningCount: number;
  findings: TemplateCoopFinding[];
  offerTypes: string[];
  ruleCount: number;
  checkedAt: string;
  checkedBy: string | null;
}

/** Every stored verdict for a make, for the guidelines page. */
export async function listTemplateChecks(make?: string): Promise<TemplateCheckRow[]> {
  try {
    const rows = await prisma.adTemplateCoopCheck.findMany({
      where: make ? { make: { equals: make, mode: 'insensitive' } } : undefined,
      orderBy: [{ make: 'asc' }, { templateId: 'asc' }],
    });
    return rows.map((r) => {
      let blob: FindingsBlob = {};
      try {
        blob = JSON.parse(r.findings) as FindingsBlob;
      } catch {
        blob = {};
      }
      return {
        templateId: r.templateId,
        make: r.make,
        packId: r.packId,
        packVersion: r.packVersion,
        ok: r.ok,
        errorCount: r.errorCount,
        warningCount: r.warningCount,
        findings: Array.isArray(blob.findings) ? blob.findings : [],
        offerTypes: Array.isArray(blob.offerTypes) ? blob.offerTypes : [],
        ruleCount: typeof blob.ruleCount === 'number' ? blob.ruleCount : 0,
        checkedAt: r.checkedAt.toISOString(),
        checkedBy: r.checkedBy,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Drop cached verdicts for a pack. Called when a pack is re-seeded or its
 * verification flag flips, since `verified` changes whether findings block and the
 * version alone may not have moved.
 */
export async function invalidatePackChecks(packId: string): Promise<number> {
  try {
    const res = await prisma.adTemplateCoopCheck.deleteMany({ where: { packId } });
    return res.count;
  } catch {
    return 0;
  }
}
