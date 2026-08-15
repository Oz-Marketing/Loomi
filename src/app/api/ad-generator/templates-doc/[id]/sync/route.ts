/**
 * Push a template's saved design into ads built from it —
 * POST /api/ad-generator/templates-doc/[id]/sync
 *
 * Body: `{ ids: string[] }` — the ads to update, as chosen in the save-time
 * prompt. Each one is re-preflighted against the new design and re-rendered; an
 * ad that would become non-compliant keeps its current design and is reported
 * back (see template-sync-apply).
 *
 * Renders are sequential Chromium runs, so the request is capped and the CLIENT
 * chunks: that keeps each response inside the timeout and gives the user real
 * progress instead of one long spinner.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, getAccountScope, canAccessAccount, requireRole } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import { applyTemplateDocToCreatives } from '@/lib/ad-generator/template-sync-apply';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Per request. The client sends batches of this size or smaller. */
const MAX_IDS = 10;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.filter((x): x is string => typeof x === 'string' && !!x.trim()))]
    : [];
  if (!ids.length) return NextResponse.json({ results: [] });
  if (ids.length > MAX_IDS) {
    return NextResponse.json({ error: `Send at most ${MAX_IDS} ads per request` }, { status: 400 });
  }

  const template = await prisma.adTemplateDoc.findUnique({ where: { id }, select: { doc: true } }).catch(() => null);
  if (!template?.doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let doc: TemplateDoc;
  try {
    doc = JSON.parse(template.doc) as TemplateDoc;
  } catch {
    return NextResponse.json({ error: 'That template could not be read' }, { status: 500 });
  }
  if (!Array.isArray(doc.sizes) || !Array.isArray(doc.elements) || !doc.layouts) {
    return NextResponse.json({ error: 'That template is not a usable design' }, { status: 500 });
  }

  // Re-derive which of the submitted ids the caller may actually touch, and
  // operate on THAT set: the list is client-supplied, so it can name ads from
  // another sub-account, and it can name ads built from a different template.
  const scope = getAccountScope(session);
  const rows = await prisma.adCreative
    .findMany({ where: { id: { in: ids }, templateId: id }, select: { id: true, accountKey: true } })
    .catch(() => []);
  const allowed = rows.filter((r) => canAccessAccount(scope, r.accountKey)).map((r) => r.id);
  if (!allowed.length) return NextResponse.json({ results: [] });

  const results = await applyTemplateDocToCreatives(allowed, doc);
  return NextResponse.json({
    results,
    // A one-line tally, so the caller doesn't have to reduce this itself to show
    // a toast after each batch.
    summary: {
      updated: results.filter((r) => r.outcome === 'updated').length,
      blocked: results.filter((r) => r.outcome === 'blocked').length,
      failed: results.filter((r) => r.outcome === 'failed').length,
      skipped: results.filter((r) => r.outcome === 'skipped_detached' || r.outcome === 'unchanged').length,
    },
  });
}
