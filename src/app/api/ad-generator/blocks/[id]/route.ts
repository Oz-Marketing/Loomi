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
    const block = await prisma.adBlock.findUnique({ where: { id }, select: { accountKey: true } });
    if (!block) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (block.accountKey) {
      const scope = getAccountScope(session!);
      if (scope !== null && !scope.includes(block.accountKey)) {
        return NextResponse.json({ error: 'Access denied for that account' }, { status: 403 });
      }
    }
    await prisma.adBlock.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/ad-generator/blocks/[id]] delete failed:', err);
    return NextResponse.json({ error: 'Could not delete this block' }, { status: 500 });
  }
}
