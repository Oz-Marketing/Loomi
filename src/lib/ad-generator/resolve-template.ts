import { prisma } from '@/lib/prisma';
import { getTemplate, getTemplateDoc } from './templates';
import { adTemplateFromDoc } from './doc-template';
import type { AdTemplate } from './types';
import type { TemplateDoc } from './doc-types';

/**
 * Resolve a template id to an AdTemplate, from either the code registry or a
 * saved (published or draft) AdTemplateDoc in the DB. Server-only (touches the
 * database via prisma — only the render/copy API routes import this). Returns
 * null for an unknown id, an unreadable doc, or an unmigrated table — callers
 * respond 400/Unknown template.
 */
export async function resolveTemplate(id: string): Promise<AdTemplate | null> {
  if (!id) return null;
  const code = getTemplate(id);
  if (code) return code;
  try {
    const row = await prisma.adTemplateDoc.findUnique({ where: { id } });
    if (!row) return null;
    const doc = JSON.parse(row.doc) as TemplateDoc;
    if (!doc || !Array.isArray(doc.sizes) || !Array.isArray(doc.elements) || !doc.layouts) return null;
    return adTemplateFromDoc(row.id, doc);
  } catch {
    return null;
  }
}

/**
 * Resolve a template id to the TemplateDoc itself, for callers that must inspect
 * the design rather than just render it (video export, motion detection).
 *
 * Returns null for the two retired hand-written templates, which have no doc —
 * so an ad built on one of those can't be exported as video, which is correct:
 * it has no layer to put a clip in.
 */
export async function resolveTemplateDoc(id: string): Promise<TemplateDoc | null> {
  if (!id) return null;
  const code = getTemplateDoc(id);
  if (code) return code;
  try {
    const row = await prisma.adTemplateDoc.findUnique({ where: { id } });
    if (!row) return null;
    const doc = JSON.parse(row.doc) as TemplateDoc;
    if (!doc || !Array.isArray(doc.sizes) || !Array.isArray(doc.elements) || !doc.layouts) return null;
    return { ...doc, id: row.id };
  } catch {
    return null;
  }
}
