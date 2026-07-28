import { NextRequest, NextResponse } from 'next/server';
import { findActiveResetByToken } from '@/lib/users/password-reset';

/**
 * Check a reset token before showing the new-password form, so an expired or
 * already-used link fails up front instead of after the user types a password.
 * Returns only the email it belongs to — the token itself is the credential.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim() || '';
  if (!token) {
    return NextResponse.json({ error: 'Reset token is required' }, { status: 400 });
  }

  const reset = await findActiveResetByToken(token);
  if (!reset) {
    return NextResponse.json(
      { error: 'This reset link is invalid or has expired' },
      { status: 404 },
    );
  }

  return NextResponse.json({
    user: { name: reset.user.name, email: reset.user.email },
    expiresAt: reset.expiresAt.toISOString(),
  });
}
