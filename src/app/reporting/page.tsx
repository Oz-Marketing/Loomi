'use client';

/**
 * Reporting home.
 *
 * TWO DASHBOARDS, CHOSEN BY SCOPE — they answer different questions rather
 * than competing:
 *
 *   one account selected → Marketing Overview (this port of Oz Dealer Tools'
 *     `reports/marketing-dashboard`): how is THIS store doing, every channel
 *     on one page.
 *   no account / a group → the existing role-aware portfolio dashboard: how is
 *     the book of business doing, with its own widgets and saved layouts.
 *
 * ODT only had the first, because an ODT user was always inside one org. Loomi
 * users switch accounts from the top bar, so "the dashboard" genuinely means
 * two things depending on where they are — and the portfolio view has
 * customisable layouts that a single-account composite has no equivalent for.
 * Replacing it outright would have thrown that away to answer a question it
 * was never asked.
 */
import { useAccount } from '@/contexts/account-context';
import { RoleDashboard } from '@/components/dashboards/role-dashboard';
import { MarketingOverview } from './_components/marketing-overview';

export default function ReportingDashboardPage() {
  const { accountKey, accountData, isRollup } = useAccount();

  if (accountKey && !isRollup) {
    return (
      <MarketingOverview accountKey={accountKey} dealer={accountData?.dealer || accountKey} />
    );
  }

  return <RoleDashboard />;
}
