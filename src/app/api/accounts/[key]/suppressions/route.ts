import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';
import {
  OPT_OUT_SOURCE,
  recordEmailOptOut,
  type EmailOptOutReason,
} from '@/lib/sending/opt-outs';

interface RouteParams {
  params: Promise<{ key: string }>;
}

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
 * GET /api/accounts/[key]/suppressions?channel=&search=&reason=&limit=&offset=
 *
 * Returns the suppression list for this account, optionally filtered
 * by reason (bounce|spamreport|unsubscribe|manual|crm-optout) or a
 * substring search on the address. Paginated; the response includes
 * `total` so the UI can render an accurate count.
 *
 * `channel=sms` lists the texting opt-outs instead (SmsSuppression) — rows
 * carry `phone` rather than `email`. Without it the list was email-only,
 * so phone numbers brought over in an import had nowhere to be seen.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { error, session } = await requirePermission('agency.subaccounts.view');
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

  if (req.nextUrl.searchParams.get('channel') === 'sms') {
    return listSmsSuppressions(key, { search, reason, limit, offset });
  }

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
 * Manual entries default to reason='manual' + source='manual', and land at
 * this account AND every other account in its group — an opt-out added at
 * one rooftop used to stay at that rooftop. Re-adding an address that's
 * already listed can raise its reason (promoting a manual entry to
 * spamreport) but never lower it: re-adding someone who unsubscribed as
 * 'manual' used to relabel their unsubscribe as something staff may clear.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { error, session } = await requirePermission('agency.subaccounts.edit');
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
  if (!isManualReason(rawReason)) {
    return NextResponse.json({ error: 'Invalid reason.' }, { status: 400 });
  }

  const recorded = await recordEmailOptOut({
    accountKey: key,
    email: rawEmail,
    reason: rawReason,
    source: OPT_OUT_SOURCE.manual,
  });

  const row = await prisma.emailSuppression.findUnique({
    where: { accountKey_email: { accountKey: key, email: rawEmail } },
  });

  return NextResponse.json(
    { suppression: row, accounts: recorded.accountKeys.length },
    { status: 201 },
  );
}

const MANUAL_REASONS: readonly EmailOptOutReason[] = ['bounce', 'spamreport', 'unsubscribe', 'manual'];

function isManualReason(value: string): value is EmailOptOutReason {
  return (MANUAL_REASONS as readonly string[]).includes(value);
}

async function listSmsSuppressions(
  accountKey: string,
  { search, reason, limit, offset }: { search: string; reason: string; limit: number; offset: number },
): Promise<NextResponse> {
  const where: {
    accountKey: string;
    reason?: string;
    phone?: { contains: string };
  } = { accountKey };
  if (reason) where.reason = reason;
  // Phones are stored E.164 ("+18015550134"), so "(801) 555" has to be
  // searched as its digits to match anything.
  if (search) where.phone = { contains: search.replace(/\D/g, '') || search };

  const [rows, total, reasonGroups] = await Promise.all([
    prisma.smsSuppression.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        phone: true,
        reason: true,
        source: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.smsSuppression.count({ where }),
    prisma.smsSuppression.groupBy({
      by: ['reason'],
      where: { accountKey },
      _count: { _all: true },
    }),
  ]);

  const reasonCounts: Record<string, number> = {};
  for (const g of reasonGroups) {
    reasonCounts[g.reason] = g._count._all;
  }

  return NextResponse.json({ rows, total, limit, offset, reasonCounts });
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}
