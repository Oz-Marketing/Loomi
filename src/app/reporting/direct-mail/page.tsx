'use client';

/**
 * Direct Mail ROI — service-mailer campaign matchback.
 *
 * Port of Oz Dealer Tools' ServiceMailerReport plus its Summary roll-up, which
 * were two pages showing one campaign and many; here the totals sit above the
 * campaign list, so there is nothing to switch between.
 *
 * The matchback itself runs on the Oz Reports host — the join key (`custno`)
 * exists only there. See src/lib/reporting/direct-mail.ts.
 */

import { useState } from 'react';
import { EnvelopeIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
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
import { DirectMailReport } from './_components/direct-mail-report';

export default function ReportingDirectMailPage() {
  const { accountKey, accountData, isRollup } = useAccount();

  const [rangeKey, setRangeKey] = useState<DateRangeKey>(DEFAULT_DATE_RANGE);
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);
  const { from, to } = resolveBounds(rangeKey, customRange);

  const scopeLabel = accountKey && !isRollup ? accountData?.dealer || accountKey : 'select an account';

  return (
    <>
      <PageHeader
        icon={EnvelopeIcon}
        title="Direct mail ROI"
        subtitle={`Who was mailed, who came in, and what it was worth — ${scopeLabel}.`}
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
          icon={EnvelopeIcon}
          title="Pick an account"
          body="Choose a single account from the top bar to see its direct-mail campaigns."
        />
      ) : (
        <DirectMailReport accountKey={accountKey} from={from} to={to} />
      )}
    </>
  );
}
