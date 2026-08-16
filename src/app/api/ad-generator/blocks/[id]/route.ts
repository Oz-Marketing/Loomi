/**
 * Ad Generator reusable blocks — /api/ad-generator/blocks/[id]
 *
 * PATCH  → rename / re-scope / overwrite a block (managers).
 * DELETE → soft-delete a block (managers). A block scoped to a subaccount can
 * only be edited/deleted by someone who can access that account.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, getAccountScope } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Union of a block's assigned account keys (legacy single + the array). */
function blockKeys(block: { accountKey: string | null; accountKeys: string | null }): Set<string> {
  const keys = new Set<string>();
  if (block.accountKey) keys.add(block.accountKey);
  try {
    const arr = block.accountKeys ? JSON.parse(block.accountKeys) : [];
    if (Array.isArray(arr)) for (const k of arr) if (typeof k === 'string') keys.add(k);
  } catch {
    /* ignore malformed */
  }
  return keys;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requirePermission('studio.adgen.edit');
  if (error) return error;
  const session = await getAuthSession();
  const { id } = await params;

  let body: { name?: string; description?: string; accountKeys?: string[]; doc?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const block = await prisma.adBlock.findUnique({ where: { id }, select: { accountKey: true, accountKeys: true } });
  if (!block) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const scope = getAccountScope(session!);
  const current = blockKeys(block);
  // A scoped admin can only touch a block they can access ALL accounts of.
  if (scope !== null && current.size && [...current].some((k) => !scope.includes(k))) {
    return NextResponse.json({ error: 'Access denied for that account' }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    data.name = name;
  }
  if (typeof body.description === 'string') data.description = body.description.trim() || null;
  if (Array.isArray(body.accountKeys)) {
    const next = [...new Set(body.accountKeys.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim()))];
    if (scope !== null) {
      const denied = next.filter((k) => !scope.includes(k));
      if (denied.length) return NextResponse.json({ error: `Access denied for: ${denied.join(', ')}` }, { status: 403 });
    }
    data.accountKeys = next.length ? JSON.stringify(next) : null;
    data.accountKey = null; // supersede the legacy single-scope column
  }
  if (body.doc !== undefined) {
    const doc = body.doc as { elements?: unknown; boxes?: unknown } | null;
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.elements) || typeof doc.boxes !== 'object') {
      return NextResponse.json({ error: 'doc must be a block payload (elements + boxes)' }, { status: 400 });
    }
    data.doc = JSON.stringify(body.doc);
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  try {
    await prisma.adBlock.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/ad-generator/blocks/[id]] patch failed:', err);
    return NextResponse.json({ error: 'Could not update this block' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requirePermission('studio.adgen.edit');
  if (error) return error;
  const session = await getAuthSession();
  const { id } = await params;

  try {
    const block = await prisma.adBlock.findUnique({ where: { id }, select: { accountKey: true, accountKeys: true } });
    if (!block) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // Union of the block's assigned accounts (legacy single + the array).
    const keys = new Set<string>();
    if (block.accountKey) keys.add(block.accountKey);
    try {
      const arr = block.accountKeys ? JSON.parse(block.accountKeys) : [];
      if (Array.isArray(arr)) for (const k of arr) if (typeof k === 'string') keys.add(k);
    } catch {
      /* ignore malformed */
    }
    const scope = getAccountScope(session!);
    // A scoped admin may only delete a block if they can access ALL its accounts.
    if (scope !== null && keys.size && [...keys].some((k) => !scope.includes(k))) {
      return NextResponse.json({ error: 'Access denied for that account' }, { status: 403 });
    }
    await prisma.adBlock.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/ad-generator/blocks/[id]] delete failed:', err);
    return NextResponse.json({ error: 'Could not delete this block' }, { status: 500 });
  }
}
