'use client';

/**
 * A single Digital Ads platform report (e.g. /reporting/ads/meta). Renders the
 * platform's report component beneath a sibling tab bar (hop between platforms
 * without losing the window — range lives in the shared layout context) plus
 * the shared date/comparison controls.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChartBarIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useTheme } from '@/contexts/theme-context';
import { ReportingPageHeader } from '../../_components/page-header';
import { EmptyState, RangeControls } from '../_components/shared';
import { findReport, LIVE_REPORTS } from '../_components/reports-config';
import { REPORT_COMPONENTS } from '../_components/report-components';
import { useRange } from '../_components/range-context';

export default function DigitalAdsReportPage() {
  const params = useParams();
  const key = String(params.report);
  const def = findReport(key);
  const Report = REPORT_COMPONENTS[key];

  const { accountKey, accountData } = useAccount();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const range = useRange();

  if (!def || def.status !== 'live' || !Report) {
    return (
      <>
        <ReportingPageHeader eyebrow="Digital Ads" title="Report not found" subtitle="" />
        <EmptyState
          icon={ExclamationTriangleIcon}
          title="That report isn't available"
          body="It may not be connected yet. Head back to Digital Ads to see what's ready."
          action={{ label: 'Back to Digital Ads', onClick: () => (window.location.href = '/ads') }}
        />
      </>
    );
  }

  const dealer = accountData?.dealer || 'all accounts';

  return (
    <>
      <ReportingPageHeader
        eyebrow="Digital Ads"
        title={def.label}
        subtitle={`${def.blurb} — ${accountKey ? dealer : 'select an account'}.`}
      />

      {/* Sibling tabs + shared controls */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5">
          {LIVE_REPORTS.map((r) => {
            const active = r.key === key;
            return (
              <Link
                key={r.key}
                href={`/ads/${r.key}`}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-[var(--primary)] text-white'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                <r.icon className="h-3.5 w-3.5" />
                {r.label}
              </Link>
            );
          })}
        </div>
        <RangeControls
          rangeKey={range.rangeKey}
          onRangeKey={range.setRangeKey}
          customRange={range.customRange}
          onCustomRange={range.onCustomRange}
          compareTo={range.compareTo}
          onCompareTo={range.setCompareTo}
          floor={range.floor}
        />
      </div>

      <div className="mt-8">
        {!accountKey ? (
          <EmptyState
            icon={ChartBarIcon}
            title="Pick an account"
            body="Choose a sub-account from the top bar to see its performance."
          />
        ) : (
          <Report
            accountKey={accountKey}
            from={range.from}
            to={range.to}
            compareTo={range.compareTo}
            isDark={isDark}
            onJump={range.onJump}
          />
        )}
      </div>
    </>
  );
}
