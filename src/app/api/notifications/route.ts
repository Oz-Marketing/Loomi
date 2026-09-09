import { withRouteErrors } from '@/lib/api-errors';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import {
  countUnreadForUser,
  deleteNotifications,
  listNotificationsForUser,
} from '@/lib/notifications/service';
import { getNotificationTypeMeta } from '@/lib/notifications/types';
import type { NotificationType } from '@/lib/notifications/types';

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

  // Category comes from the server because the registry lives in `types.ts`,
  // which pulls in prisma and cannot be imported by the client panel. Sending
  // it per item beats a second type→category table in the component that would
  // silently fall behind the registry.
  const withCategory = items.map((n) => ({
    ...n,
    category: getNotificationTypeMeta(n.type as NotificationType)?.category ?? null,
    typeLabel: getNotificationTypeMeta(n.type as NotificationType)?.label ?? null,
  }));

  return NextResponse.json({ items: withCategory, unreadCount });
}

// Wrapped so an unhandled throw returns the JSON error envelope instead of
// a 500 with an empty body, which a caller cannot parse or report.
export const GET = withRouteErrors(handleGet, 'notifications');

/** DELETE /api/notifications — dismiss one or more of the caller's own. */
async function handleDelete(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === 'string') : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids[] required' }, { status: 400 });
  }
  const deleted = await deleteNotifications(session!.user.id, ids);
  return NextResponse.json({ deleted });
}

export const DELETE = withRouteErrors(handleDelete, 'notifications');
