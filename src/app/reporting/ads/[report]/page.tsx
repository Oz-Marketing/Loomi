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
import { PageHeader } from '@/components/page-header';
import { EmptyState, RangeControls } from '../_components/shared';
import { findReport, visibleReports } from '../_components/reports-config';
import { REPORT_COMPONENTS } from '../_components/report-components';
import { useRange } from '../_components/range-context';
import { useReportLens, LensToggle, ClientPreviewNotice } from '../../_components/lens';
import { OrgReportRollup } from '../../_components/org-report-rollup';
import { ADS_ROLLUP_CONFIGS } from '../../_components/rollup-configs';

export default function DigitalAdsReportPage() {
  const params = useParams();
  const key = String(params.report);
  const def = findReport(key);
  const Report = REPORT_COMPONENTS[key];

  const { accountKey, accountData, isGroup, scopedAccountKeys, accounts, userRole } = useAccount();
  const isClient = userRole === 'client';
  // Tab bar mirrors the nav: an internal report is not a tab for a client.
  const tabs = visibleReports(isClient).filter((r) => r.status === 'live');
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const range = useRange();
  const lensState = useReportLens();
  const rollupConfig = ADS_ROLLUP_CONFIGS[key];
  const dealers = Object.fromEntries(
    Object.entries(accounts).map(([k, a]) => [k, a.dealer || k]),
  );

  // Hiding the nav entry is not a gate — the URL is still typeable, and this
  // page is the last thing between a client and a cross-account report. The
  // 404-shaped copy is deliberate: "you may not see this" tells a client the
  // report exists, which is itself more than they should learn.
  if (!def || def.status !== 'live' || !Report || (isClient && def.internal)) {
    return (
      <>
        <PageHeader icon={ChartBarIcon} title="Report not found" />
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
  const scopeLabel = isGroup
    ? `${accountData?.dealer ?? 'Group'} — ${scopedAccountKeys.length} accounts`
    : accountKey
      ? dealer
      // A report that doesn't need an account is already showing everything the
      // viewer can see, so telling them to pick one would be wrong.
      : def.accountOptional
        ? 'every account you can see'
        : 'select an account';

  return (
    <>
      <PageHeader
        icon={ChartBarIcon}
        title={def.label}
        subtitle={`${def.blurb} — ${scopeLabel}.`}
      />

      {/* Sibling tabs + shared controls */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5">
          {tabs.map((r) => {
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
        <div className="flex flex-wrap items-center gap-2.5">
        <LensToggle {...lensState} />
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
      </div>

      <ClientPreviewNotice {...lensState} />

      <div className="mt-8">
        {isGroup && rollupConfig ? (
          <OrgReportRollup
            config={rollupConfig}
            accountKeys={scopedAccountKeys}
            dealers={dealers}
            from={range.from}
            to={range.to}
            compareTo={range.compareTo}
          />
        ) : !accountKey && !def.accountOptional ? (
          <EmptyState
            icon={ChartBarIcon}
            title="Pick an account"
            body="Choose a sub-account or organization from the top bar to see performance."
          />
        ) : (
          <Report
            accountKey={accountKey ?? ''}
            from={range.from}
            to={range.to}
            compareTo={range.compareTo}
            isDark={isDark}
            onJump={range.onJump}
            lens={lensState.lens}
          />
        )}
      </div>
    </>
  );
}
