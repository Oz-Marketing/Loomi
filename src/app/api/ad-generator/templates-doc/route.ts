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
import { getAuthSession, getAccountScope, canAccessOrg, requireRole } from '@/lib/api-auth';
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
  organizationId: string | null;
  category: string | null;
  tags: string | null;
  updatedAt: Date;
  createdByName: string | null;
  createdByEmail: string | null;
  createdByImage: string | null;
};

/** Distinct parent-org ids for a set of account keys (for picker inheritance). */
async function orgIdsForAccounts(keys: string[]): Promise<string[]> {
  if (!keys.length) return [];
  const rows = await prisma.account.findMany({
    where: { key: { in: keys } },
    select: { organizationId: true },
  });
  return [...new Set(rows.map((r) => r.organizationId).filter((x): x is string => !!x))];
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

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
    organizationId: r.organizationId,
    category: r.category,
    tags: parseTags(r.tags),
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
    const { session, error } = await requireRole('developer', 'super_admin', 'admin');
    if (error) return error;
    // ?organizationId=<id> → the org-authoring view: only that org's own
    // templates (access-gated). Otherwise the whole library.
    const organizationId = req.nextUrl.searchParams.get('organizationId')?.trim() || null;
    if (organizationId && !(await canAccessOrg(session!, organizationId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    try {
      const rows = (await prisma.adTemplateDoc.findMany({
        ...(organizationId ? { where: { organizationId } } : {}),
        orderBy: { updatedAt: 'desc' },
      })) as Row[];
      return NextResponse.json({ templates: rows.map(shape) });
    } catch (err) {
      console.warn('[api/ad-generator/templates-doc] all → []:', err);
      return NextResponse.json({ templates: [] });
    }
  }

  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const accountKey = req.nextUrl.searchParams.get('accountKey')?.trim();

    // Clients get a curated library: the global "All accounts" library
    // (accountKey null) PLUS anything a designer scoped/deployed to their own
    // subaccount(s). A requested accountKey outside their scope falls back to
    // just the globals. Everything is server-side so the client can't widen the
    // scoped set by tweaking the query.
    if (session.user.role === 'client') {
      const keys = getAccountScope(session) ?? [];
      const allowed = accountKey ? (keys.includes(accountKey) ? [accountKey] : []) : keys;
      // Inherit templates authored at each account's parent organization.
      const orgIds = await orgIdsForAccounts(allowed);
      const rows = (await prisma.adTemplateDoc.findMany({
        where: {
          status: 'published',
          isActive: true,
          OR: [
            { accountKey: null, organizationId: null },
            ...(allowed.length ? [{ accountKey: { in: allowed } }] : []),
            ...(orgIds.length ? [{ organizationId: { in: orgIds } }] : []),
          ],
        },
        orderBy: { name: 'asc' },
      })) as Row[];
      return NextResponse.json({ templates: rows.map(shape).filter((t) => t.doc) });
    }

    // Admins+: global templates + the active account's own + inherited org-owned.
    const orgIds = accountKey ? await orgIdsForAccounts([accountKey]) : [];
    const rows = (await prisma.adTemplateDoc.findMany({
      where: {
        status: 'published',
        isActive: true,
        OR: [
          { accountKey: null, organizationId: null },
          ...(accountKey ? [{ accountKey }] : []),
          ...(orgIds.length ? [{ organizationId: { in: orgIds } }] : []),
        ],
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

  let body: { name?: string; description?: string; doc?: unknown; status?: string; accountKey?: string | null; organizationId?: string | null };
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
  const accountKey = typeof body.accountKey === 'string' && body.accountKey.trim() ? body.accountKey.trim() : null;
  // Org-owned template: account-less, tagged to the org so its sub-accounts
  // inherit it. Verify the session may author for this org.
  const organizationId = !accountKey && typeof body.organizationId === 'string' && body.organizationId.trim()
    ? body.organizationId.trim()
    : null;
  if (organizationId && !(await canAccessOrg(session!, organizationId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const u = session?.user as { name?: string | null; email?: string | null; image?: string | null } | undefined;
  try {
    const row = await prisma.adTemplateDoc.create({
      data: {
        name,
        description: body.description?.trim() || null,
        doc: JSON.stringify(doc),
        status,
        accountKey,
        organizationId,
        // Shared taxonomy — read off the doc (the builder stores category/tags there)
        // so the columns stay in sync for library filtering.
        category: typeof (doc as { category?: unknown }).category === 'string' ? (doc as { category: string }).category.trim() || null : null,
        tags: Array.isArray((doc as { tags?: unknown }).tags) ? JSON.stringify((doc as { tags: string[] }).tags) : null,
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
