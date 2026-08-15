import { prisma } from '@/lib/prisma';
import { resolveTemplateApproval, type ApprovalRow, type ApprovalStatus } from './coop-approval';
import { designHash } from './template-sync';
import type { TemplateDoc } from './doc-types';

/**
 * Co-op pre-approval — the DB half.
 *
 * Every read is failure-tolerant the same way the rest of the ad-generator stores
 * are: an environment where the table hasn't been pushed yet must degrade to "no
 * approval on file", which is the safe direction (ads stay drafts) rather than an
 * exception that takes down a nightly run.
 *
 * Server-only.
 */

/** Every approval row for a template, newest first. */
export async function listApprovals(templateId: string): Promise<ApprovalRow[]> {
  try {
    return await prisma.adTemplateCoopApproval.findMany({
      where: { templateId },
      orderBy: { approvedAt: 'desc' },
    });
  } catch (err) {
    console.warn('[coop-approval-store] could not read approvals:', err);
    return [];
  }
}

/**
 * Approval standing for one template + make, against the template's CURRENT
 * design.
 *
 * The doc is passed in rather than re-read so the caller's design and the hash the
 * approval is compared against cannot drift — generation already holds the doc it
 * is about to render.
 */
export async function approvalStatusFor(params: {
  templateId: string;
  doc: TemplateDoc;
  make: string;
  activePackVersion?: string | null;
}): Promise<ApprovalStatus> {
  const rows = await listApprovals(params.templateId);
  return resolveTemplateApproval(rows, {
    docHash: designHash(params.doc),
    make: params.make,
    activePackVersion: params.activePackVersion ?? null,
  });
}

/**
 * Record an approval.
 *
 * The design hash is computed HERE from the stored doc rather than accepted from
 * the caller: a client-supplied hash would let a stale browser tab approve a
 * design nobody is looking at any more.
 */
export async function recordApproval(params: {
  templateId: string;
  make: string;
  packVersion?: string | null;
  reference?: string | null;
  note?: string | null;
  approvedById?: string | null;
  approvedByName?: string | null;
}): Promise<{ ok: true; id: string; docHash: string } | { ok: false; error: string }> {
  const row = await prisma.adTemplateDoc
    .findUnique({ where: { id: params.templateId }, select: { doc: true } })
    .catch(() => null);
  if (!row?.doc) return { ok: false, error: 'That template could not be read' };
  let doc: TemplateDoc;
  try {
    doc = JSON.parse(row.doc) as TemplateDoc;
  } catch {
    return { ok: false, error: 'That template could not be read' };
  }
  if (!Array.isArray(doc.sizes) || !Array.isArray(doc.elements) || !doc.layouts) {
    return { ok: false, error: 'That template is not a usable design' };
  }

  const docHash = designHash(doc);
  try {
    const created = await prisma.adTemplateCoopApproval.create({
      data: {
        templateId: params.templateId,
        make: params.make.trim(),
        docHash,
        packVersion: params.packVersion?.trim() || null,
        reference: params.reference?.trim() || null,
        note: params.note?.trim() || null,
        approvedById: params.approvedById ?? null,
        approvedByName: params.approvedByName ?? null,
      },
    });
    return { ok: true, id: created.id, docHash };
  } catch (err) {
    console.error('[coop-approval-store] could not record approval:', err);
    return { ok: false, error: 'Could not record the approval — has the table been pushed in this environment?' };
  }
}

/** Withdraw every live approval for a template + make. Kept, not deleted. */
export async function revokeApprovals(params: {
  templateId: string;
  make: string;
  revokedByName?: string | null;
}): Promise<number> {
  try {
    const res = await prisma.adTemplateCoopApproval.updateMany({
      where: {
        templateId: params.templateId,
        make: { equals: params.make.trim(), mode: 'insensitive' },
        revokedAt: null,
      },
      data: { revokedAt: new Date(), revokedByName: params.revokedByName ?? null },
    });
    return res.count;
  } catch (err) {
    console.error('[coop-approval-store] could not revoke:', err);
    return 0;
  }
}

/**
 * Approval standing for many templates at once, for the library list.
 *
 * One query for every row rather than N — the template library renders dozens of
 * cards and a per-card round trip would be the page's slowest thing.
 */
export async function approvalStatesForTemplates(
  templates: { id: string; doc: TemplateDoc; make?: string | null }[],
): Promise<Record<string, ApprovalStatus>> {
  const ids = templates.map((t) => t.id);
  if (!ids.length) return {};
  let rows: ApprovalRow[] = [];
  try {
    rows = await prisma.adTemplateCoopApproval.findMany({
      where: { templateId: { in: ids } },
      orderBy: { approvedAt: 'desc' },
    });
  } catch {
    return {};
  }
  const byTemplate = new Map<string, ApprovalRow[]>();
  for (const r of rows) {
    if (!r.templateId) continue;
    const list = byTemplate.get(r.templateId) ?? [];
    list.push(r);
    byTemplate.set(r.templateId, list);
  }

  const out: Record<string, ApprovalStatus> = {};
  for (const t of templates) {
    const mine = byTemplate.get(t.id) ?? [];
    // A template with no make of its own is reported against whichever make
    // approved it — a shared plate has no single answer, so the most recent live
    // approval is the informative one for a list badge.
    const make = t.make?.trim() || mine.find((r) => !r.revokedAt)?.make || mine[0]?.make || '';
    if (!make) {
      out[t.id] = { state: 'none', approval: null, reason: 'No co-op approval is on file for this template.' };
      continue;
    }
    out[t.id] = resolveTemplateApproval(mine, { docHash: designHash(t.doc), make });
  }
  return out;
}
