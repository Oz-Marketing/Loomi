'use client';

/**
 * Reputation reporting — live Google rating, recent reviews, and a competitor
 * comparison for the active account. Port of Oz Dealer Tools' Reputation Report
 * (live-rating half). The Google place is mapped per account on the server
 * (see lib/integrations/google-places).
 */

import { StarIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '../ads/_components/shared';
import { ReputationReport } from './_components/reputation-report';
import { OrgReportRollup } from '../_components/org-report-rollup';
import { REPUTATION_ROLLUP } from '../_components/rollup-configs';

export default function ReportingReputationPage() {
  const { accountKey, accountData, isOrg, organizationData, scopedAccountKeys, accounts } = useAccount();
  const dealer = accountData?.dealer || 'all accounts';
  const scopeLabel = isOrg
    ? `${organizationData?.name ?? 'organization'} — ${scopedAccountKeys.length} sub-accounts`
    : accountKey
      ? dealer
      : 'select an account';
  const dealers = Object.fromEntries(Object.entries(accounts).map(([k, a]) => [k, a.dealer || k]));

  return (
    <>
      <PageHeader
        icon={StarIcon}
        title="Reputation"
        subtitle={`Live Google rating, recent reviews, and competitor comparison — ${scopeLabel}.`}
      />

      {isOrg ? (
        <div className="mt-8">
          <OrgReportRollup
            config={REPUTATION_ROLLUP}
            accountKeys={scopedAccountKeys}
            dealers={dealers}
            from=""
            to=""
            compareTo="none"
          />
        </div>
      ) : !accountKey ? (
        <EmptyState
          icon={StarIcon}
          title="Pick an account"
          body="Choose a sub-account or organization from the top bar to see Google reputation."
        />
      ) : (
        <ReputationReport accountKey={accountKey} />
      )}
    </>
  );
}
