/**
 * Ad Generator OEM compliance rule — GET /api/ad-generator/oem-rules?make=
 *
 * Returns the active `AdOemOfferRule` for a make (case-insensitive), parsed
 * into { make, requiredFields }, or `{ rule: null }` when none exists. The
 * generator unions the rule with the code-defined baseline to decide which
 * fields must be filled before export. Resilient: returns null (→ baseline
 * only) if the table isn't migrated in this environment.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireRole } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { parseOemRule } from '@/lib/ad-generator/compliance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await adGeneratorAllowed())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Admin: full list for the rules manager (`?all=1`).
  if (req.nextUrl.searchParams.get('all') === '1') {
    const { error } = await requireRole('developer', 'super_admin', 'admin');
    if (error) return error;
    try {
      const rows = await prisma.adOemOfferRule.findMany({ orderBy: { make: 'asc' } });
      return NextResponse.json({
        rules: rows.map((r) => ({
          id: r.id,
          make: r.make,
          requiredFields: parseOemRule(r.make, r.requiredFields)?.requiredFields ?? {},
          notes: r.notes,
          isActive: r.isActive,
        })),
      });
    } catch (err) {
      console.warn('[api/ad-generator/oem-rules] all → []:', err);
      return NextResponse.json({ rules: [] });
    }
  }

  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const make = (req.nextUrl.searchParams.get('make') || '').trim();
  if (!make) return NextResponse.json({ rule: null });

  try {
    const row = await prisma.adOemOfferRule.findFirst({
      where: { isActive: true, make: { equals: make, mode: 'insensitive' } },
    });
    return NextResponse.json({ rule: row ? parseOemRule(row.make, row.requiredFields) : null });
  } catch (err) {
    console.warn('[api/ad-generator/oem-rules] falling back to null:', err);
    return NextResponse.json({ rule: null });
  }
}

export async function POST(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  let body: { make?: string; requiredFields?: Record<string, string[]>; notes?: string; isActive?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.make?.trim()) return NextResponse.json({ error: 'make is required' }, { status: 400 });
  try {
    const row = await prisma.adOemOfferRule.create({
      data: {
        make: body.make.trim(),
        requiredFields: JSON.stringify(body.requiredFields ?? {}),
        notes: body.notes?.trim() || null,
        isActive: body.isActive !== false,
      },
    });
    return NextResponse.json({ rule: row });
  } catch (err) {
    console.error('[api/ad-generator/oem-rules] create failed:', err);
    // make is @unique — surface the likely cause without leaking internals.
    return NextResponse.json(
      { error: 'Could not create — a rule for this make may already exist (or the table is not migrated).' },
      { status: 500 },
    );
  }
}
