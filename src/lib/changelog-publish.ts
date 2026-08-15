/**
 * Publishing a changelog entry — the one place a draft becomes visible and the
 * notification fan-out runs.
 *
 * Server-only: imports prisma and the notification service. Client components
 * should import from `@/lib/changelog` instead.
 */

import { prisma } from '@/lib/prisma';
import { sendImmediateNotificationEmail } from '@/lib/notifications/email';
import { loadChannelMap } from '@/lib/notifications/types';
import { MANAGEMENT_ROLES } from '@/lib/roles';
import type { ChangelogAudience } from '@/lib/changelog';

/** Fields the fan-out needs off each entry. */
interface PublishableEntry {
  id: string;
  title: string;
  type: string;
  audience: string;
}

export interface PublishResult {
  published: number;
  notified: number;
  emailed: number;
}

/**
 * The notification body: the entry titles, one per line, so the panel preview
 * says what actually shipped instead of "3 updates". Capped — a big release
 * shouldn't produce a wall of text in a bell popover.
 */
const MAX_LISTED = 6;

function buildSummary(entries: PublishableEntry[]): { title: string; body: string } {
  const title =
    entries.length === 1
      ? entries[0].title
      : `${entries.length} updates in Loomi`;

  const listed = entries.slice(0, MAX_LISTED).map((e) => `• ${e.title}`);
  const overflow = entries.length - listed.length;
  if (overflow > 0) listed.push(`• …and ${overflow} more`);

  // A single entry's own title is already the notification title; repeating it
  // in the body reads like a bug.
  const body = entries.length === 1 ? '' : listed.join('\n');
  return { title, body };
}

/**
 * Publish the given draft entries and notify eligible users.
 *
 * Audience is enforced per recipient, not per batch: staff see everything in
 * the release, client-role users see only the `everyone` entries. A release
 * that is entirely staff-only therefore never reaches a client at all.
 *
 * Only entries that are still `draft` are published — re-running against an
 * already-published id is a no-op, so a double-click on Publish can't send the
 * announcement twice.
 */
export async function publishChangelogEntries(
  ids: string[],
  publishedBy: string | null,
): Promise<PublishResult> {
  const empty: PublishResult = { published: 0, notified: 0, emailed: 0 };
  if (ids.length === 0) return empty;

  const drafts = await prisma.changelogEntry.findMany({
    where: { id: { in: ids }, status: 'draft' },
    select: { id: true, title: true, type: true, audience: true },
  });
  if (drafts.length === 0) return empty;

  const now = new Date();
  const draftIds = drafts.map((d) => d.id);

  await prisma.changelogEntry.updateMany({
    where: { id: { in: draftIds } },
    data: { status: 'published', publishedAt: now, publishedBy },
  });

  const result = await notifyOfEntries(drafts);

  await prisma.changelogEntry.updateMany({
    where: { id: { in: draftIds } },
    data: { notifiedAt: new Date() },
  });

  return { ...result, published: drafts.length };
}

/**
 * Fan a published release out to every user, honoring both the entry audience
 * and each user's own in-app / email switches.
 *
 * One notification per user for the whole release — not one per entry. A ten-fix
 * release should be one line in the bell panel and at most one email, or the
 * feature trains people to mute it.
 */
async function notifyOfEntries(
  entries: PublishableEntry[],
): Promise<Omit<PublishResult, 'published'>> {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true },
  });
  if (users.length === 0) return { notified: 0, emailed: 0 };

  const channels = await loadChannelMap(
    users.map((u) => u.id),
    'product_update',
  );

  const staffRoles = new Set<string>(MANAGEMENT_ROLES);
  const everyoneEntries = entries.filter((e) => e.audience === 'everyone');

  let notified = 0;
  let emailed = 0;

  for (const user of users) {
    const isStaff = staffRoles.has(user.role);
    const visible = isStaff ? entries : everyoneEntries;
    // Client-role user, staff-only release — nothing to tell them about.
    if (visible.length === 0) continue;

    const prefs = channels.get(user.id);
    if (!prefs?.inApp) continue;

    const { title, body } = buildSummary(visible);

    const notification = await prisma.notification.create({
      data: {
        userId: user.id,
        type: 'product_update',
        severity: 'info',
        title,
        body: body || null,
        link: '/changelog',
        metaJson: JSON.stringify({
          entryIds: visible.map((e) => e.id),
          dedupeKey: null,
        }),
      },
    });
    notified += 1;

    if (!prefs.email || !user.email) continue;
    try {
      await sendImmediateNotificationEmail({
        to: user.email,
        recipientName: user.name,
        item: { title, body: body || null, link: '/changelog', severity: 'info' },
      });
      await prisma.notification.update({
        where: { id: notification.id },
        data: { emailedAt: new Date() },
      });
      emailed += 1;
    } catch (err) {
      // A bad address shouldn't abort the rest of the fan-out.
      // eslint-disable-next-line no-console
      console.error('[changelog] product-update email failed', user.email, err);
    }
  }

  return { notified, emailed };
}

/** Narrow an arbitrary string to a valid audience, defaulting to `everyone`. */
export function coerceAudience(value: unknown): ChangelogAudience {
  return value === 'staff' ? 'staff' : 'everyone';
}
