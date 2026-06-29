import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { adPlatformWhere, canAccessPacer, getOrCreatePlan, isValidPeriod } from '@/lib/meta-ads-pacer';

/**
 * The automatic audit log (Change 10) for an account+period: every tracked
 * change with who / what / from→to / when, newest first. Read-only.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ accountKey: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { accountKey } = await params;
  if (!canAccessPacer(session, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const period = req.nextUrl.searchParams.get('period');
  if (!period || !isValidPeriod(period)) {
    return NextResponse.json(
      { error: 'Missing or invalid period (expected YYYY-MM)' },
      { status: 400 },
    );
  }

  const platform =
    req.nextUrl.searchParams.get('platform') === 'google' ? 'google' : 'meta';
  const plan = await getOrCreatePlan(accountKey);
  const entries = await prisma.metaAdsPacerAuditEntry.findMany({
    where: { planId: plan.id, period, ...adPlatformWhere(platform) },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  // Resolve author names in one round-trip.
  const userIds = [...new Set(entries.map((e) => e.authorUserId).filter(Boolean))] as string[];
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, avatarUrl: true },
        })
      : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  return NextResponse.json({
    accountKey,
    period,
    entries: entries.map((e) => ({
      id: e.id,
      adId: e.adId,
      adName: e.adName,
      action: e.action,
      field: e.field,
      fromValue: e.fromValue,
      toValue: e.toValue,
      summary: e.summary,
      groupId: e.groupId,
      authorName: e.authorUserId
        ? (byId.get(e.authorUserId)?.name ?? 'Unknown')
        : 'System',
      authorEmail: e.authorUserId ? (byId.get(e.authorUserId)?.email ?? null) : null,
      authorAvatarUrl: e.authorUserId
        ? (byId.get(e.authorUserId)?.avatarUrl ?? null)
        : null,
      createdAt: e.createdAt.toISOString(),
    })),
  });
}
