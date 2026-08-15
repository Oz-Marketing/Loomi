/**
 * Per-sub-account form fields — /api/ad-generator/field-prefs
 *
 * GET  ?accountKey=&templateId= → every field on the template, which are hidden,
 *                                 and which may not be hidden (with the reason).
 * POST { accountKey, templateId, hiddenFields } → save the hidden set.
 *
 * Deliberately reachable by a NON-ADMIN: trimming your own form is the dealer's
 * business. That is safe because the endpoint cannot express anything dangerous —
 * it writes one JSON array, scoped to one (sub-account, template) pair, and the
 * array is sanitized against the template's own field list and its manufacturer
 * rules before it is stored.
 *
 * A hidden field is still submitted with whatever value it had, so hiding never
 * changes an ad's data — only what the form shows. Required fields are dropped
 * from the request rather than rejected, because hiding one would not relax the
 * requirement, it would remove the only way to satisfy it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { canAccessAccount, forbidden, getAccountScope, getAuthSession } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';
import { ALL_TEMPLATES } from '@/lib/ad-generator/templates';
import { adTemplateFromDoc } from '@/lib/ad-generator/doc-template';
import { boundFieldKeys, type TemplateDoc } from '@/lib/ad-generator/doc-types';
import type { FieldSpec } from '@/lib/ad-generator/types';
import { parseOemRule, type OemOfferRule } from '@/lib/ad-generator/compliance';
import { hidableFields, parseHiddenFields, sanitizeHiddenFields } from '@/lib/ad-generator/field-prefs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function gate(accountKey: string) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!accountKey) return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  if (!canAccessAccount(getAccountScope(session), accountKey)) return forbidden();
  return null;
}

/**
 * The template's fields and the make it's built for.
 *
 * Resolves a DB doc first, then the code-defined templates — the same identifier
 * space AdCreative uses, so an id from either kind works.
 */
async function templateContext(
  templateId: string,
): Promise<{ fields: FieldSpec[]; make: string; boundKeys?: Set<string> } | null> {
  const row = await prisma.adTemplateDoc
    .findUnique({ where: { id: templateId }, select: { doc: true } })
    .catch(() => null);
  if (row?.doc) {
    try {
      const doc = JSON.parse(row.doc) as TemplateDoc;
      if (Array.isArray(doc?.sizes)) {
        return {
          fields: adTemplateFromDoc(templateId, doc).fields ?? [],
          make: doc.make ?? '',
          boundKeys: boundFieldKeys(doc),
        };
      }
    } catch {
      /* fall through to the code templates */
    }
  }
  const code = ALL_TEMPLATES.find((t) => t.id === templateId);
  return code ? { fields: code.fields ?? [], make: '' } : null;
}

/** This make's required-field rule, or null. Never throws the request. */
async function ruleForMake(make: string): Promise<OemOfferRule | null> {
  if (!make.trim()) return null;
  try {
    const row = await prisma.adOemOfferRule.findFirst({
      where: { make: { equals: make, mode: 'insensitive' }, isActive: true },
      select: { make: true, requiredFields: true, defaultValues: true },
    });
    return row ? parseOemRule(row.make, row.requiredFields, row.defaultValues) : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const accountKey = (req.nextUrl.searchParams.get('accountKey') || '').trim();
  const templateId = (req.nextUrl.searchParams.get('templateId') || '').trim();
  const denied = await gate(accountKey);
  if (denied) return denied;
  if (!templateId) return NextResponse.json({ error: 'templateId is required' }, { status: 400 });

  try {
    const ctx = await templateContext(templateId);
    if (!ctx) return NextResponse.json({ error: 'That design is not available.' }, { status: 404 });

    const [pref, rule] = await Promise.all([
      prisma.adTemplateFieldPref
        .findUnique({ where: { accountKey_templateId: { accountKey, templateId } } })
        .catch(() => null),
      ruleForMake(ctx.make),
    ]);

    // Sanitized on READ as well as write, so a preference stored before a rule
    // gained a field stops hiding it the moment it becomes required.
    const hidden = sanitizeHiddenFields(parseHiddenFields(pref?.hiddenFields), ctx.fields, rule);

    return NextResponse.json({
      fields: hidableFields(ctx.fields, rule, ctx.boundKeys),
      hiddenFields: hidden,
    });
  } catch (err) {
    console.error('[api/adgen/field-prefs] GET failed:', err);
    return NextResponse.json({ error: 'Could not load the form fields' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: { accountKey?: string; templateId?: string; hiddenFields?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body' }, { status: 400 });
  }

  const accountKey = (body.accountKey ?? '').trim();
  const templateId = (body.templateId ?? '').trim();
  const denied = await gate(accountKey);
  if (denied) return denied;
  if (!templateId) return NextResponse.json({ error: 'templateId is required' }, { status: 400 });

  const requested = Array.isArray(body.hiddenFields)
    ? body.hiddenFields.filter((x): x is string => typeof x === 'string')
    : [];

  try {
    const ctx = await templateContext(templateId);
    if (!ctx) return NextResponse.json({ error: 'That design is not available.' }, { status: 404 });

    const rule = await ruleForMake(ctx.make);
    const hiddenFields = sanitizeHiddenFields(requested, ctx.fields, rule);
    const session = await getAuthSession();

    await prisma.adTemplateFieldPref.upsert({
      where: { accountKey_templateId: { accountKey, templateId } },
      create: {
        accountKey,
        templateId,
        hiddenFields: JSON.stringify(hiddenFields),
        updatedBy: session?.user?.email ?? null,
      },
      update: {
        hiddenFields: JSON.stringify(hiddenFields),
        updatedBy: session?.user?.email ?? null,
      },
    });

    // Return what was STORED, not what was asked for — the caller needs to see
    // that a protected field it sent was dropped, rather than assume it stuck.
    return NextResponse.json({ ok: true, hiddenFields });
  } catch (err) {
    console.error('[api/adgen/field-prefs] POST failed:', err);
    return NextResponse.json({ error: 'Could not save the form fields' }, { status: 500 });
  }
}
