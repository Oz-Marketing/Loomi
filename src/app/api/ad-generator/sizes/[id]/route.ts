/**
 * Ad size library — DELETE one preset. Flag- + auth-gated.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import { AD_GENERATOR_ENABLED } from '@/lib/feature-flags';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!AD_GENERATOR_ENABLED) return NextResponse.json({ error: 'Not found' }, { status: 404 });
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
