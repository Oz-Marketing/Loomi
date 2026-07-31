/**
 * Ad Generator automation dry run — POST /api/ad-generator/automation/dry-run
 *
 * Runs the full autonomous chain (offers → selection → template → fields →
 * image → disclaimer → preflight → render) for ONE vehicle and returns a
 * step-by-step trace plus base64 PNG previews.
 *
 * Read-only by construction: the dry run creates no `AdCreative`, uploads no
 * render, and persists no offer state. It exists so the pipeline can be watched
 * and understood before any of it goes on a schedule.
 *
 * Admin-only — it burns MarketCheck + EVOX quota and exposes raw feed data.
 */
import { NextRequest, NextResponse } from 'next/server';
import { canAccessAccount, forbidden, getAccountScope, getAuthSession, requireRole } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { dryRunOneVehicle } from '@/lib/ad-generator/automation/dry-run';
import type { SelectableOfferType } from '@/lib/ad-generator/automation/select-offer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Chromium plus up to four MarketCheck fallback passes; the render itself is
// the long pole.
export const maxDuration = 120;

const OFFER_TYPES: SelectableOfferType[] = ['lease', 'apr', 'cash'];

export async function POST(req: NextRequest) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  let body: {
    accountKey?: string;
    make?: string;
    model?: string;
    year?: number;
    zip?: string;
    templateId?: string;
    sizeIds?: string[];
    priority?: string[];
    minDaysRemaining?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const accountKey = (body.accountKey ?? '').trim();
  const model = (body.model ?? '').trim();
  if (!accountKey || !model) {
    return NextResponse.json({ error: 'accountKey and model are required' }, { status: 400 });
  }
  if (!canAccessAccount(getAccountScope(session), accountKey)) return forbidden();

  // Keep only recognized offer types, in the order the caller gave them.
  const priority = body.priority?.filter((p): p is SelectableOfferType =>
    OFFER_TYPES.includes(p as SelectableOfferType),
  );

  try {
    const result = await dryRunOneVehicle({
      accountKey,
      make: body.make?.trim() || undefined,
      model,
      year: Number(body.year) || undefined,
      zip: body.zip?.trim() || undefined,
      templateId: body.templateId?.trim() || undefined,
      sizeIds: body.sizeIds?.length ? body.sizeIds : undefined,
      priority: priority?.length ? priority : undefined,
      minDaysRemaining:
        typeof body.minDaysRemaining === 'number' ? body.minDaysRemaining : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[api/ad-generator/automation/dry-run] failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Dry run failed' },
      { status: 500 },
    );
  }
}
