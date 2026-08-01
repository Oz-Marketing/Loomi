import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAccountScope, forbidden } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as budget from '@/lib/services/budget';

/**
 * POST /api/budget/flights — book a media buy as a date range.
 *
 * The months and their amounts are DERIVED from the range, split by days. The
 * client never sends a per-month figure; if it could, the parts and the total
 * would drift the first time someone edited one of them.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const accountKey = typeof body.accountKey === 'string' ? body.accountKey : '';
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }
  if (!budget.canAccess(getAccountScope(session!), accountKey)) return forbidden();

  try {
    const lines = await budget.createFlight(
      {
        accountKey,
        spendAccountKey:
          typeof body.spendAccountKey === 'string' ? body.spendAccountKey : null,
        channel: String(body.channel ?? ''),
        startDate: String(body.startDate ?? ''),
        endDate: String(body.endDate ?? ''),
        amount: Number(body.amount),
        markup: body.markup == null ? null : Number(body.markup),
        status: typeof body.status === 'string' ? body.status : undefined,
        bucket: typeof body.bucket === 'string' ? body.bucket : undefined,
        lineType: body.lineType,
        agreementId: typeof body.agreementId === 'string' ? body.agreementId : null,
        label: typeof body.label === 'string' ? body.label : null,
        notes: typeof body.notes === 'string' ? body.notes : null,
      },
      session!.user.id,
    );
    return NextResponse.json({ lines, flightId: lines[0]?.flightId ?? null }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not book the flight' },
      { status: 400 },
    );
  }
}
