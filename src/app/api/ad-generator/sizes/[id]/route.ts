/**
 * Ad size library — PATCH (rename / resize / retag) or DELETE one size.
 * Flag- + auth-gated. Editing a size only affects future "add size" picks; docs
 * copy a size's dimensions when added, so existing layouts are untouched.
 *
 * Every field is optional on PATCH so the tag editor can save tags alone without
 * re-sending (and risking clobbering) the name and dimensions.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { normalizeTags } from '@/lib/ad-generator/ad-size-library';
import { toLibrarySize } from '@/lib/ad-generator/size-library-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { name?: string; width?: number | string; height?: number | string; tags?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const data: { name?: string; width?: number; height?: number; tags?: string } = {};

  if (body.name !== undefined || body.width !== undefined || body.height !== undefined) {
    const name = (body.name ?? '').trim();
    const width = Math.round(Number(body.width));
    const height = Math.round(Number(body.height));
    if (!name || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      return NextResponse.json({ error: 'name, width, and height are required' }, { status: 400 });
    }
    data.name = name;
    data.width = width;
    data.height = height;
  }
  if (body.tags !== undefined) data.tags = JSON.stringify(normalizeTags(body.tags));

  if (!Object.keys(data).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  const { id } = await params;
  try {
    const size = await prisma.adSizePreset.update({ where: { id }, data });
    return NextResponse.json({ size: toLibrarySize(size) });
  } catch (err) {
    console.error('[api/ad-generator/sizes/[id]] update failed:', err);
    return NextResponse.json({ error: 'Could not update size' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    await prisma.adSizePreset.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/ad-generator/sizes/[id]] delete failed:', err);
    return NextResponse.json({ error: 'Could not delete size' }, { status: 500 });
  }
}
