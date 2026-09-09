/**
 * Reusable email blocks — /api/email-blocks
 *
 * The email side of `/api/ad-generator/blocks`. A block is a saved subtree of v2
 * email blocks a designer inserts from the editor's Custom blocks palette, so a
 * layout like the OEM offer card can be authored and changed by a designer
 * instead of living in `offer-email-doc.ts`.
 *
 * - GET  → active blocks the caller can use: global + the requested account's
 *          (?accountKey=). `?repeatOver=offer` narrows to the offer cards.
 * - POST → create. Managers only, same bar as authoring a template.
 *
 * Resilient: an unmigrated table makes GET return [], because the palette must
 * still open.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseKeys(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const accountKey = (req.nextUrl.searchParams.get('accountKey') || '').trim();
  const repeatOver = (req.nextUrl.searchParams.get('repeatOver') || '').trim();

  try {
    const rows = await prisma.emailBlock.findMany({
      where: {
        isActive: true,
        ...(repeatOver ? { repeatOver } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });

    // `accountKeys` is a JSON array, not a scalar, so the scope filter can't be
    // pushed into the query. Empty list = global, which every account sees.
    const mine = rows.filter((r) => {
      const keys = parseKeys(r.accountKeys);
      return keys.length === 0 || (!!accountKey && keys.includes(accountKey));
    });

    return NextResponse.json({
      blocks: mine.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        doc: r.doc,
        repeatOver: r.repeatOver,
        accountKeys: parseKeys(r.accountKeys),
        category: r.category,
        updatedAt: r.updatedAt,
        createdByName: r.createdByName,
      })),
    });
  } catch (err) {
    console.warn('[api/email-blocks] falling back to []:', err);
    return NextResponse.json({ blocks: [] });
  }
}

export async function POST(req: NextRequest) {
  const { session, error } = await requirePermission('studio.templates.edit');
  if (error) return error;

  let body: {
    name?: string;
    description?: string;
    doc?: unknown;
    repeatOver?: string | null;
    accountKeys?: string[];
    category?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  // The doc is stored as a string so it round-trips byte-for-byte, but it has to
  // BE a block subtree — a malformed one would fail at insert time, in the
  // editor, with no clue where it came from.
  const blocks = (body.doc as { blocks?: unknown })?.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return NextResponse.json({ error: 'Nothing to save' }, { status: 400 });
  }

  const repeat = (body.repeatOver ?? '').trim();
  try {
    const row = await prisma.emailBlock.create({
      data: {
        name,
        description: (body.description ?? '').trim() || null,
        doc: JSON.stringify({ version: 1, blocks }),
        repeatOver: repeat || null,
        accountKeys: Array.isArray(body.accountKeys) && body.accountKeys.length
          ? JSON.stringify(body.accountKeys.filter((k) => typeof k === 'string' && k.trim()))
          : null,
        category: (body.category ?? '').trim() || null,
        createdBy: session!.user.id,
        createdByName: session!.user.name ?? null,
        createdByEmail: session!.user.email ?? null,
        createdByImage: session!.user.avatarUrl ?? null,
      },
      select: { id: true, name: true },
    });
    return NextResponse.json({ block: row }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save block';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
