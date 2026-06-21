/**
 * EVOX vehicle search — POST /api/ad-generator/evox/search
 *
 * Body: { year, make, model, trim? }. Returns the matching trims, each with its
 * available colors + 640px transparent-PNG thumbnails. Flag- + auth-gated;
 * returns `{ configured: false }` (not an error) when EVOX_API_KEY is unset so
 * the picker can show a friendly "not configured" state.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import { AD_GENERATOR_ENABLED } from '@/lib/feature-flags';
import { evoxConfigured, searchVehicles } from '@/lib/integrations/evox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  if (!AD_GENERATOR_ENABLED) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!evoxConfigured()) return NextResponse.json({ configured: false, vehicles: [] });

  let body: { year?: number | string; make?: string; model?: string; trim?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const year = Number(body.year);
  const make = (body.make ?? '').trim();
  const model = (body.model ?? '').trim();
  const trim = (body.trim ?? '').trim() || undefined;
  if (!year || !make || !model) {
    return NextResponse.json({ error: 'year, make, and model are required' }, { status: 400 });
  }

  try {
    const vehicles = await searchVehicles(year, make, model, trim);
    return NextResponse.json({ configured: true, vehicles });
  } catch (err) {
    console.error('[api/ad-generator/evox/search] failed:', err);
    return NextResponse.json({ configured: true, vehicles: [], error: 'EVOX search failed' });
  }
}
