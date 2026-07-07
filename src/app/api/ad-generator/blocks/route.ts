/**
 * Ad Generator reusable blocks — /api/ad-generator/blocks
 *
 * A "block" is a saved cluster of builder elements (e.g. a Lease/APR offer
 * block) a designer inserts from the Insert panel. `doc` stores the lightweight
 * JSON payload (see `blocks.ts` BlockPayload), NOT a full TemplateDoc.
 *
 * - GET               → active blocks the caller can use: global (accountKey
 *                       null) + the requested account's own (?accountKey=).
 * - POST              → create (managers). Optional accountKey scopes it to one
 *                       subaccount; null = global.
 *
 * Resilient: if the table isn't migrated in this environment, GET returns [].
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, getAccountScope, requireRole } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  name: string;
  description: string | null;
  doc: string;
  isActive: boolean;
  accountKey: string | null;
  accountKeys: string | null;
  category: string | null;
  tags: string | null;
  updatedAt: Date;
  createdByName: string | null;
  createdByEmail: string | null;
  createdByImage: string | null;
};

function parseKeys(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}
const parseTags = parseKeys;

/** Every subaccount a block is scoped to (union of the legacy single key + the
 *  new array). Empty = global. */
function blockAccountKeys(r: { accountKey: string | null; accountKeys: string | null }): string[] {
  const set = new Set(parseKeys(r.accountKeys));
  if (r.accountKey) set.add(r.accountKey);
  return [...set];
}

/** Parse a stored block payload; null if it's not a usable shape. */
function parseBlockDoc(raw: string): unknown | null {
  try {
    const d = JSON.parse(raw);
    if (d && typeof d === 'object' && Array.isArray(d.elements) && d.boxes && typeof d.boxes === 'object') return d;
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
    isActive: r.isActive,
    accountKey: r.accountKey,
    accountKeys: blockAccountKeys(r),
    category: r.category,
    tags: parseTags(r.tags),
    updatedAt: r.updatedAt,
    createdByName: r.createdByName,
    createdByEmail: r.createdByEmail,
    createdByImage: r.createdByImage,
    doc: parseBlockDoc(r.doc),
  };
}

export async function GET(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const accountKey = req.nextUrl.searchParams.get('accountKey')?.trim();
    // Clients only ever see globals + blocks scoped to an account they can access.
    let allowedKey = accountKey;
    if (session.user.role === 'client') {
      const keys = getAccountScope(session) ?? [];
      allowedKey = accountKey && keys.includes(accountKey) ? accountKey : undefined;
    }
    // Scoping lives partly in a JSON column (`accountKeys`), so filter in JS —
    // the block library is small/curated. A block shows when it's global (no
    // account scoping) or the active account is one of its assigned subaccounts.
    const rows = (await prisma.adBlock.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    })) as Row[];
    const visible = rows.filter((r) => {
      const keys = blockAccountKeys(r);
      if (keys.length === 0) return true; // global
      return allowedKey ? keys.includes(allowedKey) : false;
    });
    return NextResponse.json({ blocks: visible.map(shape).filter((b) => b.doc) });
  } catch (err) {
    console.warn('[api/ad-generator/blocks] falling back to []:', err);
    return NextResponse.json({ blocks: [] });
  }
}

export async function POST(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;
  const session = await getAuthSession();

  let body: { name?: string; description?: string; accountKey?: string | null; accountKeys?: string[]; doc?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!parseBlockDoc(JSON.stringify(body.doc))) {
    return NextResponse.json({ error: 'doc must be a block payload (elements + boxes)' }, { status: 400 });
  }
  // Subaccount scope: a de-duped list of account keys (empty = global). Accepts
  // the new `accountKeys` array; falls back to the legacy single `accountKey`.
  const requested = Array.isArray(body.accountKeys)
    ? body.accountKeys
    : typeof body.accountKey === 'string' && body.accountKey.trim()
      ? [body.accountKey.trim()]
      : [];
  const accountKeys = [...new Set(requested.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim()))];

  // A scoped admin may only assign a block to accounts they can access.
  const scope = getAccountScope(session!);
  if (scope !== null) {
    const denied = accountKeys.filter((k) => !scope.includes(k));
    if (denied.length) return NextResponse.json({ error: `Access denied for: ${denied.join(', ')}` }, { status: 403 });
  }

  const u = session?.user as { name?: string | null; email?: string | null; image?: string | null } | undefined;
  try {
    const row = await prisma.adBlock.create({
      data: {
        name,
        description: body.description?.trim() || null,
        doc: JSON.stringify(body.doc),
        accountKey: null, // superseded by accountKeys (kept for legacy reads)
        accountKeys: accountKeys.length ? JSON.stringify(accountKeys) : null,
        createdBy: u?.email ?? null,
        createdByName: u?.name ?? null,
        createdByEmail: u?.email ?? null,
        createdByImage: u?.image ?? null,
      },
    });
    return NextResponse.json({ block: { id: row.id, name: row.name, accountKeys } });
  } catch (err) {
    console.error('[api/ad-generator/blocks] create failed:', err);
    return NextResponse.json(
      { error: 'Could not save — has the table been migrated in this environment?' },
      { status: 500 },
    );
  }
}
