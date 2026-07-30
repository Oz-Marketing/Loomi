import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { createNotification } from '@/lib/notifications/service';

/**
 * The guideline document register — the mechanism that keeps co-op rules honest.
 *
 * ── WHY THIS AND NOT AUTOMATIC RULE EXTRACTION ──
 *
 * The obvious answer to "the guidelines change, how do the rules keep up" is to
 * parse the new document and regenerate the rules. That was designed and rejected,
 * for reasons worth recording so it isn't rebuilt by reflex:
 *
 *   • It solves the wrong-sized problem. Documents are reissued once or twice a
 *     year per brand. That's a couple of notifications, not a pipeline.
 *   • Extraction cannot be trusted unreviewed. A hand transcription of Mazda §5d
 *     was wrong in a way that would have failed a lockup with a spotless approval
 *     record. Automated extraction has the same failure mode at higher volume, so
 *     it still needs a human gate — and then the pipeline has bought very little.
 *   • The failure directions are asymmetric. A missed rule costs a resubmission.
 *     A WRONG rule silently costs a brand its entire month of ads. Fewer rules
 *     with a human behind them is the safer trade.
 *
 * What actually matters is knowing the document MOVED. That's a hash comparison:
 * exact, cheap, and impossible to be subtly wrong about. A person then decides what
 * changed and whether any template needs work.
 *
 * So this module tracks documents, not rules. `contentHash` is what the document
 * says now; `reviewedHash` is what it said when someone last checked. When they
 * differ, the register says so and names the make.
 *
 * Server-only.
 */

/** How long to trust a fetched hash before re-checking a URL-backed document. */
export const RECHECK_AFTER_HOURS = 24;

export type DocState =
  /** Registered but never successfully fetched — nothing to compare yet. */
  | 'unfetched'
  /** Fetched, but no one has reviewed it against the templates. */
  | 'unreviewed'
  /** Reviewed, and the bytes haven't moved since. */
  | 'current'
  /** The document changed after it was reviewed. Someone needs to look. */
  | 'changed'
  /** The last fetch failed. Explicitly NOT 'current' — a 404 is not reassurance. */
  | 'unreachable';

export interface GuidelineDocRow {
  id: string;
  make: string;
  title: string;
  sourceUrl: string | null;
  sourceAssetId: string | null;
  contentHash: string | null;
  byteSize: number | null;
  reviewedHash: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  checkedAt: string | null;
  checkError: string | null;
  isActive: boolean;
  updatedAt: string;
  state: DocState;
  summary: string;
}

/**
 * Classify one document. Pure — takes no clock and no DB, so the state machine is
 * testable without either.
 *
 * Order matters: an unreachable document is reported as unreachable even if it was
 * reviewed, because "we can no longer see the source our rules cite" is the more
 * important fact.
 */
export function docState(row: {
  contentHash: string | null;
  reviewedHash: string | null;
  checkError: string | null;
}): { state: DocState; summary: string } {
  if (row.checkError) {
    return {
      state: 'unreachable',
      summary: `Last fetch failed: ${row.checkError}. The cited source can't be opened.`,
    };
  }
  if (!row.contentHash) {
    return { state: 'unfetched', summary: 'Registered but not yet fetched — no baseline to compare against.' };
  }
  if (!row.reviewedHash) {
    return {
      state: 'unreviewed',
      summary: 'Never reviewed. Check the templates against it, then mark it reviewed to set the baseline.',
    };
  }
  if (row.reviewedHash !== row.contentHash) {
    return {
      state: 'changed',
      summary: 'CHANGED since it was last reviewed. Re-check the templates for this make, then mark it reviewed.',
    };
  }
  return { state: 'current', summary: 'Unchanged since it was last reviewed.' };
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function toRow(r: {
  id: string;
  make: string;
  title: string;
  sourceUrl: string | null;
  sourceAssetId: string | null;
  contentHash: string | null;
  byteSize: number | null;
  reviewedHash: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  checkedAt: Date | null;
  checkError: string | null;
  isActive: boolean;
  updatedAt: Date;
}): GuidelineDocRow {
  const { state, summary } = docState(r);
  return {
    id: r.id,
    make: r.make,
    title: r.title,
    sourceUrl: r.sourceUrl,
    sourceAssetId: r.sourceAssetId,
    contentHash: r.contentHash,
    byteSize: r.byteSize,
    reviewedHash: r.reviewedHash,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    reviewNotes: r.reviewNotes,
    checkedAt: r.checkedAt?.toISOString() ?? null,
    checkError: r.checkError,
    isActive: r.isActive,
    updatedAt: r.updatedAt.toISOString(),
    state,
    summary,
  };
}

/** Every registered document, newest-changed first so problems surface at the top. */
export async function listGuidelineDocs(make?: string): Promise<GuidelineDocRow[]> {
  try {
    const rows = await prisma.adGuidelineDoc.findMany({
      where: make ? { make: { equals: make, mode: 'insensitive' } } : undefined,
      orderBy: [{ make: 'asc' }, { title: 'asc' }],
    });
    return rows.map(toRow);
  } catch {
    return [];
  }
}

export interface RegisterArgs {
  make: string;
  title: string;
  sourceUrl?: string | null;
  sourceAssetId?: string | null;
  /** Bytes, when the caller already has them (an upload). Hashed immediately. */
  bytes?: Uint8Array | null;
  createdBy?: string | null;
}

/**
 * Register or update a document.
 *
 * Deliberately does NOT touch `reviewedHash`. Re-registering the same document with
 * new bytes must leave the old review baseline in place — that's precisely what
 * makes the change detectable. Clearing it here would erase the signal at the exact
 * moment it appears.
 */
export async function registerGuidelineDoc(args: RegisterArgs): Promise<GuidelineDocRow | null> {
  const make = args.make.trim();
  const title = args.title.trim();
  if (!make || !title) return null;

  const hashed = args.bytes ? { contentHash: hashBytes(args.bytes), byteSize: args.bytes.byteLength } : {};
  const base = {
    sourceUrl: args.sourceUrl?.trim() || null,
    sourceAssetId: args.sourceAssetId?.trim() || null,
    ...hashed,
    ...(args.bytes ? { checkedAt: new Date(), checkError: null } : {}),
  };

  try {
    const row = await prisma.adGuidelineDoc.upsert({
      where: { make_title: { make, title } },
      create: { make, title, ...base, createdBy: args.createdBy ?? null },
      update: base,
    });
    return toRow(row);
  } catch (err) {
    console.warn('[guideline-docs] register failed:', err);
    return null;
  }
}

/** Record that a person checked this document's current bytes against the templates. */
export async function markReviewed(
  id: string,
  reviewedBy: string,
  notes?: string | null,
): Promise<GuidelineDocRow | null> {
  try {
    const existing = await prisma.adGuidelineDoc.findUnique({ where: { id } });
    if (!existing) return null;
    // Baseline against what the document says NOW. Reviewing an unfetched document
    // would pin the baseline to null and permanently suppress the change signal.
    if (!existing.contentHash) return toRow(existing);
    const row = await prisma.adGuidelineDoc.update({
      where: { id },
      data: {
        reviewedHash: existing.contentHash,
        reviewedBy,
        reviewedAt: new Date(),
        reviewNotes: notes?.trim() || null,
      },
    });
    return toRow(row);
  } catch (err) {
    console.warn('[guideline-docs] markReviewed failed:', err);
    return null;
  }
}

export interface RefreshResult {
  checked: number;
  changed: string[];
  failed: string[];
  skipped: number;
}

/**
 * Re-fetch every URL-backed document and re-hash it.
 *
 * HEAD would be cheaper but is not trustworthy here: many document hosts (Drive,
 * SharePoint, CDN-fronted portals) return no useful validator, or a Last-Modified
 * that moves when nothing did. Hashing the bytes is the only comparison that can't
 * be subtly wrong, and at ~35 documents a day the cost is irrelevant.
 */
export async function refreshGuidelineDocs(
  now = new Date(),
  opts: { force?: boolean } = {},
): Promise<RefreshResult> {
  const out: RefreshResult = { checked: 0, changed: [], failed: [], skipped: 0 };
  let rows: {
    id: string;
    make: string;
    title: string;
    sourceUrl: string | null;
    contentHash: string | null;
    reviewedHash: string | null;
    checkedAt: Date | null;
  }[] = [];
  try {
    rows = await prisma.adGuidelineDoc.findMany({
      where: { isActive: true, sourceUrl: { not: null } },
      select: {
        id: true,
        make: true,
        title: true,
        sourceUrl: true,
        contentHash: true,
        reviewedHash: true,
        checkedAt: true,
      },
    });
  } catch (err) {
    console.warn('[guideline-docs] refresh: table unavailable:', err);
    return out;
  }

  const staleBefore = now.getTime() - RECHECK_AFTER_HOURS * 3_600_000;
  for (const row of rows) {
    if (!opts.force && row.checkedAt && row.checkedAt.getTime() > staleBefore) {
      out.skipped++;
      continue;
    }
    out.checked++;
    try {
      const res = await fetch(row.sourceUrl!, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0) throw new Error('empty response');
      const hash = hashBytes(bytes);
      const isChange = !!row.contentHash && row.contentHash !== hash;
      await prisma.adGuidelineDoc.update({
        where: { id: row.id },
        data: { contentHash: hash, byteSize: bytes.byteLength, checkedAt: now, checkError: null },
      });
      // Only announce a change against a REVIEWED baseline. A document that moved
      // while still unreviewed is already on the review list; a second alert for it
      // is noise, and noise is how a real alert gets ignored.
      if (isChange && row.reviewedHash && row.reviewedHash !== hash) {
        out.changed.push(`${row.make} — ${row.title}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'fetch failed';
      out.failed.push(`${row.make} — ${row.title}: ${message}`);
      try {
        await prisma.adGuidelineDoc.update({
          where: { id: row.id },
          data: { checkedAt: now, checkError: message.slice(0, 500) },
        });
      } catch {
        // nothing more to do; the failure is already in the result
      }
    }
  }

  if (out.changed.length) await notifyGuidelineChanges(out.changed);
  return out;
}

/**
 * Tell the admins a guideline moved.
 *
 * Recipients are admins rather than a config list, deliberately: this is agency-wide
 * co-op governance, not per-sub-account. The lesson from the generate step applies —
 * an empty recipient list means the whole mechanism silently does nothing.
 */
async function notifyGuidelineChanges(changed: string[]): Promise<void> {
  let recipients: string[] = [];
  try {
    const admins = await prisma.user.findMany({
      where: { role: { in: ['developer', 'super_admin', 'admin'] } },
      select: { id: true },
      take: 10,
    });
    recipients = admins.map((a) => a.id);
  } catch {
    return;
  }
  if (recipients.length === 0) {
    console.warn(`[guideline-docs] ${changed.length} guideline change(s) with no one to notify`);
    return;
  }

  const title =
    changed.length === 1 ? 'A co-op guideline document changed' : `${changed.length} co-op guideline documents changed`;
  for (const userId of recipients) {
    try {
      await createNotification({
        userId,
        type: 'coop_guideline_changed',
        severity: 'warning',
        title,
        body: `${changed.join('; ')}. Re-check the templates for these makes, then mark the document reviewed.`,
        link: '/ad-generator/oem-assets',
        meta: { changed },
        // One alert per document per day; a re-fetch loop must not become a pager.
        dedupeKey: `coop-guideline:${changed.slice().sort().join('|')}`,
        dedupeWindowHours: 24,
      });
    } catch (err) {
      console.warn('[guideline-docs] notification failed:', err);
    }
  }
}
