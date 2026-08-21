import { withRouteErrors } from '@/lib/api-errors';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import {
  countUnreadForUser,
  listNotificationsForUser,
} from '@/lib/notifications/service';

async function handleGet(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const url = req.nextUrl;
  const unreadOnly = url.searchParams.get('unreadOnly') === '1';
  const limit = Number(url.searchParams.get('limit') || '50');

  const [items, unreadCount] = await Promise.all([
    listNotificationsForUser({ userId: session!.user.id, unreadOnly, limit }),
    countUnreadForUser(session!.user.id),
  ]);

  return NextResponse.json({ items, unreadCount });
}

// Wrapped so an unhandled throw returns the JSON error envelope instead of
// a 500 with an empty body, which a caller cannot parse or report.
export const GET = withRouteErrors(handleGet, 'notifications');
