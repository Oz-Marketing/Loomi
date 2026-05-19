import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { canAccessPacer } from '@/lib/meta-ads-pacer';

/**
 * Delete a single budget-log entry. Anyone with pacer access on the
 * parent account can remove entries (matches notes behavior).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ accountKey: string; logId: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { accountKey, logId } = await params;
  if (!canAccessPacer(session, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const entry = await prisma.metaAdsPacerBudgetLog.findUnique({
    where: { id: logId },
    select: { accountKey: true },
  });
  if (!entry || entry.accountKey !== accountKey) {
    return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
  }

  await prisma.metaAdsPacerBudgetLog.delete({ where: { id: logId } });
  return NextResponse.json({ ok: true });
}
