import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { resolveJellybean, resolveJellybeanBytes } from '@/lib/integrations/evox-jellybean';
import { isS3Configured } from '@/lib/s3';

// GET /api/vehicle-image?year=&make=&model=&color=
//
// Vehicle "jellybean" for any year/make/model — usable directly as an <img src>.
// Vehicle-agnostic (EVOX stock imagery, not customer data), so it's keyed by
// vehicle config rather than contact: one route serves every vehicle in a
// contact's garage.
//
// With S3 configured we redirect to the cached, pre-cropped object (free after
// the first resolve). Without it we stream freshly-cropped bytes. 404 when
// unavailable so the caller can fall back to its placeholder.

export async function GET(req: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const year = sp.get('year') ?? '';
  const make = sp.get('make') ?? '';
  const model = sp.get('model') ?? '';
  const color = sp.get('color') ?? '';
  if (!year || !make || !model) {
    return new NextResponse(null, { status: 404 });
  }

  const input = { year, make, model, color };

  if (isS3Configured()) {
    const resolved = await resolveJellybean(input);
    if (resolved?.url) return NextResponse.redirect(resolved.url);
    return new NextResponse(null, { status: 404 });
  }

  const bytes = await resolveJellybeanBytes(input);
  if (!bytes) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
