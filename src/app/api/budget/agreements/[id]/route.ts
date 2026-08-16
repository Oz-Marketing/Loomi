import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope, forbidden } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import * as budget from '@/lib/services/budget';

/**
 * PATCH  /api/budget/agreements/[id] — edit term, commitment, or fees.
 * DELETE /api/budget/agreements/[id] — archive it. Lines keep their money and
 *        their link, so history stays readable.
 * POST   /api/budget/agreements/[id]?generate=YYYY — stamp the year's fee lines.
 */
async function authorize(id: string, scope: string[] | null) {
  const agreement = await budget.getAgreement(id);
  if (!agreement) return { agreement: null, denied: false };
  return { agreement, denied: !budget.canAccess(scope, agreement.accountKey) };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requirePermission('projects.budget.edit');
  if (error) return error;
  const { id } = await params;

  const { agreement, denied } = await authorize(id, getAccountScope(session!));
  if (!agreement) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (denied) return forbidden();

  const body = await req.json().catch(() => ({}));
  try {
    const updated = await budget.updateAgreement(id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      startDate: typeof body.startDate === 'string' ? body.startDate : undefined,
      endDate: typeof body.endDate === 'string' ? body.endDate : undefined,
      committedAmount:
        'committedAmount' in body
          ? body.committedAmount == null
            ? null
            : Number(body.committedAmount)
          : undefined,
      status: typeof body.status === 'string' ? body.status : undefined,
      defaultMarkup:
        'defaultMarkup' in body
          ? body.defaultMarkup == null
            ? null
            : Number(body.defaultMarkup)
          : undefined,
      notes: 'notes' in body ? (body.notes ?? null) : undefined,
      fees: Array.isArray(body.fees) ? body.fees : undefined,
    });
    return NextResponse.json({ agreement: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update the agreement' },
      { status: 400 },
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requirePermission('projects.budget.edit');
  if (error) return error;
  const { id } = await params;

  const { agreement, denied } = await authorize(id, getAccountScope(session!));
  if (!agreement) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (denied) return forbidden();

  const year = Number(req.nextUrl.searchParams.get('generate'));
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: 'generate=YYYY is required' }, { status: 400 });
  }

  try {
    const lines = await budget.generateAgreementFeeLines(id, year, session!.user.id);
    return NextResponse.json({ generated: lines });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate fee lines' },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requirePermission('projects.budget.edit');
  if (error) return error;
  const { id } = await params;

  const { agreement, denied } = await authorize(id, getAccountScope(session!));
  if (!agreement) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (denied) return forbidden();

  return NextResponse.json({ ok: await budget.archiveAgreement(id) });
}
