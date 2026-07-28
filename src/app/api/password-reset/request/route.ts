import { NextRequest, NextResponse } from 'next/server';
import { requestPasswordReset } from '@/lib/users/password-reset';

/**
 * Start a password reset. Unauthenticated by design (see the proxy's public
 * path list).
 *
 * The response is ALWAYS `{ success: true }` — an unknown address, a throttled
 * repeat request, and a delivered email are indistinguishable to the caller, so
 * the endpoint can't be used to enumerate who has a Loomi account. Real
 * failures are logged server-side.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email : '';

  if (!email.trim()) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  try {
    const { outcome } = await requestPasswordReset(email);
    if (outcome !== 'sent') {
      console.log(`[password-reset] request not sent (${outcome})`);
    }
  } catch (err) {
    // A send failure (SMTP down/misconfigured) is worth logging loudly, but we
    // still don't differentiate it in the response.
    console.error('[password-reset] failed to send reset email', err);
  }

  return NextResponse.json({ success: true });
}
