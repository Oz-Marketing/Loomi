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
import { useAccount } from '@/contexts/account-context';
import { FlowsAnalyticsBody } from '@/components/flows/flows-analytics-body';

function AccountAnalyticsPage() {
  const { accountKey, accountData } = useAccount();
  const dealerName = accountData?.dealer || 'Your Account';

  return (
    <FlowsAnalyticsBody
      scopeKey={accountKey ?? 'no-account'}
      subtitle={`Drip-series performance for ${dealerName}`}
      showAccountColumn={false}
      presetAccountKey={accountKey}
    />
  );
}

/** One view, scoped to the active sub-account — the all-accounts variant
 *  belonged to agency scope, which is retired. */
export default function FlowsAnalyticsPage() {
  const { isAccount } = useAccount();
  return isAccount ? <AccountAnalyticsPage /> : null;
}
