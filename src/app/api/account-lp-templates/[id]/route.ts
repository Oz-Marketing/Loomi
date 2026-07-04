import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope, requireRole } from '@/lib/api-auth';
import {
  LpTemplateServiceError,
  deleteLpTemplate,
  updateLpTemplate,
} from '@/lib/services/lp-templates';

/**
 * PATCH /api/account-lp-templates/[id]
 *
 * Update the shared taxonomy (category/tags) + publish state of an LP template
 * from the template card.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  try {
    const template = await updateLpTemplate(id, getAccountScope(session!), {
      category: body?.category,
      tags: body?.tags,
      status: body?.status,
    });
    return NextResponse.json({ template });
  } catch (err) {
    if (err instanceof LpTemplateServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

/**
 * DELETE /api/account-lp-templates/[id]
 *
 * Remove a dealer-saved LP template. Templates are independent
 * snapshots, so deleting one doesn't affect any LP that was
 * created from it.
 */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await context.params;
  try {
    await deleteLpTemplate(id, getAccountScope(session!));
    return NextResponse.json({ deleted: true });
  } catch (err) {
    if (err instanceof LpTemplateServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
