/**
 * Ad size library — PATCH (rename / resize) or DELETE one preset.
 * Flag- + auth-gated. Editing a preset only affects future "add size" picks;
 * docs copy a size's dimensions when added, so existing layouts are untouched.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { name?: string; width?: number | string; height?: number | string };
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

  const { id } = await params;
  try {
    const size = await prisma.adSizePreset.update({ where: { id }, data: { name, width, height } });
    return NextResponse.json({ size });
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
