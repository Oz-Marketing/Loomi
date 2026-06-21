/**
 * Ad size library — /api/ad-generator/sizes
 *
 * A shared, named library of ad sizes the builder draws from. Anyone signed in
 * can list or add one; each row records its creator (name / email / avatar) +
 * timestamp. Flag-gated; resilient (unmigrated table → empty list).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import { AD_GENERATOR_ENABLED } from '@/lib/feature-flags';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!AD_GENERATOR_ENABLED) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const sizes = await prisma.adSizePreset.findMany({ orderBy: { createdAt: 'desc' } });
    return NextResponse.json({ sizes });
  } catch (err) {
    console.warn('[api/ad-generator/sizes] falling back to []:', err);
    return NextResponse.json({ sizes: [] });
  }
}

export async function POST(req: NextRequest) {
  if (!AD_GENERATOR_ENABLED) return NextResponse.json({ error: 'Not found' }, { status: 404 });
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

  const u = session.user as { id?: string; name?: string | null; email?: string | null; image?: string | null };
  try {
    const size = await prisma.adSizePreset.create({
      data: {
        name,
        width,
        height,
        createdById: u.id ?? null,
        createdByName: u.name ?? null,
        createdByEmail: u.email ?? null,
        createdByImage: u.image ?? null,
      },
    });
    return NextResponse.json({ size });
  } catch (err) {
    console.error('[api/ad-generator/sizes] create failed:', err);
    return NextResponse.json({ error: 'Could not save — has the table been migrated in this environment?' }, { status: 500 });
  }
}
