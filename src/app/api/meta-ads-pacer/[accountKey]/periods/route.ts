import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import {
  canAccessPacer,
  getOrCreatePlan,
  listPeriods,
} from '@/lib/meta-ads-pacer';

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

  // Scope the period list (+ ad counts) to the caller's platform so the Google
  // copy modal only offers months that actually have Google lines.
  const platform = req.nextUrl.searchParams.get('platform') === 'google' ? 'google' : 'meta';
  const plan = await getOrCreatePlan(accountKey);
  const periods = await listPeriods(plan.id, platform);
  return NextResponse.json({ accountKey, periods });
}
