/**
 * Ad Generator data-driven templates — /api/ad-generator/templates-doc
 *
 * The visual builder saves a `TemplateDoc` (JSON) here; the generator reads
 * PUBLISHED ones to offer alongside the code-defined templates. The doc column
 * stores `JSON.stringify(TemplateDoc)`; reads parse it back to an object.
 *
 * - GET            → published + active templates (for the generator picker):
 *                    global ones (accountKey null) +, with ?accountKey=, that
 *                    account's own (dealer-branded plates etc.)
 * - GET ?all=1     → every template incl. drafts (admin; the builder's Load)
 * - POST           → create (admin); optional accountKey scopes it to one account
 *
 * Resilient: if the table isn't migrated in this environment, list endpoints
 * return [] so the generator simply falls back to code templates.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireRole } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  name: string;
  description: string | null;
  doc: string;
  status: string;
  isActive: boolean;
  accountKey: string | null;
  updatedAt: Date;
  createdByName: string | null;
  createdByEmail: string | null;
  createdByImage: string | null;
};

/** Parse a stored doc; null if it's not a usable TemplateDoc shape. */
function parseDoc(raw: string): unknown | null {
  try {
    const d = JSON.parse(raw);
    if (d && typeof d === 'object' && Array.isArray(d.sizes) && Array.isArray(d.elements) && d.layouts) return d;
    return null;
  } catch {
    return null;
  }
}

function shape(r: Row) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    status: r.status,
    isActive: r.isActive,
    accountKey: r.accountKey,
    updatedAt: r.updatedAt,
    createdByName: r.createdByName,
    createdByEmail: r.createdByEmail,
    createdByImage: r.createdByImage,
    doc: parseDoc(r.doc),
  };
}

export async function GET(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Admin: full list (incl. drafts) for the builder's Load.
  if (req.nextUrl.searchParams.get('all') === '1') {
    const { error } = await requireRole('developer', 'super_admin', 'admin');
    if (error) return error;
    try {
      const rows = (await prisma.adTemplateDoc.findMany({ orderBy: { updatedAt: 'desc' } })) as Row[];
      return NextResponse.json({ templates: rows.map(shape) });
    } catch (err) {
      console.warn('[api/ad-generator/templates-doc] all → []:', err);
      return NextResponse.json({ templates: [] });
    }
  }

  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Global templates + the active account's own (when the caller passes one).
    const accountKey = req.nextUrl.searchParams.get('accountKey')?.trim();
    const rows = (await prisma.adTemplateDoc.findMany({
      where: {
        status: 'published',
        isActive: true,
        OR: [{ accountKey: null }, ...(accountKey ? [{ accountKey }] : [])],
      },
      orderBy: { name: 'asc' },
    })) as Row[];
    // Only return rows whose doc parses to a usable shape.
    return NextResponse.json({ templates: rows.map(shape).filter((t) => t.doc) });
  } catch (err) {
    console.warn('[api/ad-generator/templates-doc] falling back to []:', err);
    return NextResponse.json({ templates: [] });
  }
}

export async function POST(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;
  const session = await getAuthSession();

  let body: { name?: string; description?: string; doc?: unknown; status?: string; accountKey?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const name = body.name?.trim();
  const doc = body.doc;
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!doc || typeof doc !== 'object' || !Array.isArray((doc as { sizes?: unknown }).sizes)) {
    return NextResponse.json({ error: 'doc must be a TemplateDoc object' }, { status: 400 });
  }
  const status = body.status === 'published' ? 'published' : 'draft';

  const u = session?.user as { name?: string | null; email?: string | null; image?: string | null } | undefined;
  try {
    const row = await prisma.adTemplateDoc.create({
      data: {
        name,
        description: body.description?.trim() || null,
        doc: JSON.stringify(doc),
        status,
        accountKey: typeof body.accountKey === 'string' && body.accountKey.trim() ? body.accountKey.trim() : null,
        createdBy: u?.email ?? null,
        createdByName: u?.name ?? null,
        createdByEmail: u?.email ?? null,
        createdByImage: u?.image ?? null,
      },
    });
    return NextResponse.json({ template: { id: row.id, name: row.name, status: row.status } });
  } catch (err) {
    console.error('[api/ad-generator/templates-doc] create failed:', err);
    return NextResponse.json(
      { error: 'Could not save — has the table been migrated in this environment?' },
      { status: 500 },
    );
  }
}
