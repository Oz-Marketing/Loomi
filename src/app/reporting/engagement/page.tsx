'use client';

import { useAccount } from '@/contexts/account-context';
import { EngagementSection } from '@/components/campaigns/engagement-section';
import { FlowsAnalyticsBody } from '@/components/flows/flows-analytics-body';
import { DEFAULT_DATE_RANGE } from '@/lib/date-ranges';
import { PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { PageHeader } from '@/components/page-header';

/**
 * Engagement reporting — stacks messaging + flows analytics on one page.
 *
 *   ┌─ PageHeader ───────────┐
 *   │ "Engagement reporting" │
 *   └────────────────────────┘
 *   ┌─ Messaging ─┐
 *   │ <EngagementSection /> — campaign + email perf (sends, opens, clicks, bounces)
 *   └─────────────┘
 *   ┌─ Flows ─┐
 *   │ <FlowsAnalyticsBody /> — drip-series KPIs + per-flow table
 *   └─────────┘
 *
 * Both child components self-fetch their data (via SWR / useEffect) and
 * react to the active account from `useAccount()`. Switching the
 * sub-account refetches both.
 */
export default function ReportingEngagementPage() {
  const { account, accountKey, accountData } = useAccount();
  const isAccountMode = account.mode === 'account';
  const dealerName = accountData?.dealer || 'all accounts';

  return (
    <>
      <PageHeader
        icon={PaperAirplaneIcon}
        title="Engagement reporting"
        subtitle={`Campaign performance, email engagement, and flow throughput — ${dealerName}.`}
      />

      <section className="mb-10">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Messaging
        </h2>
        <EngagementSection
          accountKey={isAccountMode ? (accountKey ?? undefined) : undefined}
          dateRange={DEFAULT_DATE_RANGE}
        />
      </section>

      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Flows
        </h2>
        <FlowsAnalyticsBody
          scopeKey={accountKey ?? 'all'}
          subtitle={
            isAccountMode
              ? `Drip-series performance for ${dealerName}`
              : 'Drip-series performance across all accounts'
          }
          showAccountColumn={!isAccountMode}
          presetAccountKey={isAccountMode ? accountKey : null}
          showPageHeader={false}
        />
      </section>
    </>
  );
}
