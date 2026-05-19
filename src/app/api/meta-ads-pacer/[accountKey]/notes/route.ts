import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { canAccessPacer } from '@/lib/meta-ads-pacer';

/**
 * Account-level chat log for the Meta Ads Pacer. List + create notes
 * tied to the account itself (distinct from per-ad notes). Notes are
 * surfaced from a chat icon next to the period selector (subaccount
 * view) and next to each account's budget totals (admin overview).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ accountKey: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { accountKey } = await params;
  if (!canAccessPacer(session, accountKey)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const notes = await prisma.metaAdsPacerAccountNote.findMany({
    where: { accountKey },
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

  const body = (await req.json()) as { text?: string };
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return NextResponse.json({ error: 'Text is required' }, { status: 400 });
  }

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
      text,
      authorUserId: session!.user.id,
    },
  });
  return NextResponse.json(note, { status: 201 });
}
