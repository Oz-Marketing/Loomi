/**
 * Legacy alias. Campaign analytics moved to the Reporting surface.
 */
import { redirect } from 'next/navigation';

export default function SubaccountCampaignsAnalyticsRedirect() {
  redirect('/engagement');
}
