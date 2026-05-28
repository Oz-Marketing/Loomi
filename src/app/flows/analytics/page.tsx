'use client';

/**
 * Legacy studio entry point for flow analytics.
 *
 * Flow analytics now canonically lives at `/reporting/engagement` and
 * users navigate there via the "View Analytics" affordance on
 * studio creative pages. This route is kept around so the
 * `/reporting/engagement` route can render the body too without a
 * cross-route import surprise.
 *
 * The actual rendering lives in `FlowsAnalyticsBody` so it can be
 * embedded by both surfaces (studio with the page header on, reporting
 * with it off).
 */
import { AdminOnly } from '@/components/route-guard';
import { useAccount } from '@/contexts/account-context';
import { FlowsAnalyticsBody } from '@/components/flows/flows-analytics-body';

function AdminAnalyticsPage() {
  return (
    <FlowsAnalyticsBody
      scopeKey="admin"
      subtitle="Drip-series performance across all accounts"
      showAccountColumn
      presetAccountKey={null}
    />
  );
}

function AccountAnalyticsPage() {
  const { accountKey, accountData } = useAccount();
  const dealerName = accountData?.dealer || 'Your Sub-Account';

  return (
    <FlowsAnalyticsBody
      scopeKey={accountKey ?? 'no-account'}
      subtitle={`Drip-series performance for ${dealerName}`}
      showAccountColumn={false}
      presetAccountKey={accountKey}
    />
  );
}

export default function FlowsAnalyticsPage() {
  const { isAdmin, isAccount } = useAccount();

  if (isAdmin) {
    return (
      <AdminOnly>
        <AdminAnalyticsPage />
      </AdminOnly>
    );
  }

  if (isAccount) {
    return <AccountAnalyticsPage />;
  }

  return null;
}
