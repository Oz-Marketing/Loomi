'use client';

/**
 * Websites reporting — GA4 website analytics for the active account.
 *
 * Port of Oz Dealer Tools' Website Analytics. Owns the date range + theme and
 * hands them to <Ga4Report>, which self-fetches /api/reporting/ga4. The GA4
 * property is mapped per account on the server (see lib/integrations/ga4).
 */

import { useState } from 'react';
import { ChartBarIcon, GlobeAltIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useTheme } from '@/contexts/theme-context';
import { DashboardToolbar } from '@/components/filters/dashboard-toolbar';
import { DEFAULT_DATE_RANGE } from '@/lib/date-ranges';
import { PageHeader } from '@/components/page-header';
import {
  EmptyState,
  resolveBounds,
  ALL_TIME_FLOOR,
  type CustomDateRange,
  type DateRangeKey,
} from '../ads/_components/shared';
import { Ga4Report } from './_components/ga4-report';
import { OrgReportRollup } from '../_components/org-report-rollup';
import { GA4_ROLLUP } from '../_components/rollup-configs';

export default function ReportingWebsitesPage() {
  const { accountKey, accountData, isOrg, organizationData, scopedAccountKeys, accounts } = useAccount();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [rangeKey, setRangeKey] = useState<DateRangeKey>(DEFAULT_DATE_RANGE);
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);
  const { from, to } = resolveBounds(rangeKey, customRange);

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
        icon={GlobeAltIcon}
        title="Website analytics"
        subtitle={`Sessions, users, channels, and top pages from Google Analytics — ${scopeLabel}.`}
      />

      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        <DashboardToolbar
          dateRange={rangeKey}
          onDateRangeChange={setRangeKey}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
          showReset={false}
          align="left"
          hidePresets={['all']}
          minDate={ALL_TIME_FLOOR}
        />
      </div>

      {isOrg ? (
        <div className="mt-8">
          <OrgReportRollup
            config={GA4_ROLLUP}
            accountKeys={scopedAccountKeys}
            dealers={dealers}
            from={from}
            to={to}
            compareTo="none"
          />
        </div>
      ) : !accountKey ? (
        <EmptyState
          icon={ChartBarIcon}
          title="Pick an account"
          body="Choose a sub-account or organization from the top bar to see website analytics."
        />
      ) : (
        <Ga4Report accountKey={accountKey} from={from} to={to} isDark={isDark} />
      )}
    </>
  );
}
