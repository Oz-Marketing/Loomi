/**
 * The proof sheet for a template — POST /api/ad-generator/templates-doc/[id]/proof
 *
 * Every offer type this template claims to serve × every board it defines, drawn
 * by the real renderer and checked by the real compliance gate. The pre-publish
 * question, answered in one request instead of twenty clicks through the builder's
 * preview tabs.
 *
 * POST rather than GET for the same reason as sync-impact: the caller can hand us
 * the doc it is about to save (and the account's branding), and neither fits in a
 * query string. With no `doc` in the body the SAVED design is used, which is what
 * a proof sheet opened in its own tab wants.
 *
 * Read-only. Nothing is written — including the co-op design verdict, which is
 * resolved with `persist: false` exactly as the preflight endpoint does.
 */
import { NextRequest, NextResponse } from 'next/server';
import { canAccessAccount, forbidden, getAccountScope, getAuthSession } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { parseOemRule, type OemOfferRule } from '@/lib/ad-generator/compliance';
import { loadActiveCoopPack } from '@/lib/ad-generator/coop-pack-store';
import { resolveTemplateCoopCheck } from '@/lib/ad-generator/coop-template-check-store';
import { vehicleFromData } from '@/lib/ad-generator/vehicle-fields';
import { buildProofSheet, type ProofSheet } from '@/lib/ad-generator/proof-sheet';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import type { AdData } from '@/lib/ad-generator/types';
import type { CoopDesignVerdict } from '@/lib/ad-generator/preflight';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function ruleForMake(make: string): Promise<OemOfferRule | null> {
  if (!make.trim()) return null;
  try {
    const row = await prisma.adOemOfferRule.findFirst({
      where: { make: { equals: make, mode: 'insensitive' }, isActive: true },
      select: { make: true, requiredFields: true, defaultValues: true },
    });
    return row ? parseOemRule(row.make, row.requiredFields, row.defaultValues) : null;
  } catch {
    return null;
  }
}

function parseDoc(raw: string): TemplateDoc | null {
  try {
    const v = JSON.parse(raw) as TemplateDoc;
    return Array.isArray(v?.sizes) && Array.isArray(v?.elements) && v?.layouts ? v : null;
  } catch {
    return null;
  }
}

export interface ProofSheetResponse extends ProofSheet {
  templateName: string;
  make: string;
  /** False when no co-op pack exists for the make — the sheet says so in `notes`. */
  hasPack: boolean;
  packVerified: boolean;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  let body: {
    accountKey?: string;
    data?: AdData;
    doc?: TemplateDoc;
    sizeIds?: string[];
    offerTypes?: string[];
  };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const accountKey = (body.accountKey ?? '').trim();
  if (accountKey && !canAccessAccount(getAccountScope(session), accountKey)) return forbidden();

  try {
    const row = await prisma.adTemplateDoc
      .findUnique({ where: { id }, select: { name: true, doc: true } })
      .catch(() => null);

    // The caller's in-flight design wins when it sent one; otherwise the saved row.
    const doc = body.doc ?? (row?.doc ? parseDoc(row.doc) : null);
    if (!doc) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

    const data = body.data ?? {};
    const make = (vehicleFromData(data).make || doc.make || '').trim();
    const [oemRule, packEntry] = await Promise.all([
      ruleForMake(make),
      make ? loadActiveCoopPack(make) : null,
    ]);

    // Replayed, never recomputed — so the sheet and the pipeline can never
    // disagree about the same template.
    let coopDesign: CoopDesignVerdict | undefined;
    if (packEntry) {
      const resolved = await resolveTemplateCoopCheck({
        templateId: id,
        doc,
        packId: packEntry.id,
        pack: packEntry.pack,
        persist: false,
      }).catch(() => null);
      if (resolved) coopDesign = resolved;
    }

    const sheet = buildProofSheet({
      doc,
      data,
      oemRule,
      coopPack: packEntry?.pack ?? null,
      coopDesign,
      sizeIds: body.sizeIds?.length ? body.sizeIds : undefined,
      offerTypes: body.offerTypes?.length ? body.offerTypes : undefined,
    });

    const payload: ProofSheetResponse = {
      ...sheet,
      templateName: doc.name || row?.name || 'Untitled template',
      make,
      hasPack: !!packEntry?.pack,
      packVerified: packEntry?.pack?.verified ?? false,
    };
    return NextResponse.json(payload);
  } catch (err) {
    console.error('[api/adgen/proof] failed:', err);
    return NextResponse.json({ error: 'Could not build the proof sheet' }, { status: 500 });
  }
}
