/**
 * Create an ad by hand — a DETACHED copy of a design template, owned by the
 * account, with no manufacturer program behind it.
 *
 * Lived inline in POST /api/ad-generator/creatives. The manual campaign wizard
 * needs the same thing (an ad is one of the pieces a campaign can hold), and a
 * second inline copy of "snapshot the template, hash it, mark it detached" is
 * how the two would drift — one recording the revision, the other not.
 *
 * Server-only.
 */
import { prisma } from '@/lib/prisma';
import { designHash } from '@/lib/ad-generator/template-sync';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';

export async function createHandBuiltAd(input: {
  accountKey: string;
  name: string;
  templateId: string;
  data?: Record<string, string>;
  status?: 'draft' | 'ready';
  /** An explicit design (e.g. a blank one for "from scratch"); else the template's doc is snapshotted. */
  doc?: unknown;
  createdById?: string | null;
  createdByName?: string | null;
}): Promise<{ id: string; name: string }> {
  // The ad's own design copy: an explicit doc, else a snapshot of the source
  // template so later master edits don't change this ad. Code templates are
  // stable, so they stay referenced (null).
  let docSnapshot: string | null = null;
  if (input.doc && typeof input.doc === 'object' && Array.isArray((input.doc as { sizes?: unknown }).sizes)) {
    docSnapshot = JSON.stringify(input.doc);
  } else {
    try {
      const tpl = await prisma.adTemplateDoc.findUnique({ where: { id: input.templateId }, select: { doc: true } });
      if (tpl?.doc) docSnapshot = tpl.doc;
    } catch {
      docSnapshot = null;
    }
  }
  // Which template revision this copy came from — what lets an untouched copy
  // be told a fix landed upstream, instead of sitting on a stale design forever.
  let docHash: string | null = null;
  if (docSnapshot) {
    try {
      docHash = designHash(JSON.parse(docSnapshot) as TemplateDoc);
    } catch {
      docHash = null;
    }
  }
  const row = await prisma.adCreative.create({
    data: {
      accountKey: input.accountKey,
      name: input.name.trim() || 'Untitled ad',
      templateId: input.templateId,
      doc: docSnapshot,
      data: JSON.stringify(input.data ?? {}),
      status: input.status === 'ready' ? 'ready' : 'draft',
      createdById: input.createdById ?? null,
      createdByName: input.createdByName ?? null,
      templateSync: 'detached',
      templateDocHash: docHash,
    },
    select: { id: true, name: true },
  });
  return row;
}
