/**
 * Legacy alias. Sub-account flow analytics moved to the Reporting surface.
 */
import { redirect } from 'next/navigation';

export default function SubaccountFlowsAnalyticsRedirect() {
  redirect('/engagement');
}
