import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import {
  AccountDomainServiceError,
  verifyAccountDomain,
} from '@/lib/services/account-domains';

/**
 * POST /api/account-domains/[id]/verify
 *
 * Re-runs the DNS check for a pending domain. Idempotent — calling on
 * an already-verified domain just returns the row. The service throws
 * a 422 with a friendly message when the TXT record can't be resolved
 * or doesn't match the expected token.
 */
export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requirePermission('studio.domains.manage');
  if (error) return error;

  const { id } = await context.params;
  try {
    const domain = await verifyAccountDomain(id, getAccountScope(session!));
    return NextResponse.json({ domain });
  } catch (err) {
    if (err instanceof AccountDomainServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
