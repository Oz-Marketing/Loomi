/**
 * Ad Generator OEM compliance rule — PATCH / DELETE one rule (admin only).
 * Companion to the collection route. Used by the rules manager at
 * /ad-generator/oem-rules. Flag-gated + management roles.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { adGeneratorAllowed } from '@/lib/ad-generator/access';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
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
  if (typeof body.make === 'string') data.make = body.make.trim();
  if (body.requiredFields && typeof body.requiredFields === 'object') {
    data.requiredFields = JSON.stringify(body.requiredFields);
  }
  if ('notes' in body) data.notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive;

  try {
    const row = await prisma.adOemOfferRule.update({ where: { id }, data });
    return NextResponse.json({ rule: row });
  } catch (err) {
    console.error('[api/ad-generator/oem-rules/[id]] update failed:', err);
    return NextResponse.json({ error: 'Could not update rule' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adGeneratorAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await requireRole('developer', 'super_admin', 'admin');
  if (error) return error;

  const { id } = await params;
  try {
    await prisma.adOemOfferRule.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/ad-generator/oem-rules/[id]] delete failed:', err);
    return NextResponse.json({ error: 'Could not delete rule' }, { status: 500 });
  }
}
