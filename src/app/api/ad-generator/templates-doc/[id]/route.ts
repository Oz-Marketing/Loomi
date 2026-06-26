/**
 * Ad Generator data-driven template — GET / PATCH / DELETE one (by id).
 * Companion to the collection route. GET is session-gated (the builder loads a
 * doc to edit); PATCH/DELETE are admin-gated. Flag-gated throughout.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireRole } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const session = await getAuthSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const row = await prisma.adTemplateDoc.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    let doc: unknown = null;
    try {
      doc = JSON.parse(row.doc);
    } catch {
      doc = null;
    }
    return NextResponse.json({
      template: { id: row.id, name: row.name, description: row.description, status: row.status, doc },
    });
  } catch (err) {
    console.warn('[api/ad-generator/templates-doc/[id]] GET failed:', err);
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;
  const session = await getAuthSession();

  const { id } = await params;
  let body: { name?: string; description?: string; doc?: unknown; status?: string; isActive?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.name === 'string') data.name = body.name.trim();
  if ('description' in body) data.description = body.description?.trim() || null;
  if (typeof body.status === 'string') data.status = body.status === 'published' ? 'published' : 'draft';
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
  if (body.doc && typeof body.doc === 'object' && Array.isArray((body.doc as { sizes?: unknown }).sizes)) {
    const u = session?.user as { name?: string | null; email?: string | null; image?: string | null } | undefined;
    data.doc = JSON.stringify(body.doc);
    data.createdBy = u?.email ?? null;
    data.createdByName = u?.name ?? null;
    data.createdByEmail = u?.email ?? null;
    data.createdByImage = u?.image ?? null;
  }

  try {
    const row = await prisma.adTemplateDoc.update({ where: { id }, data });
    return NextResponse.json({ template: { id: row.id, name: row.name, status: row.status } });
  } catch (err) {
    console.error('[api/ad-generator/templates-doc/[id]] update failed:', err);
    return NextResponse.json({ error: 'Could not update template' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await params;
  try {
    await prisma.adTemplateDoc.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/ad-generator/templates-doc/[id]] delete failed:', err);
    return NextResponse.json({ error: 'Could not delete template' }, { status: 500 });
  }
}
