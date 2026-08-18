'use client';

/**
 * Lead Performance — lead volume, mix, and period-over-period comparisons.
 *
 * Port of Oz Dealer Tools' LeadPerformance.
 *
 * A MONTH PICKER, NOT A DATE RANGE. Every comparison this report makes is
 * month-shaped — month over month, the same month last year, year to date — and
 * a partial month is compared against the prior month cut at the same day.
 * An arbitrary range has no "prior period" that means anything, so the report
 * takes a month and derives its own comparisons.
 */

import { useState } from 'react';
import { UserPlusIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useTheme } from '@/contexts/theme-context';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '../ads/_components/shared';
import { LeadPerformanceReport } from './_components/lead-performance-report';

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function shift(period: string, by: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function label(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function MonthPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (p: string) => void;
}) {
  const atCurrent = value >= currentPeriod();
  return (
    <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] p-0.5">
      <button
        type="button"
        onClick={() => onChange(shift(value, -1))}
        aria-label="Previous month"
        className="rounded-md px-2 py-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
      >
        <ChevronLeftIcon className="h-4 w-4" />
      </button>
      <span className="min-w-[8.5rem] px-2 text-center text-xs font-medium tabular-nums">
        {label(value)}
      </span>
      <button
        type="button"
        onClick={() => onChange(shift(value, 1))}
        // Nothing has happened next month yet; an empty report reads as a
        // collapse rather than as the future.
        disabled={atCurrent}
        aria-label="Next month"
        className="rounded-md px-2 py-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-30"
      >
        <ChevronRightIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function ReportingLeadsPage() {
  const { accountKey, accountData, isRollup } = useAccount();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [period, setPeriod] = useState(currentPeriod);

  const scopeLabel = accountKey && !isRollup ? accountData?.dealer || accountKey : 'select an account';

  return (
    <>
      <PageHeader
        icon={UserPlusIcon}
        title="Lead performance"
        subtitle={`Lead volume, sources, and how this month compares — ${scopeLabel}.`}
      />

      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        <MonthPicker value={period} onChange={setPeriod} />
      </div>

      {isRollup || !accountKey ? (
        <EmptyState
          icon={UserPlusIcon}
          title="Pick an account"
          body="Choose a single account from the top bar to see its lead performance."
        />
      ) : (
        <LeadPerformanceReport accountKey={accountKey} period={period} isDark={isDark} />
      )}
    </>
  );
}
