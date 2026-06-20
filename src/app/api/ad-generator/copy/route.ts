/**
 * Ad Generator AI copy — POST /api/ad-generator/copy
 *
 * Body: { templateId, data, dealerName?, tone?, brief?, count? }. Returns
 * AI-written marketing copy for the template's `copy` fields plus Meta + Google
 * channel captions, in several variations. The set of writable fields is
 * derived server-side from the template (the client can't inject arbitrary
 * fields), and the model is constrained to copy only — numbers + legal stay
 * deterministic. Gated by the same feature flag as the tool itself.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/api-auth';
import { AD_GENERATOR_ENABLED } from '@/lib/feature-flags';
import { getTemplate } from '@/lib/ad-generator/templates';
import { generateAdCopy } from '@/lib/ai/ad-copy';
import type { AdCopyField } from '@/lib/ad-generator/copy-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface CopyBody {
  templateId?: string;
  data?: Record<string, string>;
  dealerName?: string;
  tone?: string;
  brief?: string;
  count?: number;
}

export async function POST(req: NextRequest) {
  if (!AD_GENERATOR_ENABLED) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: CopyBody;
  try {
    body = (await req.json()) as CopyBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const template = getTemplate(body.templateId ?? '');
  if (!template) return NextResponse.json({ error: 'Unknown template' }, { status: 400 });

  const copyFields: AdCopyField[] = template.fields
    .filter((f) => f.copy)
    .map((f) => ({ key: f.key, label: f.label, maxLength: f.maxLength }));
  if (copyFields.length === 0) {
    return NextResponse.json(
      { error: 'This template has no AI-writable copy fields' },
      { status: 400 },
    );
  }

  const context = body.data ?? {};
  try {
    const result = await generateAdCopy({
      templateName: template.name,
      copyFields,
      context,
      dealerName: body.dealerName || context.dealerName || 'the dealership',
      tone: body.tone,
      brief: body.brief,
      count: Math.min(Math.max(body.count ?? 3, 1), 5),
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[api/ad-generator/copy] failed:', err);
    const notConfigured =
      err instanceof Error && /ANTHROPIC_API_KEY/.test(err.message);
    return NextResponse.json(
      { error: notConfigured ? 'AI copy is not configured' : 'Failed to generate copy' },
      { status: notConfigured ? 503 : 500 },
    );
  }
}
