/**
 * Legacy alias. Sub-account messaging analytics moved to the Reporting
 * surface. Bookmarks that pre-date the migration land here and get
 * forwarded; AccountProvider on reporting falls back to a default
 * account if no `?account=` is set (rare path — fine).
 */
import { redirect } from 'next/navigation';

export default function SubaccountMessagingAnalyticsRedirect() {
  redirect('/engagement');
}
