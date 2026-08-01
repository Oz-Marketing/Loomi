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
import { loadActiveCoopPack } from '@/lib/ad-generator/coop-pack-store';
import { summarizeTemplateCoop } from '@/lib/ad-generator/coop-template-check';
import { invalidatePackChecks, resolveTemplateCoopCheck } from '@/lib/ad-generator/coop-template-check-store';
import { getGuidelineDoc, refreshGuidelineDocs, registerGuidelineDoc } from '@/lib/ad-generator/guideline-docs';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';

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

export async function GET(req: NextRequest) {
  const denied = await gate();
  if (denied) return denied;
  try {
    // `?docId=` fetches one document WITH its cover thumbnail. The list response
    // omits previews deliberately — 33 base64 covers is about a megabyte of payload
    // for a view that mostly renders counts.
    const docId = req.nextUrl.searchParams.get('docId');
    if (docId) {
      const doc = await getGuidelineDoc(docId);
      if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      return NextResponse.json({ doc });
    }
    return NextResponse.json({ makes: await buildOemAssetsReport() });
  } catch (err) {
    console.error('[api/adgen/oem-assets] GET failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not load OEM assets' },
      { status: 500 },
    );
  }
}

/** The stored TemplateDoc for an id, or null if missing/unparseable. */
async function loadTemplateDoc(id: string): Promise<TemplateDoc | null> {
  try {
    const row = await prisma.adTemplateDoc.findUnique({ where: { id }, select: { doc: true } });
    if (!row) return null;
    const doc = JSON.parse(row.doc) as TemplateDoc;
    return doc && Array.isArray(doc.sizes) && Array.isArray(doc.elements) ? doc : null;
  } catch {
    return null;
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
    // register_doc / mark_doc_reviewed / delete_doc
    docId?: string;
    title?: string;
    notes?: string;
    // recheck_template
    templateId?: string;
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
        // Cached template verdicts were computed under the OLD flag, and `verified`
        // decides whether a finding blocks or merely warns. The pack version hasn't
        // moved, so nothing else would mark them stale — drop them and let the next
        // run recompute.
        const dropped = await invalidatePackChecks(row.id);
        return NextResponse.json({ ok: true, pack: { id: row.id, verified: row.verified }, rechecksQueued: dropped });
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

      // ── guideline document register ──
      case 'register_doc': {
        const make = (body.make ?? '').trim();
        const title = (body.title ?? '').trim();
        const sourceUrl = (body.sourceUrl ?? '').trim();
        if (!make || !title) return NextResponse.json({ error: 'make and title are required' }, { status: 400 });
        if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
          return NextResponse.json({ error: 'sourceUrl must be http(s)' }, { status: 400 });
        }
        if (!sourceUrl && !body.sourceAssetId?.trim()) {
          return NextResponse.json(
            { error: 'Give either a fetchable URL or an uploaded document — a register entry with neither can never be compared.' },
            { status: 400 },
          );
        }
        const u = session?.user as { id?: string } | undefined;
        const row = await registerGuidelineDoc({
          make,
          title,
          sourceUrl: sourceUrl || null,
          sourceAssetId: body.sourceAssetId ?? null,
          createdBy: u?.id ?? null,
        });
        if (!row) return NextResponse.json({ error: 'Could not register the document' }, { status: 500 });
        return NextResponse.json({ ok: true, doc: row });
      }

      case 'rename_doc': {
        const docId = (body.docId ?? '').trim();
        const title = (body.title ?? '').trim();
        if (!docId || !title) return NextResponse.json({ error: 'docId and title are required' }, { status: 400 });

        const current = await prisma.adGuidelineDoc.findUnique({
          where: { id: docId },
          select: { make: true, title: true },
        });
        if (!current) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
        if (current.title === title) return NextResponse.json({ ok: true, unchanged: true });

        // (make, title) is the unique key, and it's also what a re-upload matches on
        // to replace a document. Colliding with a sibling would either fail at the
        // constraint or, worse, make two documents indistinguishable to the uploader.
        const clash = await prisma.adGuidelineDoc.findUnique({
          where: { make_title: { make: current.make, title } },
          select: { id: true },
        });
        if (clash && clash.id !== docId) {
          return NextResponse.json(
            { error: `${current.make} already has a document called "${title}".` },
            { status: 409 },
          );
        }

        const row = await prisma.adGuidelineDoc.update({ where: { id: docId }, data: { title } });
        return NextResponse.json({ ok: true, doc: { id: row.id, title: row.title } });
      }

      case 'save_doc_notes': {
        const docId = (body.docId ?? '').trim();
        if (!docId) return NextResponse.json({ error: 'docId is required' }, { status: 400 });
        const row = await prisma.adGuidelineDoc.update({
          where: { id: docId },
          data: { notes: body.notes?.trim() || null },
        });
        return NextResponse.json({ ok: true, doc: { id: row.id } });
      }

      case 'delete_doc': {
        const docId = (body.docId ?? '').trim();
        if (!docId) return NextResponse.json({ error: 'docId is required' }, { status: 400 });
        const res = await prisma.adGuidelineDoc.deleteMany({ where: { id: docId } });
        return NextResponse.json({ ok: true, removed: res.count });
      }

      case 'refresh_docs': {
        // Force: the button exists to answer "has this changed right now", so the
        // 24h skip that keeps the daily job cheap would defeat the point.
        const r = await refreshGuidelineDocs(new Date(), { force: true });
        return NextResponse.json({ ok: true, ...r });
      }

      // ── design-time template check ──
      case 'recheck_template': {
        const templateId = (body.templateId ?? '').trim();
        const make = (body.make ?? '').trim();
        if (!templateId || !make) {
          return NextResponse.json({ error: 'templateId and make are required' }, { status: 400 });
        }
        const entry = await loadActiveCoopPack(make);
        if (!entry) return NextResponse.json({ error: `No active co-op pack for ${make}` }, { status: 404 });
        const doc = await loadTemplateDoc(templateId);
        if (!doc) return NextResponse.json({ error: `Template ${templateId} not found` }, { status: 404 });
        const u = session?.user as { id?: string; name?: string | null; email?: string | null } | undefined;
        const v = await resolveTemplateCoopCheck({
          templateId,
          doc,
          packId: entry.id,
          pack: entry.pack,
          force: true,
          checkedBy: u?.name || u?.email || u?.id || 'unknown',
        });
        return NextResponse.json({ ok: true, verdict: v, summary: summarizeTemplateCoop(v) });
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
