/**
 * OEM guidelines + sales events — /api/ad-generator/oem-assets
 *
 * GET  → per-make guideline packs and event calendar, with staleness state.
 * POST → save_event | delete_event | set_verified | attach_source
 *
 * Owned by the co-op team: they hold the manufacturer relationships that produce
 * both the guideline documents and the event marks.
 *
 * Admin-only. Global (per make), not per sub-account — a manufacturer's rules
 * don't vary by rooftop.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireRole } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { buildOemAssetsReport } from '@/lib/ad-generator/oem-assets-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function gate() {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;
  return null;
}

export async function GET() {
  const denied = await gate();
  if (denied) return denied;
  try {
    return NextResponse.json({ makes: await buildOemAssetsReport() });
  } catch (err) {
    console.error('[api/adgen/oem-assets] GET failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not load OEM assets' },
      { status: 500 },
    );
  }
}

/** yyyy-MM-dd → Date at UTC midnight / end-of-day. Rejects nonsense. */
function parseDay(value: unknown, endOfDay = false): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(req: NextRequest) {
  const denied = await gate();
  if (denied) return denied;
  const session = await getAuthSession();

  let body: {
    action?: string;
    // save_event
    id?: string;
    make?: string;
    name?: string;
    logoUrl?: string;
    effectiveFrom?: string;
    effectiveTo?: string;
    required?: boolean;
    offerTypes?: string[];
    isActive?: boolean;
    // set_verified / attach_source
    packId?: string;
    verified?: boolean;
    sourceAssetId?: string;
    sourceUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    switch (body.action) {
      case 'save_event': {
        const make = (body.make ?? '').trim();
        const name = (body.name ?? '').trim();
        const logoUrl = (body.logoUrl ?? '').trim();
        const from = parseDay(body.effectiveFrom);
        const to = parseDay(body.effectiveTo, true);
        if (!make || !name) return NextResponse.json({ error: 'make and name are required' }, { status: 400 });
        if (!/^https?:\/\//i.test(logoUrl)) {
          return NextResponse.json({ error: 'A http(s) logo URL is required' }, { status: 400 });
        }
        if (!from || !to) {
          return NextResponse.json({ error: 'effectiveFrom and effectiveTo must be yyyy-MM-dd' }, { status: 400 });
        }
        // A backwards window would silently never match, looking like a
        // resolution bug rather than a typo.
        if (to.getTime() < from.getTime()) {
          return NextResponse.json({ error: 'effectiveTo must not be before effectiveFrom' }, { status: 400 });
        }
        const data = {
          make,
          name,
          logoUrl,
          effectiveFrom: from,
          effectiveTo: to,
          required: body.required !== false,
          offerTypes: JSON.stringify(
            (body.offerTypes ?? []).filter((t) => ['lease', 'apr', 'discount', 'sales_price'].includes(t)),
          ),
          isActive: body.isActive !== false,
        };
        const row = body.id
          ? await prisma.adOemEventAsset.update({ where: { id: body.id }, data })
          : await prisma.adOemEventAsset.create({
              data: { ...data, createdBy: (session?.user as { id?: string })?.id ?? null },
            });
        return NextResponse.json({ ok: true, event: { id: row.id, name: row.name } });
      }

      case 'delete_event': {
        const id = (body.id ?? '').trim();
        if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
        const res = await prisma.adOemEventAsset.deleteMany({ where: { id } });
        return NextResponse.json({ ok: true, removed: res.count });
      }

      case 'set_verified': {
        const packId = (body.packId ?? '').trim();
        if (!packId) return NextResponse.json({ error: 'packId is required' }, { status: 400 });
        const verified = body.verified === true;
        const u = session?.user as { id?: string; name?: string | null; email?: string | null } | undefined;
        const row = await prisma.adCoopRulePack.update({
          where: { id: packId },
          data: {
            verified,
            // Record WHO signed off and when — an unattributed verification is
            // not much better than none, since the whole value is that a named
            // person checked the transcription against the document.
            verifiedBy: verified ? (u?.name || u?.email || u?.id || 'unknown') : null,
            verifiedAt: verified ? new Date() : null,
          },
        });
        return NextResponse.json({ ok: true, pack: { id: row.id, verified: row.verified } });
      }

      case 'attach_source': {
        const packId = (body.packId ?? '').trim();
        const sourceUrl = (body.sourceUrl ?? '').trim();
        if (!packId) return NextResponse.json({ error: 'packId is required' }, { status: 400 });
        if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
          return NextResponse.json({ error: 'sourceUrl must be http(s)' }, { status: 400 });
        }
        const row = await prisma.adCoopRulePack.update({
          where: { id: packId },
          data: {
            sourceAssetId: body.sourceAssetId?.trim() || null,
            sourceUrl: sourceUrl || null,
          },
        });
        return NextResponse.json({ ok: true, pack: { id: row.id, sourceUrl: row.sourceUrl } });
      }

      default:
        return NextResponse.json({ error: `Unknown action "${body.action}"` }, { status: 400 });
    }
  } catch (err) {
    console.error(`[api/adgen/oem-assets] ${body.action} failed:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Action failed' },
      { status: 500 },
    );
  }
}
