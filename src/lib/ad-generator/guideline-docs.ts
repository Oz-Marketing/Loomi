import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { createNotification } from '@/lib/notifications/service';
import { renderGuidelinePreview, type RenderPreview } from './guideline-preview';

/**
 * The guideline document register — a library of what each manufacturer currently
 * says, which notices when they change it.
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
 *     record. Automated extraction has the same failure mode at higher volume.
 *   • The failure directions are asymmetric. A missed rule costs a resubmission.
 *     A WRONG rule silently costs a brand its entire month of ads.
 *
 * What matters is knowing the document MOVED. That's a hash comparison: exact,
 * cheap, and impossible to be subtly wrong about.
 *
 * ── NO REVIEW ATTESTATION ──
 *
 * An earlier version made a human press "Mark reviewed" to set a baseline, and
 * nagged until they did. That was ceremony: it recorded an attestation nobody had
 * asked for and turned a library into a to-do list. Now a document simply IS what
 * it is, and when its bytes change the previous hash and the date are kept as
 * history. Change detection and notification are unchanged.
 *
 * Server-only.
 */

/** How long to trust a fetched hash before re-checking a URL-backed document. */
export const RECHECK_AFTER_HOURS = 24;

/** How long a replacement stays flagged as recently updated. */
export const RECENT_UPDATE_DAYS = 30;

export type DocState =
  /** Registered but no bytes yet — a URL that has never been fetched. */
  | 'unfetched'
  /** Replaced within the last {@link RECENT_UPDATE_DAYS}. Informational; it fades. */
  | 'updated'
  /** On file and unchanged. The normal, quiet state. */
  | 'stored'
  /** The last fetch failed. Explicitly NOT 'stored' — a 404 is not reassurance. */
  | 'unreachable';

export interface GuidelineDocRow {
  id: string;
  make: string;
  title: string;
  sourceUrl: string | null;
  sourceAssetId: string | null;
  contentHash: string | null;
  byteSize: number | null;
  pageCount: number | null;
  previewImage: string | null;
  previousHash: string | null;
  replacedAt: string | null;
  notes: string | null;
  checkedAt: string | null;
  checkError: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  state: DocState;
  summary: string;
}

/**
 * Classify one document. Pure — takes the clock as an argument so the state machine
 * is testable without a DB or a real `now`.
 *
 * Order matters: an unreachable document is reported as unreachable even if we hold
 * bytes for it, because "the source our citations point at can't be opened" is the
 * more important fact.
 */
export function docState(
  row: { contentHash: string | null; replacedAt: Date | string | null; checkError: string | null },
  now: Date = new Date(),
): { state: DocState; summary: string } {
  if (row.checkError) {
    return {
      state: 'unreachable',
      summary: `Last fetch failed: ${row.checkError}. The cited source can't be opened.`,
    };
  }
  if (!row.contentHash) {
    return { state: 'unfetched', summary: 'Registered but not fetched yet — no copy on file.' };
  }
  if (row.replacedAt) {
    const at = typeof row.replacedAt === 'string' ? new Date(row.replacedAt) : row.replacedAt;
    const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);
    if (days <= RECENT_UPDATE_DAYS) {
      return {
        state: 'updated',
        summary: `Replaced ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`} — the manufacturer reissued this.`,
      };
    }
  }
  return { state: 'stored', summary: 'On file.' };
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

type DbRow = {
  id: string;
  make: string;
  title: string;
  sourceUrl: string | null;
  sourceAssetId: string | null;
  contentHash: string | null;
  byteSize: number | null;
  pageCount: number | null;
  previewImage: string | null;
  previousHash: string | null;
  replacedAt: Date | null;
  notes: string | null;
  checkedAt: Date | null;
  checkError: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toRow(r: DbRow, now = new Date()): GuidelineDocRow {
  const { state, summary } = docState(r, now);
  return {
    id: r.id,
    make: r.make,
    title: r.title,
    sourceUrl: r.sourceUrl,
    sourceAssetId: r.sourceAssetId,
    contentHash: r.contentHash,
    byteSize: r.byteSize,
    pageCount: r.pageCount,
    previewImage: r.previewImage,
    previousHash: r.previousHash,
    replacedAt: r.replacedAt?.toISOString() ?? null,
    notes: r.notes,
    checkedAt: r.checkedAt?.toISOString() ?? null,
    checkError: r.checkError,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    state,
    summary,
  };
}

/**
 * Every registered document.
 *
 * `includePreview` is off by default: the cover thumbnails are ~5-35 KB each and 33
 * of them would put roughly a megabyte of base64 into a list payload that mostly
 * gets used for counts.
 */
export async function listGuidelineDocs(
  make?: string,
  opts: { includePreview?: boolean } = {},
): Promise<GuidelineDocRow[]> {
  try {
    const rows = (await prisma.adGuidelineDoc.findMany({
      where: make ? { make: { equals: make, mode: 'insensitive' } } : undefined,
      orderBy: [{ make: 'asc' }, { title: 'asc' }],
    })) as DbRow[];
    const now = new Date();
    return rows.map((r) => {
      const row = toRow(r, now);
      if (!opts.includePreview) row.previewImage = null;
      return row;
    });
  } catch (err) {
    // Log rather than swallow. An empty list is indistinguishable from "nothing is
    // registered", and that cost real debugging time once: a stale Prisma client
    // that didn't know a new column made 33 documents silently read as zero.
    console.warn('[guideline-docs] list failed, reporting no documents:', err);
    return [];
  }
}

/** One document with its cover, for the detail pane. */
export async function getGuidelineDoc(id: string): Promise<GuidelineDocRow | null> {
  try {
    const row = (await prisma.adGuidelineDoc.findUnique({ where: { id } })) as DbRow | null;
    return row ? toRow(row) : null;
  } catch {
    return null;
  }
}

export interface RegisterArgs {
  make: string;
  title: string;
  sourceUrl?: string | null;
  sourceAssetId?: string | null;
  /** Bytes, when the caller has them (an upload or a local import). */
  bytes?: Uint8Array | null;
  /** Mime, so the preview renderer knows whether it can rasterize. */
  mimeType?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  /** Skip cover rendering entirely. */
  skipPreview?: boolean;
  /**
   * A renderer from {@link withPreviewRenderer}, so a bulk import shares one
   * browser instead of launching Chromium per document — which was both slow and
   * flaky enough that one of 33 covers failed under the memory pressure.
   */
  render?: RenderPreview;
}

/**
 * Register or update a document.
 *
 * When bytes arrive and the hash has MOVED, the old hash is kept in `previousHash`
 * and `replacedAt` is stamped — that's what makes a reissue visible after the fact,
 * and it's why this is history rather than a flag someone has to clear.
 */
export async function registerGuidelineDoc(args: RegisterArgs): Promise<GuidelineDocRow | null> {
  const make = args.make.trim();
  const title = args.title.trim();
  if (!make || !title) return null;

  try {
    const existing = (await prisma.adGuidelineDoc.findUnique({
      where: { make_title: { make, title } },
      select: { contentHash: true, previewImage: true },
    })) as { contentHash: string | null; previewImage: string | null } | null;

    let hashed: Record<string, unknown> = {};
    if (args.bytes) {
      const contentHash = hashBytes(args.bytes);
      const moved = !!existing?.contentHash && existing.contentHash !== contentHash;
      hashed = {
        contentHash,
        byteSize: args.bytes.byteLength,
        checkedAt: new Date(),
        checkError: null,
        ...(moved ? { previousHash: existing!.contentHash, replacedAt: new Date() } : {}),
      };

      // Render the cover when the bytes are new to us. Skipped when unchanged so a
      // re-register doesn't pay for a Chromium launch to redraw the same page.
      const needsPreview = !args.skipPreview && (moved || !existing?.previewImage);
      if (needsPreview) {
        const render = args.render ?? renderGuidelinePreview;
        const preview = await render(args.bytes, args.mimeType ?? 'application/pdf');
        if (preview) {
          hashed.previewImage = preview.dataUri;
          hashed.pageCount = preview.pageCount;
        }
      }
    }

    const base = {
      sourceUrl: args.sourceUrl?.trim() || null,
      sourceAssetId: args.sourceAssetId?.trim() || null,
      ...(args.notes !== undefined ? { notes: args.notes?.trim() || null } : {}),
      ...hashed,
    };

    const row = (await prisma.adGuidelineDoc.upsert({
      where: { make_title: { make, title } },
      create: { make, title, ...base, createdBy: args.createdBy ?? null },
      update: base,
    })) as DbRow;
    return toRow(row);
  } catch (err) {
    console.warn('[guideline-docs] register failed:', err);
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
 * HEAD would be cheaper but isn't trustworthy here: many document hosts (Drive,
 * SharePoint, CDN-fronted portals) return no useful validator, or a Last-Modified
 * that moves when nothing did. Hashing the bytes is the only comparison that can't
 * be subtly wrong, and at a few dozen documents a day the cost is irrelevant.
 *
 * Note this only covers documents with a public URL. Most OEM portals sit behind a
 * login, so for those a re-upload is how a new edition arrives.
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
    checkedAt: Date | null;
  }[] = [];
  try {
    rows = await prisma.adGuidelineDoc.findMany({
      where: { isActive: true, sourceUrl: { not: null } },
      select: { id: true, make: true, title: true, sourceUrl: true, contentHash: true, checkedAt: true },
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
      const moved = !!row.contentHash && row.contentHash !== hash;

      let preview: { dataUri: string; pageCount: number } | null = null;
      if (moved || !row.contentHash) {
        preview = await renderGuidelinePreview(bytes, res.headers.get('content-type') ?? 'application/pdf');
      }

      await prisma.adGuidelineDoc.update({
        where: { id: row.id },
        data: {
          contentHash: hash,
          byteSize: bytes.byteLength,
          checkedAt: now,
          checkError: null,
          ...(moved ? { previousHash: row.contentHash, replacedAt: now } : {}),
          ...(preview ? { previewImage: preview.dataUri, pageCount: preview.pageCount } : {}),
        },
      });
      if (moved) out.changed.push(`${row.make} — ${row.title}`);
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
        body: `${changed.join('; ')}. Worth checking whether anything we enforce for these makes has moved.`,
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
