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

export default function ReportingReputationPage() {
  const { accountKey, accountData } = useAccount();
  const dealer = accountData?.dealer || 'all accounts';

  return (
    <>
      <PageHeader
        icon={StarIcon}
        title="Reputation"
        subtitle={`Live Google rating, recent reviews, and competitor comparison — ${accountKey ? dealer : 'select an account'}.`}
      />

      {!accountKey ? (
        <EmptyState
          icon={StarIcon}
          title="Pick an account"
          body="Choose a sub-account from the top bar to see its Google reputation."
        />
      ) : (
        <ReputationReport accountKey={accountKey} />
      )}
    </>
  );
}
