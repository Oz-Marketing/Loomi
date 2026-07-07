import { NextRequest, NextResponse } from 'next/server';
import {
  canAccessAccount,
  forbidden,
  getAccountScope,
  requireRole,
} from '@/lib/api-auth';
import {
  createLandingPage,
  getLandingPage,
  LandingPageServiceError,
  listLandingPages,
  listLandingPageTemplates,
} from '@/lib/services/landing-pages';
import { getLandingPagePreset } from '@/lib/landing-pages/templates';
import { getLpTemplate } from '@/lib/services/lp-templates';
import type { LandingPageContent } from '@/lib/landing-pages/types';

export async function GET(req: NextRequest) {
  const { session, error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const scope = getAccountScope(session!);

  // Templates tab: LP templates (isTemplate=true). A sub-account sees only its
  // own; at Admin an unrestricted manager (scope null) sees the WHOLE library
  // (global + every subaccount), filtered client-side via the rail's Subaccount
  // facet. A restricted admin still sees just the system library (no cross-
  // tenant leak).
  if (req.nextUrl.searchParams.get('isTemplate') === 'true') {
    const accountKey = req.nextUrl.searchParams.get('accountKey')?.trim() || null;
    if (accountKey && !canAccessAccount(scope, accountKey)) return forbidden();
    const includeAll = !accountKey && scope === null;
    const pages = await listLandingPageTemplates(accountKey, includeAll);
    return NextResponse.json({ pages });
  }

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
  const isTemplate = body?.isTemplate === true;
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  // Live pages + sub-account templates need an account; only an admin-curated
  // system/library template (isTemplate + no account) may be account-less.
  if (!accountKey && !isTemplate) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }

  const scope = getAccountScope(session!);
  if (accountKey && !canAccessAccount(scope, accountKey)) return forbidden();

  // Resolve the schema from one of two source kinds:
  //   1. Built-in preset by id ("blank" / "lead-capture" / etc.)
  //      → call preset.build() fresh on every create so each new
  //        page gets unique block ids (no risk of two pages sharing
  //        ids from a module-level frozen object).
  //   2. Account-saved template by id prefix "account:<uuid>"
  //      → load the AccountLandingPageTemplate row + deep-clone its
  //        schema. Scope-checked via getAccountScope so users can't
  //        seed from another account's template.
  let schema: LandingPageContent;
  if (templateId.startsWith('account:')) {
    const templateUuid = templateId.slice('account:'.length);
    const template = await getLpTemplate(templateUuid, scope);
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    if (template.accountKey !== accountKey) {
      // User picked a template from one account but is creating an
      // LP in another. Both accounts are in their scope (since
      // getLpTemplate returned non-null) but mixing account schemas
      // is suspicious — block it.
      return NextResponse.json(
        { error: 'Template belongs to a different account.' },
        { status: 403 },
      );
    }
    // Deep clone so new block ids etc. can be regenerated downstream
    // if needed (current behavior keeps the original ids; LP routes
    // don't care, but cloning protects against future code that
    // mutates `schema`).
    schema = JSON.parse(JSON.stringify(template.schema)) as LandingPageContent;
  } else if (templateId.startsWith('page:')) {
    // Create a live LP from an LP TEMPLATE (a LandingPage with isTemplate=true).
    const srcId = templateId.slice('page:'.length);
    const src = await getLandingPage(srcId, scope);
    if (!src) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    schema = JSON.parse(JSON.stringify(src.schema)) as LandingPageContent;
  } else {
    const preset = getLandingPagePreset(templateId) ?? getLandingPagePreset('blank')!;
    schema = preset.build();
  }

  try {
    const page = await createLandingPage({
      accountKey: accountKey || null,
      name,
      schema,
      isTemplate,
      createdByUserId: session!.user.id,
    });
    // Blank presets (both block-blank and html-blank) drop users
    // straight into the editor — there's nothing to "overview" yet.
    // Account templates always have filled-in content, so they
    // route to the overview like other prefilled presets.
    const goStraightToEditor = templateId === 'blank' || templateId === 'blank-html';
    return NextResponse.json(
      { page, redirect: goStraightToEditor ? 'edit' : 'overview' },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof LandingPageServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
