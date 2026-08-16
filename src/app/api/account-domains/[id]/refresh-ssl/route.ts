import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import {
  AccountDomainServiceError,
  refreshAccountDomainSsl,
} from '@/lib/services/account-domains';

/**
 * POST /api/account-domains/[id]/refresh-ssl
 *
 * Re-polls Cloudflare for the current SSL provisioning status and
 * persists it. No-op when Cloudflare isn't configured or when the
 * domain hasn't been registered with CF yet.
 */
export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requirePermission('studio.domains.manage');
  if (error) return error;

  const { id } = await context.params;
  try {
    const domain = await refreshAccountDomainSsl(id, getAccountScope(session!));
    return NextResponse.json({ domain });
  } catch (err) {
    if (err instanceof AccountDomainServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
