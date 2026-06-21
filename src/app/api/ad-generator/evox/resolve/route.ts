/**
 * EVOX image resolve — POST /api/ad-generator/evox/resolve
 *
 * Body: { vifnum, colorCode, accountKey?, hint? }. Resolves the chosen
 * vehicle+color to a hi-res (2400px) transparent PNG, re-hosts it on our S3
 * (EVOX CDN URLs are pre-signed and expire), and returns our stable URL — ready
 * to drop into an ad's image field. Flag- + auth-gated.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import { AD_GENERATOR_ENABLED } from '@/lib/feature-flags';
import { evoxConfigured, resolveImageUrl, importEvoxImage } from '@/lib/integrations/evox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  if (!AD_GENERATOR_ENABLED) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!evoxConfigured()) return NextResponse.json({ error: 'EVOX is not configured' }, { status: 400 });

  let body: { vifnum?: number | string; colorCode?: string; accountKey?: string; hint?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const vifnum = Number(body.vifnum);
  const colorCode = (body.colorCode ?? '').trim();
  if (!vifnum || !colorCode) {
    return NextResponse.json({ error: 'vifnum and colorCode are required' }, { status: 400 });
  }

  try {
    const evoxUrl = await resolveImageUrl(vifnum, colorCode, true);
    if (!evoxUrl) return NextResponse.json({ error: 'No image available for that vehicle/color' }, { status: 404 });
    const url = await importEvoxImage(evoxUrl, body.accountKey?.trim() || null, body.hint || `${vifnum}-${colorCode}`);
    return NextResponse.json({ url });
  } catch (err) {
    console.error('[api/ad-generator/evox/resolve] failed:', err);
    return NextResponse.json({ error: 'Could not import the image' }, { status: 500 });
  }
}
