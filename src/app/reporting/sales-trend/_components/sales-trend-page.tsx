'use client';

/**
 * Sales Trend — units and transaction revenue by month, split new/used/lease.
 *
 * Port of Oz Dealer Tools' SalesTrend. Owns the date range + theme and hands
 * them to <SalesTrendReport>, which self-fetches /api/reporting/sales-trend.
 *
 * No group roll-up yet: the platform reports get one via `RollupConfig`, but
 * summing deal counts across rooftops is a different question from summing ad
 * spend (shared customers, differing dealer types) and wants its own design.
 * Group scope falls back to "pick a single account".
 */

import { useState } from 'react';
import { ArrowTrendingUpIcon, TruckIcon } from '@heroicons/react/24/outline';
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
} from '../../ads/_components/shared';
import { SalesTrendReport } from './sales-trend-report';

export function SalesTrendPage() {
  const { accountKey, accountData, isGroup } = useAccount();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [rangeKey, setRangeKey] = useState<DateRangeKey>(DEFAULT_DATE_RANGE);
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);
  const { from, to } = resolveBounds(rangeKey, customRange);

  const scopeLabel = accountKey && !isGroup ? accountData?.dealer || accountKey : 'select an account';

  return (
    <>
      <PageHeader
        icon={ArrowTrendingUpIcon}
        title="Sales trend"
        subtitle={`Units, deal mix, and transaction revenue by month — ${scopeLabel}.`}
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

      {isGroup || !accountKey ? (
        <EmptyState
          icon={TruckIcon}
          title="Pick an account"
          body="Choose a single sub-account from the top bar to see its sales trend."
        />
      ) : (
        <SalesTrendReport accountKey={accountKey} from={from} to={to} isDark={isDark} />
      )}
    </>
  );
}
