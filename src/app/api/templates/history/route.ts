import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import * as templateService from '@/lib/services/templates';
import * as versionService from '@/lib/services/template-versions';

export async function GET(req: NextRequest) {
  const { error } = await requirePermission('studio.templates.view');
  if (error) return error;

  try {
    const design = req.nextUrl.searchParams.get('design');
    if (!design) {
      return NextResponse.json({ error: 'Missing design' }, { status: 400 });
    }

    const template = await templateService.getTemplate(design);
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    const versionId = req.nextUrl.searchParams.get('versionId');
    if (versionId) {
      const version = await versionService.getVersion(versionId);
      if (!version) {
        return NextResponse.json({ error: 'Version not found' }, { status: 404 });
      }
      return NextResponse.json({ id: version.id, raw: version.content, createdAt: version.createdAt });
    }

    const versions = await versionService.getVersions(template.id);
    return NextResponse.json({
      versions: versions.map((v) => ({
        id: v.id,
        createdAt: v.createdAt.toISOString(),
        createdBy: v.createdByUser?.name || null,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to fetch template history' }, { status: 500 });
  }
}
