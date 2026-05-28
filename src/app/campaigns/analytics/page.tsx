/**
 * Legacy alias. Campaigns + Messaging analytics now live on the
 * Reporting surface under /engagement.
 */
import { redirect } from 'next/navigation';

export default function CampaignsAnalyticsRedirect() {
  redirect('/engagement');
}
