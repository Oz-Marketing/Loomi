/**
 * Ad Generator category starters — /api/ad-generator/category-starters
 *
 * A template Category can carry a STARTER field set. Picking the category in the
 * builder seeds those fields (merge-missing). Designer-managed, not hardcoded:
 * "Save current fields as this category's starter" upserts here. "Vehicle Offer"
 * ships seeded with the offer question set (scripts/seed-vehicle-offer-category).
 *
 * - GET    → all starters: { name, fields, defaults }[]
 * - POST   → upsert one (managers): { name, fields, defaults }
 * - DELETE → remove one (managers): ?name=<name>
 *
 * Resilient: if the table isn't migrated, GET returns [].
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireRole } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import type { FieldSpec } from '@/lib/ad-generator/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Row = { name: string; fields: string; defaults: string };

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const v = JSON.parse(raw);
    return v == null ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

function shape(r: Row) {
  return {
    name: r.name,
    fields: parseJson<FieldSpec[]>(r.fields, []),
    defaults: parseJson<Record<string, string>>(r.defaults, {}),
  };
}

export async function GET() {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const rows = (await prisma.adCategoryStarter.findMany({ orderBy: { name: 'asc' } })) as Row[];
    return NextResponse.json({ starters: rows.map(shape) });
  } catch (err) {
    console.warn('[api/ad-generator/category-starters] falling back to []:', err);
    return NextResponse.json({ starters: [] });
  }
}

export async function POST(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;
  const session = await getAuthSession();

  let body: { name?: string; fields?: unknown; defaults?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!Array.isArray(body.fields)) return NextResponse.json({ error: 'fields must be an array' }, { status: 400 });

  const u = session?.user as { name?: string | null; email?: string | null } | undefined;
  const data = {
    fields: JSON.stringify(body.fields),
    defaults: JSON.stringify(body.defaults && typeof body.defaults === 'object' ? body.defaults : {}),
  };
  try {
    const row = await prisma.adCategoryStarter.upsert({
      where: { name },
      create: { name, ...data, createdBy: u?.email ?? null, createdByName: u?.name ?? null },
      update: data,
    });
    return NextResponse.json({ starter: { name: row.name, fieldCount: body.fields.length } });
  } catch (err) {
    console.error('[api/ad-generator/category-starters] upsert failed:', err);
    return NextResponse.json(
      { error: 'Could not save — has the table been migrated in this environment?' },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const name = req.nextUrl.searchParams.get('name')?.trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  try {
    await prisma.adCategoryStarter.delete({ where: { name } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Already gone → treat as success so the client list stays in sync.
    if ((err as { code?: string })?.code === 'P2025') return NextResponse.json({ ok: true });
    console.error('[api/ad-generator/category-starters] delete failed:', err);
    return NextResponse.json({ error: 'Could not delete preset' }, { status: 500 });
  }
}
