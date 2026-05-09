import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { MANAGEMENT_ROLES } from '@/lib/auth';
import * as templateService from '@/lib/services/templates';
import { isV2Template, parseV2Template } from '@/lib/email/types';
import { renderEmailTemplate } from '@/lib/email/render';

async function compileToHtml(content: string, opts: { pretty?: boolean } = {}): Promise<string> {
  if (isV2Template(content)) {
    const tpl = parseV2Template(content);
    if (!tpl) throw new Error('Invalid v2 template JSON');
    return renderEmailTemplate(tpl, { pretty: opts.pretty ?? true });
  }
  // Pure HTML — return as-is (legacy x-base scaffold no longer supported)
  return content;
}

/**
 * POST /api/templates/export
 *
 * Build and export one or more templates as compiled HTML.
 *
 * Body:
 *   { design: string }         -> single template
 *   { designs: string[] }      -> multiple templates
 *
 * Returns:
 *   Single  -> { files: [{ name, html }] }
 *   Multiple -> { files: [{ name, html }, ...] }
 */
export async function POST(req: NextRequest) {
  const { error } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  try {
    const body = await req.json();

    // Collect designs to build
    let designs: string[] = [];
    if (body.design) {
      designs = [body.design];
    } else if (Array.isArray(body.designs)) {
      designs = body.designs;
    } else {
      return NextResponse.json({ error: 'Provide "design" or "designs" array' }, { status: 400 });
    }

    const files: { name: string; html: string }[] = [];
    const errors: { name: string; error: string }[] = [];

    for (const design of designs) {
      const template = await templateService.getTemplate(design);
      if (!template) {
        errors.push({ name: design, error: 'Template not found' });
        continue;
      }

      try {
        const html = await compileToHtml(template.content, { pretty: true });
        files.push({ name: `${design}.html`, html });
      } catch (err: any) {
        errors.push({ name: design, error: err?.message || 'Build failed' });
      }
    }

    return NextResponse.json({ files, errors: errors.length > 0 ? errors : undefined });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Export failed' },
      { status: 500 },
    );
  }
}
