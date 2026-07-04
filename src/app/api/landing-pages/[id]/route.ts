import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope, requireRole } from '@/lib/api-auth';
import {
  deleteLandingPage,
  LandingPageServiceError,
  getLandingPage,
  updateLandingPage,
} from '@/lib/services/landing-pages';

function serviceError(err: unknown) {
  if (err instanceof LandingPageServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  throw err;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await context.params;
  const page = await getLandingPage(id, getAccountScope(session!));
  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ page });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  try {
    const page = await updateLandingPage(id, getAccountScope(session!), {
      name: body?.name,
      slug: body?.slug,
      status: body?.status,
      schema: body?.schema,
      seoTitle: body?.seoTitle,
      seoDescription: body?.seoDescription,
      ogImageUrl: body?.ogImageUrl,
      noindex: body?.noindex,
      faviconUrl: body?.faviconUrl,
      metaPixelId: body?.metaPixelId,
      ga4MeasurementId: body?.ga4MeasurementId,
      gtmContainerId: body?.gtmContainerId,
      customHeadHtml: body?.customHeadHtml,
      customBodyEndHtml: body?.customBodyEndHtml,
      category: body?.category,
      tags: body?.tags,
    });
    return NextResponse.json({ page });
  } catch (err) {
    return serviceError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await context.params;
  try {
    await deleteLandingPage(id, getAccountScope(session!));
    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    return serviceError(err);
  }
}
