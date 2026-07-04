/**
 * Ad Generator — Ad Types (taxonomy + question set).
 *
 * GET  /api/ad-generator/ad-types
 *   ?all=1        → full list for the admin manager (managers only)
 *   ?industry=X   → active types for an industry (the New-ad type picker / form)
 *   (none)        → all active types
 * POST /api/ad-generator/ad-types → create (managers only)
 *
 * Resilient: if the table isn't migrated yet, GET returns [] so the generator
 * degrades gracefully.
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
    id: r.id,
    name: r.name,
    description: r.description,
    industry: r.industry,
    category: r.category,
    vehicleMode: normalizeVehicleMode(r.vehicleMode),
    fields: parseAdTypeFields(r.fields),
    sortOrder: r.sortOrder,
    isActive: r.isActive,
  };
}

export async function GET(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const all = req.nextUrl.searchParams.get('all') === '1';
  const industry = (req.nextUrl.searchParams.get('industry') || '').trim();

  if (all) {
    const { error } = await requireRole('developer', 'super_admin', 'admin');
    if (error) return error;
  }

  try {
    const rows = (await prisma.adType.findMany({
      where: all
        ? {}
        : {
            isActive: true,
            ...(industry ? { industry: { equals: industry, mode: 'insensitive' as const } } : {}),
          },
      orderBy: [{ industry: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    })) as Row[];
    return NextResponse.json({ adTypes: rows.map(serialize) });
  } catch (err) {
    console.warn('[api/ad-generator/ad-types] falling back to []:', err);
    return NextResponse.json({ adTypes: [] });
  }
}

export async function POST(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;
  const session = await getAuthSession();

  let body: {
    name?: string; description?: string; industry?: string; category?: string; vehicleMode?: string;
    fields?: FieldSpec[]; sortOrder?: number; isActive?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const name = body.name?.trim();
  const industry = body.industry?.trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!industry) return NextResponse.json({ error: 'industry is required' }, { status: 400 });

  const u = session?.user as { id?: string; name?: string | null } | undefined;
  try {
    const row = (await prisma.adType.create({
      data: {
        name,
        description: body.description?.trim() || null,
        industry,
        category: body.category?.trim() || null,
        vehicleMode: normalizeVehicleMode(body.vehicleMode),
        fields: JSON.stringify(Array.isArray(body.fields) ? body.fields : []),
        sortOrder: Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 0,
        isActive: body.isActive !== false,
        createdBy: u?.id ?? null,
        createdByName: u?.name ?? null,
      },
    })) as Row;
    return NextResponse.json({ adType: serialize(row) });
  } catch (err) {
    console.error('[api/ad-generator/ad-types] create failed:', err);
    return NextResponse.json({ error: 'Could not create — has the table been migrated in this environment?' }, { status: 500 });
  }
}
