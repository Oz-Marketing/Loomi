/**
 * Ad creative — GET / PATCH / DELETE one (by id). Flag- + auth-gated.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import { AD_GENERATOR_ENABLED } from '@/lib/feature-flags';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!AD_GENERATOR_ENABLED) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const row = await prisma.adCreative.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    let data: Record<string, string> = {};
    try {
      data = JSON.parse(row.data) ?? {};
    } catch {
      data = {};
    }
    return NextResponse.json({
      creative: { id: row.id, accountKey: row.accountKey, name: row.name, templateId: row.templateId, status: row.status, data },
    });
  } catch (err) {
    console.warn('[api/ad-generator/creatives/[id]] GET failed:', err);
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!AD_GENERATOR_ENABLED) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  let body: { name?: string; data?: Record<string, string>; status?: string; thumbnailUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const data: Record<string, unknown> = {};
  if (typeof body.name === 'string') data.name = body.name.trim() || 'Untitled ad';
  if (body.data && typeof body.data === 'object') data.data = JSON.stringify(body.data);
  if (typeof body.status === 'string') data.status = body.status === 'ready' ? 'ready' : 'draft';
  if (typeof body.thumbnailUrl === 'string') data.thumbnailUrl = body.thumbnailUrl;

  try {
    const row = await prisma.adCreative.update({ where: { id }, data });
    return NextResponse.json({ creative: { id: row.id, name: row.name, status: row.status } });
  } catch (err) {
    console.error('[api/ad-generator/creatives/[id]] update failed:', err);
    return NextResponse.json({ error: 'Could not update' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!AD_GENERATOR_ENABLED) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    await prisma.adCreative.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/ad-generator/creatives/[id]] delete failed:', err);
    return NextResponse.json({ error: 'Could not delete' }, { status: 500 });
  }
}
