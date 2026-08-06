/**
 * Launch Kit — GET /api/ad-generator/launch-kit/[id]
 *
 * One zip per ad: the rendered creative at every size, the copy pre-fitted to each
 * platform's character limits, and a targeting sheet carrying the campaign shape
 * plus anything Meta forces for the ad's special ad category.
 *
 * Zero platform writes, which is the point — it removes most of the manual
 * assembly time today, works in an environment with no Graph token, and stays
 * useful as the fallback once one-click launching exists.
 */
import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { getAuthSession, getAccountScope, canAccessAccount, forbidden } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import type { AdCopyVariation } from '@/lib/ad-generator/copy-types';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import type { AdData } from '@/lib/ad-generator/types';
import { approvalStatusFor } from '@/lib/ad-generator/coop-approval-store';
import { loadActiveCoopPack } from '@/lib/ad-generator/coop-pack-store';
import { deterministicCopy } from '@/lib/ad-generator/automation/generate-copy';
import { assembleOffer } from '@/lib/ad-generator/offer-text';
import { vehicleFromData } from '@/lib/ad-generator/vehicle-fields';
import { googleCopySheet, metaCopySheet, readmeSheet, targetingSheet } from '@/lib/ad-generator/launch-kit';
import { resolveLaunch, type PresetRow } from '@/lib/ad-generator/launch-preset';
import { renderCreativeSizes } from '@/lib/ad-generator/render-creative';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function safeJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Safe filename chunk, matching the render-zip route's convention. */
function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'ad'
  );
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ad = await prisma.adCreative
    .findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        accountKey: true,
        templateId: true,
        doc: true,
        data: true,
        copy: true,
        copySource: true,
        expiresAt: true,
      },
    })
    .catch(() => null);
  if (!ad) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canAccessAccount(getAccountScope(session), ad.accountKey)) return forbidden();

  const doc = safeJson<TemplateDoc>(ad.doc);
  if (!doc || !Array.isArray(doc.sizes) || !doc.layouts) {
    return NextResponse.json({ error: 'This ad has no renderable design' }, { status: 400 });
  }
  const data = safeJson<AdData>(ad.data) ?? ({} as AdData);
  const vehicle = vehicleFromData(data);

  const account = await prisma.account
    .findUnique({ where: { key: ad.accountKey }, select: { dealer: true, website: true } })
    .catch(() => null);

  // Ads generated before copy existed have none stored. Emitting dashes for the
  // headline and primary text would defeat the point of the kit — it exists to be
  // paste-ready — so fall back to the deterministic caption built from the offer,
  // exactly as generation now does. Not persisted: the kit is a read, and writing
  // copy here would freeze words nobody reviewed onto the ad.
  const stored = safeJson<AdCopyVariation>(ad.copy);
  const copy =
    stored ??
    deterministicCopy({
      data,
      dealerName: account?.dealer ?? '',
      vehicle: {
        year: Number(vehicle.year) || new Date().getFullYear(),
        make: vehicle.make,
        model: vehicle.model,
      },
    });
  const copySource = stored ? ad.copySource : 'deterministic';

  // Wrapped in a try rather than a promise `.catch`: if the Prisma client predates
  // this model, `prisma.adLaunchPreset` is UNDEFINED and the property access
  // throws synchronously, so a trailing .catch() never runs. The kit is fully
  // useful on the defaults, so an unconfigured or unavailable preset must not
  // fail it.
  let preset: PresetRow | null = null;
  try {
    preset = (await prisma.adLaunchPreset.findUnique({
      where: { accountKey_platform: { accountKey: ad.accountKey, platform: 'meta' } },
    })) as PresetRow | null;
  } catch (err) {
    console.warn('[api/ad-generator/launch-kit] preset unavailable, using defaults:', err);
  }

  // The category is decided by everything the ad SAYS, not just its offer type —
  // a cash-back ad whose disclaimer mentions approved credit is still credit
  // advertising. So every published string is offered to the classifier.
  const texts = [
    data.disclaimer,
    data.terms,
    copy?.meta.primaryText,
    copy?.meta.headline,
    copy?.meta.description,
    ...(copy?.google.headlines ?? []),
    ...(copy?.google.descriptions ?? []),
  ];

  const launch = resolveLaunch({
    preset,
    data,
    texts,
    fallbackUrl: account?.website ?? null,
    availableSizeIds: doc.sizes.map((s) => s.id),
  });

  const make = (vehicle.make || doc.make || '').trim();
  const approval = make
    ? await approvalStatusFor({
        templateId: ad.templateId,
        doc,
        make,
        activePackVersion: (await loadActiveCoopPack(make))?.pack.version ?? null,
      })
    : null;

  // Render fresh rather than reusing the stored thumbnail: the kit is the artifact
  // someone uploads, so it has to be the current design at full size, and an
  // environment with no S3 bucket has no stored PNG at all.
  let rendered: { sizeId: string; label: string; width: number; height: number; png: Buffer }[] = [];
  try {
    rendered = await renderCreativeSizes({
      doc,
      data,
      accountKey: ad.accountKey,
      sizeIds: launch.sizeIds.length ? launch.sizeIds : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not render the creative: ${err instanceof Error ? err.message : 'unknown error'}` },
      { status: 500 },
    );
  }

  const base = slug(ad.name);
  const imageFiles = rendered.map((r) => `images/${base}-${r.width}x${r.height}.png`);
  const input = {
    adName: ad.name,
    accountName: account?.dealer ?? ad.accountKey,
    vehicle: vehicle.name || null,
    // The assembled offer line ("$311/mo", plus its terms) rather than a bare
    // number — "Offer: 311" tells a person nothing about what 311 is.
    offerSummary: (() => {
      const o = assembleOffer(data);
      return o ? [o.main, o.terms].filter(Boolean).join(' · ') : data.price || null;
    })(),
    copy,
    copySource,
    launch,
    approval,
    imageFiles,
    expiresAt: ad.expiresAt ? ad.expiresAt.toISOString() : null,
    generatedAt: new Date().toISOString(),
  };

  const zip = new JSZip();
  zip.file('README.txt', readmeSheet(input));
  zip.file('targeting.txt', targetingSheet(input));
  zip.file('meta.txt', metaCopySheet(input));
  zip.file('google.txt', googleCopySheet(input));
  rendered.forEach((r, i) => zip.file(imageFiles[i], r.png));

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${base}-launch-kit.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
