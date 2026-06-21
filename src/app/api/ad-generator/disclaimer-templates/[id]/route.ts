/**
 * Ad Generator disclaimer template — PATCH / DELETE one template (admin only).
 * Companion to the collection route. Gated by the feature flag + management
 * roles. Used by the templates manager at /ad-generator/templates.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { AD_GENERATOR_ENABLED } from '@/lib/feature-flags';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!AD_GENERATOR_ENABLED) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if ('make' in body) data.make = typeof body.make === 'string' ? body.make.trim() || null : null;
  if (typeof body.offerType === 'string') data.offerType = body.offerType;
  if (typeof body.name === 'string') data.name = body.name.trim();
  if (typeof body.body === 'string') data.body = body.body;
  if (typeof body.isDefault === 'boolean') data.isDefault = body.isDefault;
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive;

  try {
    const row = await prisma.adDisclaimerTemplate.update({ where: { id }, data });
    return NextResponse.json({ template: row });
  } catch (err) {
    console.error('[api/ad-generator/disclaimer-templates/[id]] update failed:', err);
    return NextResponse.json({ error: 'Could not update template' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!AD_GENERATOR_ENABLED) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await params;
  try {
    await prisma.adDisclaimerTemplate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/ad-generator/disclaimer-templates/[id]] delete failed:', err);
    return NextResponse.json({ error: 'Could not delete template' }, { status: 500 });
  }
}
