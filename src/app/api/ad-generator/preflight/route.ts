/**
 * Manufacturer compliance for an ad a PERSON is building —
 * POST /api/ad-generator/preflight { accountKey, templateId, data, sizeIds? }
 *
 * WHY THIS EXISTS. `preflight()` has always run on the automation path — generate,
 * dry-run, launch — and nowhere else. So an unattended ad was checked against the
 * manufacturer's co-op rules and a hand-built one was not: the same banned phrase
 * that stopped the pipeline sailed through the form, and the person who typed it
 * was told nothing. The checks, the packs and the citations already existed; only
 * the human surface was missing.
 *
 * Read-only. Nothing is written, so it can be called on every edit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { canAccessAccount, forbidden, getAccountScope, getAuthSession } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { preflight, type CoopDesignVerdict } from '@/lib/ad-generator/preflight';
import { parseOemRule, type OemOfferRule } from '@/lib/ad-generator/compliance';
import { loadActiveCoopPack } from '@/lib/ad-generator/coop-pack-store';
import { resolveTemplateCoopCheck } from '@/lib/ad-generator/coop-template-check-store';
import { vehicleFromData } from '@/lib/ad-generator/vehicle-fields';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import type { AdData } from '@/lib/ad-generator/types';

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

export async function POST(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { accountKey?: string; templateId?: string; data?: AdData; doc?: TemplateDoc; sizeIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body' }, { status: 400 });
  }

  const accountKey = (body.accountKey ?? '').trim();
  if (accountKey && !canAccessAccount(getAccountScope(session), accountKey)) return forbidden();

  const templateId = (body.templateId ?? '').trim();
  const data = body.data ?? {};

  try {
    // The ad's own frozen design when the caller has one — that is what will
    // render, so it is what has to be checked. Falls back to the live template.
    let doc = body.doc ?? null;
    if (!doc && templateId) {
      const row = await prisma.adTemplateDoc
        .findUnique({ where: { id: templateId }, select: { doc: true } })
        .catch(() => null);
      if (row?.doc) {
        try {
          const parsed = JSON.parse(row.doc) as TemplateDoc;
          if (Array.isArray(parsed?.sizes)) doc = parsed;
        } catch {
          /* leave null */
        }
      }
    }
    // No design ⇒ nothing to check. An empty pass is honest here: a code-defined
    // template has no doc to inspect, and claiming a clean bill would be worse.
    if (!doc) return NextResponse.json({ ok: true, issues: [], checked: false });

    const make = (vehicleFromData(data).make || doc.make || '').trim();
    const [oemRule, packEntry] = await Promise.all([
      ruleForMake(make),
      make ? loadActiveCoopPack(make) : null,
    ]);
    const coopPack = packEntry?.pack ?? null;

    // The design-time verdict is REPLAYED, not recomputed — same as generation,
    // so the form and the pipeline can never disagree about the same template.
    let coopDesign: CoopDesignVerdict | undefined;
    if (templateId && packEntry) {
      // `persist: false` — this endpoint runs on every edit and promises to
      // write nothing. The verdict is identical either way; only whether it's
      // cached differs, so honouring that costs nothing.
      const resolved = await resolveTemplateCoopCheck({
        templateId,
        doc,
        packId: packEntry.id,
        pack: packEntry.pack,
        persist: false,
      }).catch(() => null);
      if (resolved) coopDesign = resolved;
    }

    const result = preflight({
      doc,
      data,
      oemRule,
      coopPack,
      coopDesign,
      sizeIds: body.sizeIds?.length ? body.sizeIds : undefined,
    });

    return NextResponse.json({
      ok: result.ok,
      issues: result.issues,
      checked: true,
      make,
      // So the UI can say "no rules on file for Ford" rather than implying a pass.
      hasPack: !!coopPack,
      packVerified: coopPack?.verified ?? false,
    });
  } catch (err) {
    console.error('[api/adgen/preflight] failed:', err);
    return NextResponse.json({ error: 'Could not run the compliance check' }, { status: 500 });
  }
}
