import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/api-auth';
import { ELEVATED_ROLES } from '@/lib/auth';
import { hasUnrestrictedAccountAccess } from '@/lib/roles';
import * as orgService from '@/lib/services/organizations';

/**
 * GET /api/organizations/[id]
 *
 * Full detail for one organization incl. its child accounts. Readable by
 * elevated/unrestricted users, users granted the org, or users assigned to
 * one of its rooftops.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id } = await params;
  const org = await orgService.getOrganization(id);
  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  const { role, accountKeys = [], orgKeys = [] } = session!.user;
  const canRead =
    hasUnrestrictedAccountAccess(role, accountKeys) ||
    orgKeys.includes(org.key) ||
    org.accounts.some((a) => accountKeys.includes(a.key));
  if (!canRead) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    id: org.id,
    key: org.key,
    slug: org.slug,
    name: org.name,
    logos: org.logos,
    branding: org.branding,
    accountKeys: org.accounts.map((a) => a.key),
    accounts: org.accounts.map((a) => ({ key: a.key, slug: a.slug, dealer: a.dealer })),
  });
}

/**
 * PATCH /api/organizations/[id] — elevated only.
 * Body (all optional): { name, slug, logos, branding, accountKeys }
 * When `accountKeys` is present it replaces the org's exact membership.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireRole(...ELEVATED_ROLES);
  if (error) return error;

  const { id } = await params;
  const existing = await orgService.getOrganization(id);
  if (!existing) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    slug?: string;
    logos?: string | null;
    branding?: string | null;
    accountKeys?: unknown;
  };

  const data: Parameters<typeof orgService.updateOrganization>[1] = {};
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
  if (typeof body.slug === 'string' && body.slug.trim()) data.slug = body.slug.trim();
  if (body.logos !== undefined) data.logos = body.logos;
  if (body.branding !== undefined) data.branding = body.branding;

  try {
    if (Object.keys(data).length > 0) {
      await orgService.updateOrganization(id, data);
    }
    if (Array.isArray(body.accountKeys)) {
      const keys = body.accountKeys.filter((k): k is string => typeof k === 'string');
      await orgService.setOrganizationAccounts(id, keys);
    }
    const updated = await orgService.getOrganization(id);
    return NextResponse.json({
      id: updated!.id,
      key: updated!.key,
      slug: updated!.slug,
      name: updated!.name,
      accountKeys: updated!.accounts.map((a) => a.key),
    });
  } catch (err) {
    console.error('[api/organizations/[id]] PATCH failed:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** DELETE /api/organizations/[id] — elevated only. Detaches child rooftops. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireRole(...ELEVATED_ROLES);
  if (error) return error;

  const { id } = await params;
  const existing = await orgService.getOrganization(id);
  if (!existing) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  try {
    await orgService.deleteOrganization(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/organizations/[id]] DELETE failed:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
