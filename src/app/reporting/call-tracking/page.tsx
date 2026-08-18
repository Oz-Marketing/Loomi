'use client';

/**
 * Call Tracking — tracked phone call volume, answer rate, and timing.
 *
 * Port of Oz Dealer Tools' CallTrackingReport. Its source is `CallEvent`, fed
 * by the `pushcalls` bridge route added to Oz Reports for this report — the
 * first Loomi report that required extending the bridge rather than reading
 * what it already sent.
 *
 * TIMEZONE. The hour-of-day and weekday breakdowns are computed in the
 * dealership's local time, not UTC and not the viewer's. Until accounts carry a
 * timezone of their own this uses Mountain time, where the dealer group is —
 * see the note in the API route.
 */

import { useState } from 'react';
import { PhoneIcon } from '@heroicons/react/24/outline';
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
import { CallTrackingReport } from './_components/call-tracking-report';

/**
 * The dealer group is in Utah. When `Account` grows a timezone column this
 * should read it rather than assuming — the assumption is wrong the moment a
 * rooftop opens outside Mountain time, and it would be wrong silently.
 */
const ACCOUNT_TIMEZONE = 'America/Denver';

export default function ReportingCallTrackingPage() {
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
        icon={PhoneIcon}
        title="Call tracking"
        subtitle={`Tracked call volume, answer rate, and when people call — ${scopeLabel}.`}
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
          icon={PhoneIcon}
          title="Pick an account"
          body="Choose a single account from the top bar to see its tracked calls."
        />
      ) : (
        <CallTrackingReport
          accountKey={accountKey}
          from={from}
          to={to}
          timezone={ACCOUNT_TIMEZONE}
          isDark={isDark}
        />
      )}
    </>
  );
}
