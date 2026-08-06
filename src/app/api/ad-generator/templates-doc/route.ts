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
 *                    (a group account's templates are inherited by its rooftops)
 *
 * Resilient: if the table isn't migrated in this environment, list endpoints
 * return [] so the generator simply falls back to code templates.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, getAccountScope, requireRole } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { getAncestorAccountKeys } from '@/lib/services/accounts';
import {
  parseSharedKeys,
  serializeSharedKeys,
  templatesForAccount,
  templatesForAnyAccount,
} from '@/lib/ad-generator/template-access';
import { approvalStatesForTemplates } from '@/lib/ad-generator/coop-approval-store';
import type { ApprovalStatus } from '@/lib/ad-generator/coop-approval';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';

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
  sharedAccountKeys: string | null;
  category: string | null;
  tags: string | null;
  updatedAt: Date;
  createdByName: string | null;
  createdByEmail: string | null;
  createdByImage: string | null;
};

/**
 * Every ancestor of the given accounts, deduped. A template authored at a
 * parent (group) account is inherited by each rooftop beneath it.
 */
async function ancestorsForAccounts(keys: string[]): Promise<string[]> {
  if (!keys.length) return [];
  const chains = await Promise.all(keys.map((k) => getAncestorAccountKeys(k)));
  return [...new Set(chains.flat())].filter((k) => !keys.includes(k));
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

/**
 * Attach each template's co-op approval standing.
 *
 * Folded into the list rather than fetched per card: the library renders dozens of
 * templates, and the approval is the one thing on a card that decides whether ads
 * from it can run unattended — so it can't be behind a second request that the
 * list might skip. One query for the whole page (see approvalStatesForTemplates).
 */
async function withApprovals<T extends { id: string; doc: unknown }>(
  templates: T[],
): Promise<(T & { coopApproval?: ApprovalStatus })[]> {
  // `shape()` types doc as unknown (it's parsed JSON), so narrow here rather than
  // widening the caller.
  const withDocs = templates.flatMap((t) => {
    const doc = t.doc as TemplateDoc | null;
    return doc && Array.isArray(doc.sizes) ? [{ id: t.id, doc, make: doc.make ?? null }] : [];
  });
  if (!withDocs.length) return templates;
  try {
    const states = await approvalStatesForTemplates(withDocs);
    return templates.map((t) => ({ ...t, coopApproval: states[t.id] }));
  } catch (err) {
    // An unpushed table must not take out the library.
    console.warn('[api/ad-generator/templates-doc] approvals unavailable:', err);
    return templates;
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
    // The share list, so the Share modal opens with the current state ticked.
    sharedAccountKeys: parseSharedKeys(r.sharedAccountKeys),
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
    const { error } = await requireRole('developer', 'super_admin', 'admin');
    if (error) return error;
    // ?accountKey=<key> → the group-authoring view: only that account's own
    // templates (access-gated). Otherwise the whole library.
    const ownerKey = req.nextUrl.searchParams.get('accountKey')?.trim() || null;
    try {
      const rows = (await prisma.adTemplateDoc.findMany({
        ...(ownerKey ? { where: { accountKey: ownerKey } } : {}),
        orderBy: { updatedAt: 'desc' },
      })) as Row[];
      return NextResponse.json({ templates: await withApprovals(rows.map(shape)) });
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
      // Inherit templates authored at any ancestor (group) account.
      const inherited = await ancestorsForAccounts(allowed);
      // Scoping is partly in a JSON column (`sharedAccountKeys`), so the final cut
      // happens in JS against one shared rule — the alternative is a `where` that
      // has to be kept in step across five call sites, and a template leaking into
      // the wrong account's library is not a mistake worth risking for a narrower
      // query. The table is small and already filtered to published + active.
      const rows = (await prisma.adTemplateDoc.findMany({
        where: { status: 'published', isActive: true },
        orderBy: { name: 'asc' },
      })) as Row[];
      const visible = templatesForAnyAccount(rows, allowed, inherited);
      return NextResponse.json({ templates: await withApprovals(visible.map(shape).filter((t) => t.doc)) });
    }

    // Admins+: global templates + the active account's own + ancestors' own.
    const inherited = accountKey ? await ancestorsForAccounts([accountKey]) : [];
    const rows = (await prisma.adTemplateDoc.findMany({
      where: { status: 'published', isActive: true },
      orderBy: { name: 'asc' },
    })) as Row[];
    const visible = templatesForAccount(rows, { accountKey: accountKey ?? null, ancestorKeys: inherited });
    // Only return rows whose doc parses to a usable shape.
    return NextResponse.json({ templates: await withApprovals(visible.map(shape).filter((t) => t.doc)) });
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

  let body: {
    name?: string;
    description?: string;
    doc?: unknown;
    status?: string;
    accountKey?: string | null;
    sharedAccountKeys?: string[];
  };
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
  // A template saved against a group account is inherited by every rooftop
  // beneath it; accountKey null keeps it in the shared Loomi library.

  const u = session?.user as { name?: string | null; email?: string | null; image?: string | null } | undefined;
  try {
    const row = await prisma.adTemplateDoc.create({
      data: {
        name,
        description: body.description?.trim() || null,
        doc: JSON.stringify(doc),
        status,
        accountKey,
        sharedAccountKeys: serializeSharedKeys(body.sharedAccountKeys),
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
