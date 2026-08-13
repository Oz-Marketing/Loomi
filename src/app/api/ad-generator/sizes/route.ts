/**
 * Ad size library — /api/ad-generator/sizes
 *
 * THE size list: every picker in the generator reads this route, so a size added
 * here shows up everywhere. Sizes are organized by free-form tags describing
 * what they're used for; the response carries the tag vocabulary in use so a
 * picker can offer it without a second request.
 *
 * Anyone signed in can list or add one; each row records its creator (name /
 * email / avatar) + timestamp. Flag-gated; resilient (unmigrated table → empty
 * list).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { normalizeTags, tagFacets, UNTAGGED } from '@/lib/ad-generator/ad-size-library';
import { listSizeLibrary, toLibrarySize } from '@/lib/ad-generator/size-library-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const sizes = await listSizeLibrary();
    const tags = tagFacets(sizes)
      .map((f) => f.tag)
      .filter((t) => t !== UNTAGGED);
    return NextResponse.json({ sizes, tags });
  } catch (err) {
    console.warn('[api/ad-generator/sizes] falling back to []:', err);
    return NextResponse.json({ sizes: [], tags: [] });
  }
}

export async function POST(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { name?: string; width?: number | string; height?: number | string; tags?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const name = (body.name ?? '').trim();
  const width = Math.round(Number(body.width));
  const height = Math.round(Number(body.height));
  if (!name || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return NextResponse.json({ error: 'name, width, and height are required' }, { status: 400 });
  }

  const u = session.user as { id?: string; name?: string | null; email?: string | null; image?: string | null };
  try {
    const size = await prisma.adSizePreset.create({
      data: {
        name,
        width,
        height,
        tags: JSON.stringify(normalizeTags(body.tags)),
        createdById: u.id ?? null,
        createdByName: u.name ?? null,
        createdByEmail: u.email ?? null,
        createdByImage: u.image ?? null,
      },
    });
    return NextResponse.json({ size: toLibrarySize(size) });
  } catch (err) {
    console.error('[api/ad-generator/sizes] create failed:', err);
    return NextResponse.json({ error: 'Could not save — has the table been migrated in this environment?' }, { status: 500 });
  }
}
