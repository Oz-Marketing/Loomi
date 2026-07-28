import { NextRequest, NextResponse } from 'next/server';
import { completePasswordReset } from '@/lib/users/password-reset';
import { validatePassword } from '@/lib/users/password-policy';

/** Burn the reset token and set the new password. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!token) {
    return NextResponse.json({ error: 'Reset token is required' }, { status: 400 });
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  try {
    const completed = await completePasswordReset({ token, password });
    if (!completed) {
      return NextResponse.json(
        { error: 'This reset link is invalid or has expired' },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true, email: completed.user.email });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to reset your password';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
