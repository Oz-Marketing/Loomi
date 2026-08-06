/**
 * Pull the current template design into ONE ad —
 * POST /api/ad-generator/creatives/[id]/sync
 *
 * The other direction from the template-level push, and the reason declining at
 * save time is safe: an ad that shows "Template updated" can take the update
 * later, on its own. `{ force: true }` is the explicit "reset this customized ad
 * to the template" — the only way a detached ad is ever overwritten, and the only
 * way it starts following again.
 *
 * Session-gated (not admin): pulling a template fix into your own ad is normal
 * client work, and the ad is re-preflighted either way, so it can't be used to
 * push a non-compliant design through.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, getAccountScope, canAccessAccount, forbidden } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import { applyTemplateDocToCreative } from '@/lib/ad-generator/template-sync-apply';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const row = await prisma.adCreative
    .findUnique({ where: { id }, select: { accountKey: true, templateId: true } })
    .catch(() => null);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canAccessAccount(getAccountScope(session), row.accountKey)) return forbidden();

  let body: { force?: boolean } = {};
  try {
    body = (await req.json()) as { force?: boolean };
  } catch {
    body = {};
  }

  const template = await prisma.adTemplateDoc
    .findUnique({ where: { id: row.templateId }, select: { doc: true } })
    .catch(() => null);
  // Code-rendered templates have no stored doc to pull from — they're stable by
  // construction, so there is nothing to sync.
  if (!template?.doc) {
    return NextResponse.json({ error: 'This ad has no editable source template to sync from' }, { status: 400 });
  }
  let doc: TemplateDoc;
  try {
    doc = JSON.parse(template.doc) as TemplateDoc;
  } catch {
    return NextResponse.json({ error: 'That template could not be read' }, { status: 500 });
  }
  if (!Array.isArray(doc.sizes) || !Array.isArray(doc.elements) || !doc.layouts) {
    return NextResponse.json({ error: 'That template is not a usable design' }, { status: 500 });
  }

  const result = await applyTemplateDocToCreative(id, doc, { force: body.force === true });
  return NextResponse.json({ result });
}
