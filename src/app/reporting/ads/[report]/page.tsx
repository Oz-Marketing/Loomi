'use client';

/**
 * A single Digital Ads platform report (e.g. /reporting/ads/meta). Renders the
 * platform's report component beneath a sibling tab bar (hop between platforms
 * without losing the window — range lives in the shared layout context) plus
 * the shared date/comparison controls.
 */

import { useParams } from 'next/navigation';
import { ChartBarIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useTheme } from '@/contexts/theme-context';
import { PageHeader } from '@/components/page-header';
import { EmptyState, RangeControls } from '../_components/shared';
import { findReport } from '../_components/reports-config';
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

  const { accountKey, accountData, isRollup, scopedAccountKeys, accounts, userRole } = useAccount();
  const isClient = userRole === 'client';
  // Tab bar mirrors the nav: an internal report is not a tab for a client.
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
  const scopeLabel = isRollup
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

      {/* Controls only. The sibling tab strip that used to sit here (Meta /
          OTT / Google Ads / Blasts / Ad Templates) was a second copy of the
          same five links the sidebar already lists as children of Digital Ads,
          so the current report was highlighted in two places at once and the
          header carried a row that navigated nowhere new. The sidebar is the
          one that survives: it is always visible, it groups these with every
          other report, and it already respects the client/internal filter. */}
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
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
        {isRollup && rollupConfig ? (
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
            body="Choose an account or group from the top bar to see performance."
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
