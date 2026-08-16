/**
 * Start the Business Profile OAuth flow — GET /api/reporting/gbp/connect
 *
 * STAFF ONLY. Connecting binds a dealership employee's Google grant to a Loomi
 * account; a `client` reading their own report has no business initiating it,
 * so this sits behind `integrations.credentials.manage` while the report itself does not.
 *
 * Redirects to Google's consent screen with a signed `state` (see
 * lib/integrations/gbp-state.ts — ODT trusted an unsigned org id here).
 *
 * Query params:
 *   accountKey  — the account to bind the grant to (required)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAccountScope, forbidden } from '@/lib/api-auth';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';
import { GbpError, buildAuthUrl, getGbpConfig } from '@/lib/integrations/gbp';
import { signState } from '@/lib/integrations/gbp-state';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { session, error } = await requirePermission('integrations.credentials.manage');
  if (error) return error;

  const accountKey = req.nextUrl.searchParams.get('accountKey');
  if (!accountKey) {
    return NextResponse.json({ error: 'accountKey is required' }, { status: 400 });
  }

  const scope = getAccountScope(session!);
  if (scope !== null && !scope.includes(accountKey)) return forbidden();

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true },
  });
  if (!account) return NextResponse.json({ error: 'Unknown account' }, { status: 404 });

  if (!getGbpConfig()) {
    return NextResponse.json(
      {
        error:
          'Google Business Profile is not configured on the server (set GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REDIRECT_URI).',
        code: 'not_configured',
      },
      { status: 503 },
    );
  }

  try {
    const state = signState(accountKey, session!.user.id);
    return NextResponse.redirect(buildAuthUrl(state));
  } catch (err) {
    const message = err instanceof GbpError ? err.message : 'Could not start the Google connection.';
    console.error('[reporting/gbp/connect]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
