import { NextRequest, NextResponse } from 'next/server';
import {
  acceptInviteAndSetPassword,
  validateInvitePassword,
} from '@/lib/users/invitations';
import { clientErrorMessage } from '@/lib/api-errors';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!token) {
    return NextResponse.json({ error: 'Invite token is required' }, { status: 400 });
  }

  const passwordError = validateInvitePassword(password);
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  try {
    const accepted = await acceptInviteAndSetPassword({ token, password });
    if (!accepted) {
      return NextResponse.json({ error: 'Invite is invalid or expired' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      email: accepted.user.email,
    });
  } catch (err) {
    const message = clientErrorMessage(err, 'Unable to accept invite');
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
