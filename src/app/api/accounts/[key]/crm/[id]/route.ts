import { NextRequest, NextResponse } from 'next/server';
import {
  canAccessAccount,
  forbidden,
  getAccountScope,
  requireRole,
} from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  normalizeLeadEmails,
  parseLeadEmails,
  stringifyLeadEmails,
} from '@/lib/integrations/crm/lead-emails';

interface RouteParams {
  params: Promise<{ key: string; id: string }>;
}

const MANAGEMENT_ROLES = ['developer', 'super_admin', 'admin'] as const;

/** Returns the destination iff it exists AND belongs to `key`; else null. */
async function findScopedDestination(key: string, id: string) {
  const dest = await prisma.crmDestination.findUnique({ where: { id } });
  if (!dest || dest.accountKey !== key) return null;
  return dest;
}

/**
 * PATCH /api/accounts/[key]/crm/[id]
 * Body: { provider?, leadEmail?, enabled? }
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { error, session } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const { key, id } = await params;
  if (!canAccessAccount(getAccountScope(session!), key)) return forbidden();

  const existing = await findScopedDestination(key, id);
  if (!existing) {
    return NextResponse.json({ error: 'CRM destination not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const data: { leadEmails?: string; enabled?: boolean } = {};

  // provider is immutable. Each card is bound to one CRM and there's a
  // unique (accountKey, provider) constraint — allowing a provider edit
  // could collide with an already-connected provider (P2002 → 500). To
  // switch CRMs, disconnect and reconnect the other card.
  if ('provider' in body && body.provider !== existing.provider) {
    return NextResponse.json(
      { error: 'provider cannot be changed; disconnect and reconnect the other CRM instead.' },
      { status: 400 },
    );
  }

  if ('leadEmails' in body || 'leadEmail' in body) {
    const { emails, invalid } = normalizeLeadEmails(body.leadEmails ?? body.leadEmail);
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Invalid email${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}` },
        { status: 400 },
      );
    }
    if (emails.length === 0) {
      return NextResponse.json({ error: 'At least one valid CRM lead email is required.' }, { status: 400 });
    }
    data.leadEmails = stringifyLeadEmails(emails);
  }

  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'Invalid enabled value' }, { status: 400 });
    }
    data.enabled = body.enabled;
  }

  const updated = await prisma.crmDestination.update({ where: { id }, data });

  return NextResponse.json({
    destination: {
      id: updated.id,
      provider: updated.provider,
      leadEmails: parseLeadEmails(updated.leadEmails),
      enabled: updated.enabled,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    },
  });
}

/**
 * DELETE /api/accounts/[key]/crm/[id]
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { error, session } = await requireRole(...MANAGEMENT_ROLES);
  if (error) return error;

  const { key, id } = await params;
  if (!canAccessAccount(getAccountScope(session!), key)) return forbidden();

  const existing = await findScopedDestination(key, id);
  if (!existing) {
    return NextResponse.json({ error: 'CRM destination not found' }, { status: 404 });
  }

  await prisma.crmDestination.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
