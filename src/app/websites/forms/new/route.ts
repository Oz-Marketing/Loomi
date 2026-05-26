import { NextRequest, NextResponse } from 'next/server';
import {
  canAccessAccount,
  forbidden,
  getAccountScope,
  requireRole,
} from '@/lib/api-auth';
import { createForm, FormServiceError } from '@/lib/services/forms';
import { getFormTemplatePreset } from '@/lib/forms/templates';

/**
 * Create a form from a template preset (or blank).
 *
 * Accepts JSON or form-data:
 *   accountKey      — required, the form's account
 *   name            — optional, defaults to the template's name
 *   templateId      — optional, defaults to 'blank'
 *   subaccountSlug  — optional, threads sub-account context into the
 *                     returned redirect path
 *
 * Returns JSON: { form, redirect } where `redirect` is the path the
 * client navigates to next:
 *   - Blank template → /websites/forms/<id>/edit (jump into builder)
 *   - Preset template → /websites/forms/<id>      (overview)
 *
 * GET still redirects to the list page so a stale bookmark of
 * /websites/forms/new doesn't 404.
 */
function withSubaccountPrefix(path: string, rawSlug: string | null): string {
  const slug = rawSlug?.trim() ?? '';
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) return path;
  return `/subaccount/${slug}${path}`;
}

async function readBody(req: NextRequest): Promise<{
  accountKey: string;
  name: string;
  templateId: string;
  subaccountSlug: string;
}> {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const json = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      accountKey: String(json.accountKey || '').trim(),
      name: String(json.name || '').trim(),
      templateId: String(json.templateId || 'blank').trim(),
      subaccountSlug: String(json.subaccountSlug || ''),
    };
  }
  const form = await req.formData();
  return {
    accountKey: String(form.get('accountKey') || '').trim(),
    name: String(form.get('name') || '').trim(),
    templateId: String(form.get('templateId') || 'blank').trim(),
    subaccountSlug: String(form.get('subaccountSlug') || ''),
  };
}

export async function GET(req: NextRequest) {
  return NextResponse.redirect(new URL('/websites/forms', req.url));
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { accountKey, name, templateId, subaccountSlug } = await readBody(req);

  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }
  const scope = getAccountScope(session!);
  if (!canAccessAccount(scope, accountKey)) return forbidden();

  const preset = getFormTemplatePreset(templateId);
  if (!preset) {
    return NextResponse.json(
      { error: `Unknown template "${templateId}"` },
      { status: 400 },
    );
  }

  // Blank → drop into builder. Preset → land on overview so the user
  // can see what they got before opening the editor. Both paths run
  // preset.build() — the blank preset seeds a small default form
  // (heading + email + submit) so the editor isn't a literal empty
  // rectangle. Passing undefined here would skip the seed.
  const isBlank = preset.id === 'blank';

  try {
    const form = await createForm({
      accountKey,
      name: name || preset.name,
      schema: preset.build(),
      createdByUserId: session!.user.id,
    });
    const redirect = withSubaccountPrefix(
      isBlank ? `/websites/forms/${form.id}/edit` : `/websites/forms/${form.id}`,
      subaccountSlug,
    );
    return NextResponse.json({ form, redirect }, { status: 201 });
  } catch (err) {
    if (err instanceof FormServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
