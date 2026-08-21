import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { createRateCard, listRateCards, reorderRateCards } from '@/lib/services/rate-cards';

/**
 * Rate cards — the agency's billing categories and their markups. This is the
 * canonical surface; `/api/billing-markups` is the older rate-only endpoint,
 * kept for its documented contract and now writing to the same table.
 *
 * GET  — management-tier, so the settings tab can render the table.
 * POST — elevated only; creates a category. Body { label, markup, key? }.
 * PUT  — elevated only; reorders. Body { ids: string[] } in display order.
 *
 * Rates are sent as the gross→spend FACTOR (0.77), not the margin percent the
 * UI types. The conversion stays in the form so the number crossing the wire is
 * the number the ledger stores.
 */
export async function GET(req: NextRequest) {
  const { error } = await requirePermission('agency.markup.view');
  if (error) return error;

  const includeArchived = req.nextUrl.searchParams.get('archived') === '1';
  return NextResponse.json({ rateCards: await listRateCards({ includeArchived }) });
}

export async function POST(req: NextRequest) {
  const { error } = await requirePermission('finance.markup.manage');
  if (error) return error;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  try {
    const card = await createRateCard({
      label: String(body.label ?? ''),
      markup: Number(body.markup),
      key: body.key == null ? undefined : String(body.key),
    });
    return NextResponse.json({ rateCard: card }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not create that rate card.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  const { error } = await requirePermission('finance.markup.manage');
  if (error) return error;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  if (!Array.isArray(body.ids) || body.ids.some((id: unknown) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'ids must be an array of rate card ids.' }, { status: 400 });
  }

  try {
    await reorderRateCards(body.ids as string[]);
    return NextResponse.json({ rateCards: await listRateCards({ includeArchived: true }) });
  } catch {
    return NextResponse.json({ error: 'Could not save that order.' }, { status: 400 });
  }
}
