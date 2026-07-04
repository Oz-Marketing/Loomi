import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope, requireRole } from '@/lib/api-auth';
import {
  LandingPageServiceError,
  saveLandingPageAsTemplate,
} from '@/lib/services/landing-pages';

/**
 * POST /api/landing-pages/[id]/save-as-template
 *
 * Clone the source LP's schema into a new LP template (a LandingPage with
 * isTemplate=true), shown in Templates → Landing Pages and editable in place.
 * Body: { name }
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name : '';

  try {
    const template = await saveLandingPageAsTemplate({
      lpId: id,
      accountKeys: getAccountScope(session!),
      name,
      createdByUserId: session!.user.id,
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    if (err instanceof LandingPageServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
