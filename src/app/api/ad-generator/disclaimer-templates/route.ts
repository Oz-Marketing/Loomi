/**
 * Ad Generator disclaimer templates — GET /api/ad-generator/disclaimer-templates
 *
 * Lists the `AdDisclaimerTemplate` rows applicable to an offer type (and,
 * optionally, a vehicle make): make-specific templates first, then global
 * fallbacks (make = null), each with `isDefault` ranked ahead. The generator
 * substitutes a chosen template's `{slug}` tokens from the structured offer.
 *
 * Resilient by design: if the table doesn't exist yet (e.g. a local dev DB
 * that hasn't had the additive `db push`), it returns an empty list so the
 * generator simply falls back to the code-defined default templates.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import { AD_GENERATOR_ENABLED } from '@/lib/feature-flags';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!AD_GENERATOR_ENABLED) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const offerType = req.nextUrl.searchParams.get('offerType') || '';
  const make = (req.nextUrl.searchParams.get('make') || '').trim();
  if (!offerType) return NextResponse.json({ templates: [] });

  try {
    const rows = await prisma.adDisclaimerTemplate.findMany({
      where: {
        offerType,
        isActive: true,
        OR: [
          { make: null },
          ...(make ? [{ make: { equals: make, mode: 'insensitive' as const } }] : []),
        ],
      },
    });
    // Make-specific before global; default before the rest; then by name.
    rows.sort((a, b) => {
      const am = a.make ? 0 : 1;
      const bm = b.make ? 0 : 1;
      if (am !== bm) return am - bm;
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return NextResponse.json({
      templates: rows.map((t) => ({
        id: t.id,
        name: t.name,
        make: t.make,
        body: t.body,
        isDefault: t.isDefault,
      })),
    });
  } catch (err) {
    // Table not migrated in this environment (or transient DB issue) — degrade
    // to the code-defined defaults rather than failing the generator.
    console.warn('[api/ad-generator/disclaimer-templates] falling back to []:', err);
    return NextResponse.json({ templates: [] });
  }
}
