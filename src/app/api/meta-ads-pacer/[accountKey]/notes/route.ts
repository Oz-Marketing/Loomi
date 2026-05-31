import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { canAccessPacer, isValidPeriod } from '@/lib/meta-ads-pacer';

/**
 * Account-level chat log for the Meta Ads Pacer. List + create notes tied to
 * the account itself (distinct from per-ad notes), scoped to a month: a
 * `?period=YYYY-MM` returns only that month's comments. Surfaced from a chat
 * icon in the account header and next to each account on the admin overview.
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
  const notes = await prisma.metaAdsPacerAccountNote.findMany({
    where: { accountKey, ...(period && isValidPeriod(period) ? { period } : {}) },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({ notes });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ accountKey: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { accountKey } = await params;
  if (!canAccessPacer(session, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const body = (await req.json()) as { text?: string; period?: string };
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return NextResponse.json({ error: 'Text is required' }, { status: 400 });
  }
  const period =
    typeof body.period === 'string' && isValidPeriod(body.period)
      ? body.period
      : null;

  // Guard against a non-existent account (foreign key would throw a less
  // useful error otherwise).
  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true },
  });
  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  const note = await prisma.metaAdsPacerAccountNote.create({
    data: {
      accountKey,
      period,
      text,
      authorUserId: session!.user.id,
    },
  });
  return NextResponse.json(note, { status: 201 });
}
