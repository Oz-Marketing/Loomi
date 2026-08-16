import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/require';
import { issueAndSendUserInvite } from '@/lib/users/invitations';

export async function POST(req: NextRequest) {
  const { error, session } = await requirePermission('agency.users.invite');
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  if (!userId) {
    return NextResponse.json({ error: 'User id is required' }, { status: 400 });
  }

  try {
    const result = await issueAndSendUserInvite({
      userId,
      invitedByName: session?.user?.name || 'Loomi Studio',
    });

    return NextResponse.json({
      success: true,
      userId: result.user.id,
      email: result.user.email,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send invite';
    const status = message.startsWith('Invite email is not configured') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
