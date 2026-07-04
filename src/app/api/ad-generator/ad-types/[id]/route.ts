/**
 * Ad Generator — a single Ad Type. GET / PATCH / DELETE.
 * Writes are managers-only. GET is any authenticated user (used by pickers/form).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireRole } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { normalizeVehicleMode, parseAdTypeFields } from '@/lib/ad-generator/ad-types';
import type { FieldSpec } from '@/lib/ad-generator/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Row = {
  id: string; name: string; description: string | null; industry: string;
  category: string | null; vehicleMode: string; fields: string; sortOrder: number; isActive: boolean;
};

function serialize(r: Row) {
  return {
    id: r.id, name: r.name, description: r.description, industry: r.industry, category: r.category,
    vehicleMode: normalizeVehicleMode(r.vehicleMode), fields: parseAdTypeFields(r.fields),
    sortOrder: r.sortOrder, isActive: r.isActive,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    const row = (await prisma.adType.findUnique({ where: { id } })) as Row | null;
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ adType: serialize(row) });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;
  const { id } = await params;

  let body: {
    name?: string; description?: string; industry?: string; category?: string; vehicleMode?: string;
    fields?: FieldSpec[]; sortOrder?: number; isActive?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.name === 'string') data.name = body.name.trim();
  if ('description' in body) data.description = body.description?.trim() || null;
  if (typeof body.industry === 'string' && body.industry.trim()) data.industry = body.industry.trim();
  if ('category' in body) data.category = body.category?.trim() || null;
  if (typeof body.vehicleMode === 'string') data.vehicleMode = normalizeVehicleMode(body.vehicleMode);
  if (Array.isArray(body.fields)) data.fields = JSON.stringify(body.fields);
  if (Number.isFinite(body.sortOrder)) data.sortOrder = Number(body.sortOrder);
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive;

  try {
    const row = (await prisma.adType.update({ where: { id }, data })) as Row;
    return NextResponse.json({ adType: serialize(row) });
  } catch (err) {
    console.error('[api/ad-generator/ad-types/[id]] update failed:', err);
    return NextResponse.json({ error: 'Could not update ad type' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;
  const { id } = await params;
  try {
    await prisma.adType.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('[api/ad-generator/ad-types/[id]] delete failed:', err);
    return NextResponse.json({ error: 'Could not delete ad type' }, { status: 500 });
  }
}
