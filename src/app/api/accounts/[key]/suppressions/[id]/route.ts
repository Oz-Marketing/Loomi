import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

interface RouteParams {
  params: Promise<{ key: string; id: string }>;
}

const MANAGEMENT_ROLES = ['developer', 'super_admin', 'admin'] as const;

/**
 * DELETE /api/accounts/[key]/suppressions/[id]
 *
 * Remove a single suppression row. Useful for re-enabling sends after a
 * customer says "you should mail me, I never unsubscribed" — operations
 * trust call. We don't tombstone or audit-trail the removal here; if
 * that becomes a need, add a separate SuppressionEvent table.
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { error, session } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const { key, id } = await params;
  const userKeys = session!.user.accountKeys ?? [];
  if (session!.user.role === 'admin' && userKeys.length > 0 && !userKeys.includes(key)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Scoped delete: the (accountKey, id) pair guards against an admin
  // assigned to one sub-account from blowing away rows in another by
  // guessing IDs.
  const result = await prisma.emailSuppression.deleteMany({
    where: { id, accountKey: key },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: 'Suppression not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
