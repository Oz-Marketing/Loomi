'use client';

/**
 * Websites reporting — GA4 website analytics for the active account.
 *
 * Port of Oz Dealer Tools' Website Analytics. Owns the date range + theme and
 * hands them to <Ga4Report>, which self-fetches /api/reporting/ga4. The GA4
 * property is mapped per account on the server (see lib/integrations/ga4).
 */

import { useState } from 'react';
import { ChartBarIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useTheme } from '@/contexts/theme-context';
import { DashboardToolbar } from '@/components/filters/dashboard-toolbar';
import { DEFAULT_DATE_RANGE } from '@/lib/date-ranges';
import { ReportingPageHeader } from '../_components/page-header';
import {
  EmptyState,
  resolveBounds,
  ALL_TIME_FLOOR,
  type CustomDateRange,
  type DateRangeKey,
} from '../ads/_components/shared';
import { Ga4Report } from './_components/ga4-report';

export default function ReportingWebsitesPage() {
  const { accountKey, accountData } = useAccount();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [rangeKey, setRangeKey] = useState<DateRangeKey>(DEFAULT_DATE_RANGE);
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);
  const { from, to } = resolveBounds(rangeKey, customRange);

  const dealer = accountData?.dealer || 'all accounts';

  return (
    <>
      <ReportingPageHeader
        eyebrow="Websites"
        title="Website analytics"
        subtitle={`Sessions, users, channels, and top pages from Google Analytics — ${accountKey ? dealer : 'select an account'}.`}
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

      {!accountKey ? (
        <EmptyState
          icon={ChartBarIcon}
          title="Pick an account"
          body="Choose a sub-account from the top bar to see its website analytics."
        />
      ) : (
        <Ga4Report accountKey={accountKey} from={from} to={to} isDark={isDark} />
      )}
    </>
  );
}
