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
  category: string | null;
  tags: string | null;
  updatedAt: Date;
  createdByName: string | null;
  createdByEmail: string | null;
  createdByImage: string | null;
};

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
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
    const rows = (await prisma.adBlock.findMany({
      where: {
        isActive: true,
        OR: [{ accountKey: null }, ...(allowedKey ? [{ accountKey: allowedKey }] : [])],
      },
      orderBy: { name: 'asc' },
    })) as Row[];
    return NextResponse.json({ blocks: rows.map(shape).filter((b) => b.doc) });
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

  let body: { name?: string; description?: string; accountKey?: string | null; doc?: unknown };
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
  const accountKey =
    typeof body.accountKey === 'string' && body.accountKey.trim() ? body.accountKey.trim() : null;

  // A scoped admin may only save a block to an account they can access.
  if (accountKey) {
    const scope = getAccountScope(session!);
    if (scope !== null && !scope.includes(accountKey)) {
      return NextResponse.json({ error: 'Access denied for that account' }, { status: 403 });
    }
  }

  const u = session?.user as { name?: string | null; email?: string | null; image?: string | null } | undefined;
  try {
    const row = await prisma.adBlock.create({
      data: {
        name,
        description: body.description?.trim() || null,
        doc: JSON.stringify(body.doc),
        accountKey,
        createdBy: u?.email ?? null,
        createdByName: u?.name ?? null,
        createdByEmail: u?.email ?? null,
        createdByImage: u?.image ?? null,
      },
    });
    return NextResponse.json({ block: { id: row.id, name: row.name, accountKey: row.accountKey } });
  } catch (err) {
    console.error('[api/ad-generator/blocks] create failed:', err);
    return NextResponse.json(
      { error: 'Could not save — has the table been migrated in this environment?' },
      { status: 500 },
    );
  }
}
