/**
 * Ad creatives — /api/ad-generator/creatives
 *
 * A saved ad = a template id + the filled-in field values, scoped to an
 * account. GET lists the account's ads (newest first); POST creates one.
 * Flag- + auth-gated; resilient (unmigrated table → empty list).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  name: string;
  templateId: string;
  doc: string | null;
  data: string;
  status: string;
  thumbnailUrl: string | null;
  updatedAt: Date;
  createdByName: string | null;
};

function shape(r: Row) {
  let data: Record<string, string> = {};
  try {
    data = JSON.parse(r.data) ?? {};
  } catch {
    data = {};
  }
  let doc: unknown = null;
  if (r.doc) {
    try {
      doc = JSON.parse(r.doc);
    } catch {
      doc = null;
    }
  }
  return {
    id: r.id,
    name: r.name,
    templateId: r.templateId,
    status: r.status,
    thumbnailUrl: r.thumbnailUrl,
    updatedAt: r.updatedAt,
    createdByName: r.createdByName,
    doc,
    data,
  };
}

export async function GET(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const accountKey = (req.nextUrl.searchParams.get('accountKey') || '').trim();
  if (!accountKey) return NextResponse.json({ creatives: [] });
  try {
    const rows = (await prisma.adCreative.findMany({ where: { accountKey }, orderBy: { updatedAt: 'desc' } })) as Row[];
    return NextResponse.json({ creatives: rows.map(shape) });
  } catch (err) {
    console.warn('[api/ad-generator/creatives] falling back to []:', err);
    return NextResponse.json({ creatives: [] });
  }
}

export async function POST(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { accountKey?: string; name?: string; templateId?: string; data?: Record<string, string>; status?: string; doc?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const accountKey = (body.accountKey ?? '').trim();
  const name = (body.name ?? '').trim() || 'Untitled ad';
  const templateId = (body.templateId ?? '').trim();
  if (!accountKey || !templateId) {
    return NextResponse.json({ error: 'accountKey and templateId are required' }, { status: 400 });
  }
  const u = session.user as { id?: string; name?: string | null };

  // The ad's own design copy: an explicit doc (e.g. "from scratch" sends a blank
  // one), else a snapshot of the source DB template so later master edits don't
  // change this ad. Code templates are stable, so they stay referenced (null).
  let docSnapshot: string | null = null;
  if (body.doc && typeof body.doc === 'object' && Array.isArray((body.doc as { sizes?: unknown }).sizes)) {
    docSnapshot = JSON.stringify(body.doc);
  } else {
    try {
      const tpl = await prisma.adTemplateDoc.findUnique({ where: { id: templateId }, select: { doc: true } });
      if (tpl?.doc) docSnapshot = tpl.doc;
    } catch {
      docSnapshot = null;
    }
  }

  try {
    const row = await prisma.adCreative.create({
      data: {
        accountKey,
        name,
        templateId,
        doc: docSnapshot,
        data: JSON.stringify(body.data ?? {}),
        status: body.status === 'ready' ? 'ready' : 'draft',
        createdById: u.id ?? null,
        createdByName: u.name ?? null,
      },
    });
    return NextResponse.json({ creative: { id: row.id, name: row.name } });
  } catch (err) {
    console.error('[api/ad-generator/creatives] create failed:', err);
    return NextResponse.json({ error: 'Could not create — has the table been migrated in this environment?' }, { status: 500 });
  }
}
