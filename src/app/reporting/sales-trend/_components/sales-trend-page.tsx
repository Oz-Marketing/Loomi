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
import { OrgReportRollup } from '../../_components/org-report-rollup';
import { SALES_ROLLUP } from '../../_components/rollup-configs';
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
  const { accountKey, accountData, isRollup, scopedAccountKeys, accounts } =
    useAccount();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [rangeKey, setRangeKey] = useState<DateRangeKey>(DEFAULT_DATE_RANGE);
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);
  const { from, to } = resolveBounds(rangeKey, customRange);

  const scopeLabel = isRollup
    ? `${accountData?.dealer ?? 'All accounts'} — ${scopedAccountKeys.length} accounts`
    : accountKey
      ? accountData?.dealer || accountKey
      : 'select an account';
  const dealers = Object.fromEntries(Object.entries(accounts).map(([k, a]) => [k, a.dealer || k]));

  return (
    <>
      <PageHeader
        scoped
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

      {/* A roll-up when the scope covers several accounts — the config for this
          report already existed, it was just only ever used by the Executive
          dashboard. Before this the page refused to render for a group at all,
          so there was no way to see its sales trend across one. */}
      {isRollup ? (
        <div className="mt-8">
          <OrgReportRollup
            config={SALES_ROLLUP}
            accountKeys={scopedAccountKeys}
            dealers={dealers}
            from={from}
            to={to}
            compareTo="none"
          />
        </div>
      ) : !accountKey ? (
        <EmptyState
          icon={TruckIcon}
          title="Pick an account"
          body="Choose a single account from the top bar to see its sales trend."
        />
      ) : (
        <SalesTrendReport accountKey={accountKey} from={from} to={to} isDark={isDark} />
      )}
    </>
  );
}
