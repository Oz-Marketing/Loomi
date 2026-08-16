/**
 * OAuth callback — GET /api/reporting/gbp/callback
 *
 * Google sends the user here after the consent screen. Exchanges the code for a
 * refresh token, stores it encrypted, and bounces back to the report page.
 *
 * ── WHAT MAKES THIS SAFE ────────────────────────────────────────────────────
 * `state` is verified, not trusted. It must be one we signed, unexpired, and
 * started by the SAME user completing it. Oz Dealer Tools read the account out
 * of an unsigned `state` and wrote the token there, which let a crafted link
 * bind a Google grant to any org. Everything here is derived from the verified
 * payload; nothing is read from a bare query parameter.
 *
 * Errors are redirected, not returned as JSON: the user is in a browser
 * mid-flow, and a raw 400 body is a dead end. The report page renders the
 * `gbp_error` parameter.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { prisma } from '@/lib/prisma';
import { GbpError, exchangeCode, getUserEmail } from '@/lib/integrations/gbp';
import { verifyState } from '@/lib/integrations/gbp-state';
import { saveConnection } from '@/lib/integrations/gbp-connection';

export const dynamic = 'force-dynamic';

/** Back to the report, with a message for the UI to surface. */
function back(req: NextRequest, params: Record<string, string>) {
  const url = new URL('/reporting/business-profile', req.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const { session, error } = await requirePermission('integrations.credentials.manage');
  if (error) return error;

  const sp = req.nextUrl.searchParams;

  // The user declined consent, or Google refused. Not an error worth logging.
  const denied = sp.get('error');
  if (denied) {
    return back(req, { gbp_error: `Google returned "${denied}". Nothing was connected.` });
  }

  const state = verifyState(sp.get('state'));
  if (!state) {
    return back(req, {
      gbp_error: 'That connection link was invalid or expired. Start the connection again.',
    });
  }

  // The flow must be finished by whoever started it. Without this, a signed
  // state lifted from one staff member's browser could be completed in
  // another's session.
  if (state.userId !== session!.user.id) {
    return back(req, {
      gbp_error: 'That connection was started by a different user. Start it again from your own session.',
    });
  }

  const code = sp.get('code');
  if (!code) return back(req, { gbp_error: 'Google did not return an authorisation code.' });

  const account = await prisma.account.findUnique({
    where: { key: state.accountKey },
    select: { key: true },
  });
  if (!account) return back(req, { gbp_error: 'That account no longer exists.' });

  try {
    const { accessToken, refreshToken } = await exchangeCode(code);
    const email = await getUserEmail(accessToken);

    await saveConnection({
      accountKey: state.accountKey,
      refreshToken,
      connectedEmail: email,
      userId: session!.user.id,
    });

    // Straight to the picker: a grant with no location chosen renders nothing,
    // so finishing the connect flow should hand over to the next step rather
    // than drop the user on an empty report.
    return back(req, { account: state.accountKey, gbp_connected: '1' });
  } catch (err) {
    const message =
      err instanceof GbpError ? err.message : 'Could not complete the Google connection.';
    if (!(err instanceof GbpError)) console.error('[reporting/gbp/callback]', err);
    return back(req, { account: state.accountKey, gbp_error: message });
  }
}
