import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope, requireRole } from '@/lib/api-auth';
import { FormServiceError, saveFormAsTemplate } from '@/lib/services/forms';

/**
 * POST /api/forms/[id]/save-as-template
 * Clone an existing form's schema into a new reusable template
 * (isTemplate=true), scoped to the same account. Body: { name? }.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name : undefined;

  try {
    const template = await saveFormAsTemplate({
      formId: id,
      accountKeys: getAccountScope(session!),
      name,
      createdByUserId: session!.user.id,
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    if (err instanceof FormServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
