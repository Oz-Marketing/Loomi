import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import * as templateService from '@/lib/services/templates';
import * as versionService from '@/lib/services/template-versions';

export async function POST(req: NextRequest) {
  const { session, error } = await requirePermission('studio.templates.edit');
  if (error) return error;

  try {
    const { design, versionId } = await req.json();

    if (!design) {
      return NextResponse.json({ error: 'Missing design' }, { status: 400 });
    }
    if (!versionId) {
      return NextResponse.json({ error: 'Missing versionId' }, { status: 400 });
    }

    const template = await templateService.getTemplate(design);
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    const restored = await versionService.restoreVersion(template.id, versionId, session!.user.id);

    return NextResponse.json({ success: true, raw: restored.content });
  } catch (err: any) {
    const message = err?.message || 'Failed to restore template version';
    let status = 500;
    if (message.includes('not found')) status = 404;
    if (message.includes('does not belong')) status = 400;
    return NextResponse.json({ error: message }, { status });
  }
}
