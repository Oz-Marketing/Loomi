import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import {
  NOTIFICATION_TYPE_REGISTRY,
  defaultChannels,
  type NotificationType,
} from '@/lib/notifications/types';

const VALID_TYPES = new Set<NotificationType>(
  NOTIFICATION_TYPE_REGISTRY.map((m) => m.type),
);

type PrefRow = { type: string; enabled: boolean; emailEnabled: boolean };

/**
 * Shape the registry + the user's explicit rows into the settings-tab payload.
 * In-app and email are independent switches; each falls back to its own
 * registry default when the user has never touched this type.
 */
function buildItems(prefs: PrefRow[]) {
  const explicit = new Map(prefs.map((p) => [p.type, p]));

  return NOTIFICATION_TYPE_REGISTRY.map((meta) => {
    const defaults = defaultChannels(meta.type);
    const row = explicit.get(meta.type);
    return {
      type: meta.type,
      label: meta.label,
      description: meta.description,
      category: meta.category,
      channel: meta.channel,
      defaultEnabled: defaults.inApp,
      defaultEmailEnabled: defaults.email,
      enabled: row?.enabled ?? defaults.inApp,
      emailEnabled: row?.emailEnabled ?? defaults.email,
    };
  });
}

/**
 * GET /api/notifications/preferences
 *
 * Returns the registry (catalog of available notification types) joined with
 * the current user's explicit preferences. Types missing from the DB use the
 * registry's defaults.
 */
export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;

  const prefs = await prisma.notificationPreference.findMany({
    where: { userId: session!.user.id },
    select: { type: true, enabled: true, emailEnabled: true },
  });

  return NextResponse.json({ items: buildItems(prefs) });
}

interface UpdateBody {
  preferences?: Array<{ type: string; enabled?: boolean; emailEnabled?: boolean }>;
}

/**
 * PUT /api/notifications/preferences
 *
 * Body: { preferences: [{ type, enabled?, emailEnabled? }] }
 * Upserts the explicit preference rows for each provided type. Either channel
 * may be sent on its own — omitting one leaves it untouched. Unknown types are
 * silently ignored.
 */
export async function PUT(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const userId = session!.user.id;
  const body = (await req.json().catch(() => ({}))) as UpdateBody;
  const updates = Array.isArray(body.preferences) ? body.preferences : [];

  const valid = updates.filter(
    (u) =>
      typeof u.type === 'string' &&
      VALID_TYPES.has(u.type as NotificationType) &&
      // At least one channel has to be present, and anything present must be a
      // boolean — otherwise the upsert would write `undefined` over a real value.
      (typeof u.enabled === 'boolean' || typeof u.emailEnabled === 'boolean'),
  );

  await Promise.all(
    valid.map((u) => {
      // A brand-new row has to be seeded from the registry defaults for
      // whichever channel this request didn't mention, or an untouched channel
      // would silently take Prisma's column default instead of the type's.
      const defaults = defaultChannels(u.type as NotificationType);
      return prisma.notificationPreference.upsert({
        where: { userId_type: { userId, type: u.type } },
        create: {
          userId,
          type: u.type,
          enabled: u.enabled ?? defaults.inApp,
          emailEnabled: u.emailEnabled ?? defaults.email,
        },
        update: {
          ...(typeof u.enabled === 'boolean' && { enabled: u.enabled }),
          ...(typeof u.emailEnabled === 'boolean' && { emailEnabled: u.emailEnabled }),
        },
      });
    }),
  );

  // Return the fresh state after the upserts
  const prefs = await prisma.notificationPreference.findMany({
    where: { userId },
    select: { type: true, enabled: true, emailEnabled: true },
  });

  return NextResponse.json({ items: buildItems(prefs), updated: valid.length });
}
