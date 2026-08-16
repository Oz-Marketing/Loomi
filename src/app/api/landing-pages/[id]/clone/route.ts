import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import {
  cloneLandingPage,
  LandingPageServiceError,
} from '@/lib/services/landing-pages';

/**
 * POST /api/landing-pages/[id]/clone
 *
 * Single-step duplicate. Returns the new page so the caller can
 * navigate to it without a second round-trip. Replaces the old
 * create-blank-then-PATCH-schema flow the list page was doing,
 * which produced a visible "blank → schema-restored" flash.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requirePermission('studio.landing_pages.edit');
  if (error) return error;

  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name : undefined;

  try {
    const page = await cloneLandingPage(id, getAccountScope(session!), {
      createdByUserId: session!.user.id,
      name,
    });
    return NextResponse.json({ page }, { status: 201 });
  } catch (err) {
    if (err instanceof LandingPageServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
