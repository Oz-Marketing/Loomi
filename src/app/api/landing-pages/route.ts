import { NextRequest, NextResponse } from 'next/server';
import {
  canAccessAccount,
  forbidden,
  getAccountScope,
  requireRole,
} from '@/lib/api-auth';
import {
  createLandingPage,
  LandingPageServiceError,
  listLandingPages,
} from '@/lib/services/landing-pages';
import { getLandingPagePreset } from '@/lib/landing-pages/templates';

export async function GET() {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const scope = getAccountScope(session!);
  const pages = await listLandingPages(scope);
  return NextResponse.json({ pages });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const accountKey = typeof body?.accountKey === 'string' ? body.accountKey.trim() : '';
  const templateId = typeof body?.templateId === 'string' ? body.templateId : 'blank';
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }

  const scope = getAccountScope(session!);
  if (!canAccessAccount(scope, accountKey)) return forbidden();

  // Pick the preset by id (blank is the fallback). preset.build() is
  // called fresh on every create so each new page gets unique block
  // ids — no risk of two pages sharing the same id from the same
  // module-level frozen object.
  const preset = getLandingPagePreset(templateId) ?? getLandingPagePreset('blank')!;
  const schema = preset.build();

  try {
    const page = await createLandingPage({
      accountKey,
      name,
      schema,
      createdByUserId: session!.user.id,
    });
    return NextResponse.json({ page, redirect: templateId === 'blank' ? 'edit' : 'overview' }, { status: 201 });
  } catch (err) {
    if (err instanceof LandingPageServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
