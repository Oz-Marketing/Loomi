import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

interface RouteParams {
  params: Promise<{ key: string }>;
}

const MANAGEMENT_ROLES = ['developer', 'super_admin', 'admin'] as const;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function assertAdminScope(
  role: string,
  userKeys: string[],
  accountKey: string,
): NextResponse | null {
  if (role === 'admin' && userKeys.length > 0 && !userKeys.includes(accountKey)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

/**
 * GET /api/accounts/[key]/suppressions?search=&reason=&limit=&offset=
 *
 * Returns the suppression list for this sub-account, optionally filtered
 * by reason (bounce|spamreport|unsubscribe|manual) or a substring search
 * on the email column. Paginated; the response includes `total` so the
 * UI can render an accurate count.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { error, session } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const { key } = await params;
  const scope = assertAdminScope(
    session!.user.role,
    session!.user.accountKeys ?? [],
    key,
  );
  if (scope) return scope;

  const search = req.nextUrl.searchParams.get('search')?.trim() || '';
  const reason = req.nextUrl.searchParams.get('reason')?.trim() || '';
  const limit = clamp(
    Number(req.nextUrl.searchParams.get('limit')) || DEFAULT_PAGE_SIZE,
    1,
    MAX_PAGE_SIZE,
  );
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get('offset')) || 0);

  const where: {
    accountKey: string;
    reason?: string;
    email?: { contains: string; mode: 'insensitive' };
  } = { accountKey: key };
  if (reason) where.reason = reason;
  if (search) where.email = { contains: search, mode: 'insensitive' };

  const [rows, total, reasonGroups] = await Promise.all([
    prisma.emailSuppression.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        email: true,
        reason: true,
        source: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.emailSuppression.count({ where }),
    // Side query: total per-reason counts (unfiltered by the search box)
    // so the filter chips can show a count next to each reason.
    prisma.emailSuppression.groupBy({
      by: ['reason'],
      where: { accountKey: key },
      _count: { _all: true },
    }),
  ]);

  const reasonCounts: Record<string, number> = {};
  for (const g of reasonGroups) {
    reasonCounts[g.reason] = g._count._all;
  }

  return NextResponse.json({
    rows,
    total,
    limit,
    offset,
    reasonCounts,
  });
}

/**
 * POST /api/accounts/[key]/suppressions
 *
 * Body: { email: string, reason?: 'bounce' | 'spamreport' | 'unsubscribe' | 'manual' }
 *
 * Manual entries default to reason='manual' + source='manual'. Existing
 * (accountKey, email) tuples are updated rather than rejected so re-adds
 * with a stricter reason (e.g. promoting a manual entry to spamreport)
 * just refresh the row.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { error, session } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const { key } = await params;
  const scope = assertAdminScope(
    session!.user.role,
    session!.user.accountKeys ?? [],
    key,
  );
  if (scope) return scope;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const rawReason = typeof body.reason === 'string' ? body.reason : 'manual';

  if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (!['bounce', 'spamreport', 'unsubscribe', 'manual'].includes(rawReason)) {
    return NextResponse.json({ error: 'Invalid reason.' }, { status: 400 });
  }

  const row = await prisma.emailSuppression.upsert({
    where: { accountKey_email: { accountKey: key, email: rawEmail } },
    create: {
      accountKey: key,
      email: rawEmail,
      reason: rawReason,
      source: 'manual',
    },
    update: {
      reason: rawReason,
      // Don't overwrite an automated 'sendgrid' source if the user adds
      // the same email manually — the original source has more weight.
    },
  });

  return NextResponse.json({ suppression: row }, { status: 201 });
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}
