import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/api-auth';
import { ELEVATED_ROLES } from '@/lib/auth';
import { hasUnrestrictedAccountAccess } from '@/lib/roles';
import * as orgService from '@/lib/services/organizations';

type OrgWithAccounts = Awaited<ReturnType<typeof orgService.getOrganizations>>[number];

/** Serialize an org (+ its child accounts) into the client-facing shape. */
function serializeOrg(org: OrgWithAccounts) {
  return {
    id: org.id,
    key: org.key,
    slug: org.slug,
    name: org.name,
    logos: org.logos,
    branding: org.branding,
    accountKeys: org.accounts.map((a) => a.key),
    accounts: org.accounts.map((a) => ({ key: a.key, slug: a.slug, dealer: a.dealer })),
  };
}

/**
 * GET /api/organizations
 *
 * Returns a key-indexed map of organizations the user can see:
 *   - developer / super_admin / unrestricted admin → all orgs
 *   - everyone else → orgs they hold a grant to (orgKeys) OR that own any
 *     rooftop in their accountKeys.
 */
export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;

  try {
    const { role, accountKeys = [], orgKeys = [] } = session!.user;
    const unrestricted = hasUnrestrictedAccountAccess(role, accountKeys);

    const orgs = unrestricted
      ? await orgService.getOrganizations()
      : (await orgService.getOrganizations()).filter((org) => {
          if (orgKeys.includes(org.key)) return true;
          return org.accounts.some((a) => accountKeys.includes(a.key));
        });

    const result: Record<string, ReturnType<typeof serializeOrg>> = {};
    for (const org of orgs) {
      result[org.key] = serializeOrg(org);
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error('[api/organizations] GET failed:', err);
    return NextResponse.json({ error: 'Could not read organizations' }, { status: 500 });
  }
}

/**
 * POST /api/organizations — create an organization (elevated roles only).
 * Body: { key, name, accountKeys?: string[] }
 */
export async function POST(req: NextRequest) {
  const { error } = await requireRole(...ELEVATED_ROLES);
  if (error) return error;

  try {
    const body = (await req.json()) as {
      key?: string;
      name?: string;
      accountKeys?: unknown;
    };

    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: 'Missing name' }, { status: 400 });
    }

    const safeKey = (body.key ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeKey) {
      return NextResponse.json({ error: 'Invalid or missing key' }, { status: 400 });
    }
    if (safeKey.startsWith('_')) {
      return NextResponse.json({ error: 'Organization key cannot start with "_"' }, { status: 400 });
    }

    const existing = await orgService.getOrganizationByKey(safeKey);
    if (existing) {
      return NextResponse.json({ error: 'Organization key already exists' }, { status: 409 });
    }

    const org = await orgService.createOrganization({ key: safeKey, name });

    const accountKeys = Array.isArray(body.accountKeys)
      ? body.accountKeys.filter((k): k is string => typeof k === 'string')
      : [];
    if (accountKeys.length > 0) {
      await orgService.setOrganizationAccounts(org.id, accountKeys);
    }

    return NextResponse.json({ id: org.id, key: org.key, slug: org.slug, name: org.name });
  } catch (err) {
    console.error('[api/organizations] POST failed:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
