/**
 * Choose one design out of a fan-out group —
 * POST /api/ad-generator/creatives/[id]/select
 *
 * The offer fan-out builds a design per published template for the same offer
 * and renders ONE square preview of each. This is the other half: the dealer
 * picks, its siblings are put away, and only now does the winner render the rest
 * of its sizes. Deferring that render is what makes generating every design
 * affordable in the first place.
 *
 * Three things happen, in this order, and the order matters:
 *
 *   1. Mark the pick. Cheap, and the fact worth keeping even if the rest fails.
 *   2. Archive the siblings — soft delete, so it is reversible.
 *   3. Render the remaining sizes.
 *
 * (3) is the only step that can fail for an interesting reason, and it must fail
 * LOUDLY. Generation only proved the design rasterizes as a square; a template
 * that renders clean at 1080×1080 can still break at 160×600, and this is where
 * that surfaces. So a render failure is reported to the caller and written to the
 * ad's review notes rather than swallowed — the pick still stands, because the
 * dealer's choice is not invalidated by a bad leaderboard crop, but nobody is
 * allowed to believe the full set exists when it doesn't.
 *
 * `{ undo: true }` reverses a pick: clears `selectedAt` and restores the
 * siblings. The rendered sizes are left alone — they are just files, and
 * re-picking would only rebuild them.
 *
 * Session-gated, not admin: choosing between designs your own automation
 * produced is ordinary client work, and every candidate already passed preflight
 * at generation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, getAccountScope, canAccessAccount, forbidden } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { isS3Configured } from '@/lib/s3';
import type { TemplateDoc } from '@/lib/ad-generator/doc-types';
import type { AdData } from '@/lib/ad-generator/types';
import { renderCreativeToS3 } from '@/lib/ad-generator/render-creative';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Rendering a full size set is the slowest thing this app does synchronously.
export const maxDuration = 300;

const RENDER_FAILED_NOTE = 'Some sizes could not be rendered for this design — see the detail below.';

function safeJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseNotes(raw: string | null): string[] {
  const v = safeJson<unknown>(raw);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Which sizes this account wants, intersected with what the design defines. */
function sizesToRender(doc: TemplateDoc, configured: string[]): string[] {
  const defined = doc.sizes.map((s) => s.id);
  if (!configured.length) return defined;
  const wanted = defined.filter((id) => configured.includes(id));
  // A configured set naming nothing this design has is a misconfiguration, not a
  // reason to render nothing — fall back to every size, same as generation does.
  return wanted.length ? wanted : defined;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ad = await prisma.adCreative
    .findUnique({
      where: { id },
      select: {
        id: true,
        accountKey: true,
        offerGroupKey: true,
        doc: true,
        data: true,
        reviewNotes: true,
        selectedAt: true,
      },
    })
    .catch(() => null);
  if (!ad) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canAccessAccount(getAccountScope(session), ad.accountKey)) return forbidden();

  let body: { undo?: boolean } = {};
  try {
    body = (await req.json()) as { undo?: boolean };
  } catch {
    body = {};
  }

  // Siblings are every OTHER design for the same offer in the same account.
  // Scoped by accountKey as well as the group key: the key embeds the vehicle
  // and offer, not the account, so two dealers advertising the identical
  // national program would otherwise archive each other's ads.
  const siblingWhere = ad.offerGroupKey
    ? { accountKey: ad.accountKey, offerGroupKey: ad.offerGroupKey, id: { not: ad.id } }
    : null;

  // ── undo ──
  if (body.undo) {
    await prisma.adCreative.update({ where: { id: ad.id }, data: { selectedAt: null } });
    let restored = 0;
    if (siblingWhere) {
      const r = await prisma.adCreative.updateMany({
        where: { ...siblingWhere, archivedAt: { not: null } },
        data: { archivedAt: null },
      });
      restored = r.count;
    }
    return NextResponse.json({ ok: true, selected: false, restored });
  }

  // ── 1. the pick ──
  await prisma.adCreative.update({ where: { id: ad.id }, data: { selectedAt: new Date() } });

  // ── 2. put the siblings away ──
  let archived = 0;
  if (siblingWhere) {
    const r = await prisma.adCreative.updateMany({
      where: { ...siblingWhere, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    archived = r.count;
  }

  // ── 3. the rest of the sizes ──
  const doc = safeJson<TemplateDoc>(ad.doc);
  const data = safeJson<AdData>(ad.data) ?? {};

  if (!doc || !Array.isArray(doc.sizes) || doc.sizes.length === 0) {
    // Nothing to render against. Not a render failure — the ad has no design of
    // its own, which is a legitimate state for older rows that reference a code
    // template. Say so plainly rather than reporting a fake success.
    return NextResponse.json({
      ok: true,
      selected: true,
      archived,
      rendered: 0,
      renderSkipped: 'This ad has no stored design, so its other sizes are produced on export instead.',
    });
  }

  if (!isS3Configured()) {
    return NextResponse.json({
      ok: true,
      selected: true,
      archived,
      rendered: 0,
      renderSkipped: 'No image storage is configured, so the other sizes were not saved. The ad still exports.',
    });
  }

  let configured: string[] = [];
  try {
    const cfg = await prisma.adAutomationConfig.findUnique({
      where: { accountKey: ad.accountKey },
      select: { sizeIds: true },
    });
    const parsed = safeJson<unknown>(cfg?.sizeIds ?? null);
    if (Array.isArray(parsed)) configured = parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    configured = [];
  }

  const sizeIds = sizesToRender(doc, configured);
  try {
    const persisted = await renderCreativeToS3({
      creativeId: ad.id,
      doc,
      data,
      accountKey: ad.accountKey,
      sizeIds,
    });
    // Clear a stale failure note from an earlier attempt — a successful re-pick
    // must not leave the ad still claiming its sizes are broken.
    const notes = parseNotes(ad.reviewNotes).filter((n) => !n.startsWith(RENDER_FAILED_NOTE));
    await prisma.adCreative.update({
      where: { id: ad.id },
      data: {
        thumbnailUrl: persisted[0]?.url ?? undefined,
        reviewNotes: notes.length ? JSON.stringify(notes) : null,
      },
    });
    return NextResponse.json({ ok: true, selected: true, archived, rendered: persisted.length });
  } catch (err) {
    // LOUD. The pick stands — a bad crop at one size doesn't invalidate the
    // dealer's choice of design — but the failure is both returned and recorded,
    // because the whole point of deferring these renders was that generation
    // could no longer prove they work.
    const detail = err instanceof Error ? err.message : 'Unknown render error';
    console.error(`[api/ad-generator/creatives/${ad.id}/select] render failed:`, err);
    const notes = parseNotes(ad.reviewNotes).filter((n) => !n.startsWith(RENDER_FAILED_NOTE));
    notes.unshift(`${RENDER_FAILED_NOTE} ${detail}`);
    await prisma.adCreative
      .update({ where: { id: ad.id }, data: { reviewNotes: JSON.stringify(notes) } })
      .catch(() => null);
    return NextResponse.json({
      ok: true,
      selected: true,
      archived,
      rendered: 0,
      renderError: detail,
    });
  }
}
