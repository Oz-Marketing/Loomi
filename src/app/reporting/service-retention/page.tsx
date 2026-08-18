'use client';

/**
 * Service Retention — do buyers come back for service, and do first-time
 * service customers come back a second time.
 *
 * Port of Oz Dealer Tools' ServiceRetentionReport.
 *
 * NO DATE PICKER, deliberately. Every other report answers "what happened in
 * this window"; this one answers "of the people who bought in year X, how many
 * returned within 12 months of *their own* purchase". Each cohort carries its
 * own window, so an arbitrary global range would either truncate those windows
 * or silently redefine them. Cohorts are fixed at the trailing five years, as
 * in ODT.
 */

import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useTheme } from '@/contexts/theme-context';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '../ads/_components/shared';
import { ServiceRetentionReport } from './_components/service-retention-report';

export default function ReportingServiceRetentionPage() {
  const { accountKey, accountData, isRollup } = useAccount();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const scopeLabel = accountKey && !isRollup ? accountData?.dealer || accountKey : 'select an account';

  return (
    <>
      <PageHeader
        icon={ArrowPathIcon}
        title="Service retention"
        subtitle={`Whether buyers come back for service, and whether service customers come back again — ${scopeLabel}.`}
      />

      {isRollup || !accountKey ? (
        <EmptyState
          icon={ArrowPathIcon}
          title="Pick an account"
          body="Choose a single account from the top bar to see its retention cohorts."
        />
      ) : (
        <ServiceRetentionReport accountKey={accountKey} isDark={isDark} />
      )}
    </>
  );
}
