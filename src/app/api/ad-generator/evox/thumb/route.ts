/**
 * EVOX color-swatch thumbnail proxy — GET /api/ad-generator/evox/thumb?vifnum=&color=
 *
 * Streams a small (640px) transparent-PNG for a vehicle+color so the picker's
 * per-color swatch shows the ACTUAL jellybean (EVOX's YMM search returns color
 * names but no swatch image/hex). Proxied (not re-hosted to S3) since it's just a
 * preview; long-cached. 404 when unavailable so the client falls back to a chip.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { evoxConfigured, resolveThumbBytes } from '@/lib/integrations/evox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!evoxConfigured()) return NextResponse.json({ error: 'EVOX not configured' }, { status: 400 });

  const vifnum = Number(req.nextUrl.searchParams.get('vifnum'));
  const color = (req.nextUrl.searchParams.get('color') || '').trim();
  if (!vifnum || !color) return NextResponse.json({ error: 'vifnum and color are required' }, { status: 400 });

  const buf = await resolveThumbBytes(vifnum, color);
  if (!buf) return NextResponse.json({ error: 'No thumbnail' }, { status: 404 });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'image/png',
      // Immutable per vehicle+color — cache hard so re-opening the picker is instant.
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
