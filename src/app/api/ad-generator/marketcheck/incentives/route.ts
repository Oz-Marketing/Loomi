/**
 * MarketCheck OEM incentives — POST /api/ad-generator/marketcheck/incentives
 *
 * Body: { make, model?, year, zip? }. Returns the OEM lease/APR/cash programs
 * for that vehicle. Flag- + auth-gated; returns `{ configured: false }` (not an
 * error) when MARKETCHECK_API_KEY is unset so the panel can show a hint.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { marketcheckConfigured, getIncentives } from '@/lib/integrations/marketcheck';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!marketcheckConfigured()) return NextResponse.json({ configured: false, incentives: [] });

  let body: { make?: string; model?: string; year?: number | string; zip?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const make = (body.make ?? '').trim();
  const model = (body.model ?? '').trim();
  const year = Number(body.year);
  const zip = (body.zip ?? '').trim();
  if (!make || !year) {
    return NextResponse.json({ error: 'make and year are required' }, { status: 400 });
  }

  try {
    const { incentives, usedYear, usedNational } = await getIncentives(make, model, year, zip || undefined);
    return NextResponse.json({ configured: true, incentives, usedYear, usedNational });
  } catch (err) {
    console.error('[api/ad-generator/marketcheck/incentives] failed:', err);
    return NextResponse.json({ configured: true, incentives: [], error: 'MarketCheck lookup failed' });
  }
}
