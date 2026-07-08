/**
 * Ad Generator reusable blocks — /api/ad-generator/blocks/[id]
 *
 * DELETE → soft-delete a block (managers). A block scoped to a subaccount can
 * only be deleted by someone who can access that account.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, getAccountScope, requireRole } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
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
