'use client';

/**
 * Acquisition Cost — the join between media spend and delivered units.
 *
 * Sits under Sales & Service rather than Digital Ads because it is not a
 * channel report: it spans every channel and answers a question about the
 * store, not about a platform.
 */

import { useState } from 'react';
import { ChartBarIcon, ScaleIcon } from '@heroicons/react/24/outline';
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
import { useReportLens, LensToggle, ClientPreviewNotice } from '../_components/lens';
import { AcquisitionReport } from './_components/acquisition-report';

export default function ReportingAcquisitionPage() {
  const { accountKey, accountData } = useAccount();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const lensState = useReportLens();

  const [rangeKey, setRangeKey] = useState<DateRangeKey>(DEFAULT_DATE_RANGE);
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);
  const { from, to } = resolveBounds(rangeKey, customRange);

  const dealer = accountData?.dealer || 'this account';

  return (
    <>
      <PageHeader
        icon={ScaleIcon}
        title="Acquisition cost"
        subtitle={`What a lead and a delivered unit cost in media — ${dealer}.`}
      />

      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        <LensToggle {...lensState} />
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

      <ClientPreviewNotice {...lensState} />

      {/* No group roll-up: blending spend and units across rooftops would
          average a Chevy store's cost per unit with a Ford store's, and the
          result describes neither. One account at a time, deliberately. */}
      {!accountKey ? (
        <EmptyState
          icon={ChartBarIcon}
          title="Pick an account"
          body="Choose a sub-account from the top bar to see what its leads and units cost."
        />
      ) : (
        <AcquisitionReport
          accountKey={accountKey}
          from={from}
          to={to}
          isDark={isDark}
          lens={lensState.lens}
        />
      )}
    </>
  );
}
