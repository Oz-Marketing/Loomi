/**
 * Messaging analytics has moved to the Reporting surface
 * (`reporting.loomilm.com/engagement`). This route is kept only to
 * catch in-flight bookmarks / old links and forward them along.
 *
 * Phase 2 will fully extract the messaging analytics view from
 * `/messaging/blasts/page.tsx` so it can render natively on
 * reporting; until then this redirect lands the user on the engagement
 * surface where flow analytics already render.
 */
import { redirect } from 'next/navigation';

export default function MessagingAnalyticsRedirect() {
  redirect('/engagement');
}
