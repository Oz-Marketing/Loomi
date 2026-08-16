import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { getBillingMarkups, setBillingMarkup } from '@/lib/services/markup';

/**
 * Per-billing-category markup — the rate card. One rate per category (Digital,
 * Mass Media, Swag…), replacing the single agency-wide number that was really
 * just Digital's rate applied to everything.
 *
 * GET — management-tier, so the settings tab can render the table.
 * PUT — elevated only; body { category: string, markup: number }.
 *       One category per call: these are five-second edits, and a whole-table
 *       save makes a typo in one row roll back the four that were right.
 */
export async function GET() {
  const { error } = await requirePermission('agency.markup.view');
  if (error) return error;
  return NextResponse.json({ markups: await getBillingMarkups() });
}

export async function PUT(req: NextRequest) {
  const { error } = await requirePermission('finance.markup.manage');
  if (error) return error;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  try {
    const markup = await setBillingMarkup(String(body.category ?? ''), Number(body.markup));
    return NextResponse.json({ category: body.category, markup });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not save that rate.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
