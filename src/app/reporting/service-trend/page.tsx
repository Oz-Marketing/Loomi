'use client';

/**
 * Service Trend — repair order counts and revenue by pay type, by month.
 *
 * Port of Oz Dealer Tools' ServiceTrend. Owns the date range + theme and hands
 * them to <ServiceTrendReport>, which self-fetches /api/reporting/service-trend.
 *
 * No group roll-up yet — same reasoning as Sales Trend.
 */

import { useState } from 'react';
import { WrenchScrewdriverIcon } from '@heroicons/react/24/outline';
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
import { ServiceTrendReport } from './_components/service-trend-report';

export default function ReportingServiceTrendPage() {
  const { accountKey, accountData, isRollup } = useAccount();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [rangeKey, setRangeKey] = useState<DateRangeKey>(DEFAULT_DATE_RANGE);
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);
  const { from, to } = resolveBounds(rangeKey, customRange);

  const scopeLabel = accountKey && !isRollup ? accountData?.dealer || accountKey : 'select an account';

  return (
    <>
      <PageHeader
        icon={WrenchScrewdriverIcon}
        title="Service trend"
        subtitle={`Repair orders and revenue by pay type, by month — ${scopeLabel}.`}
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

      {isRollup || !accountKey ? (
        <EmptyState
          icon={WrenchScrewdriverIcon}
          title="Pick an account"
          body="Choose a single account from the top bar to see its service trend."
        />
      ) : (
        <ServiceTrendReport accountKey={accountKey} from={from} to={to} isDark={isDark} />
      )}
    </>
  );
}
