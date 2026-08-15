'use client';

/**
 * Business Profile — Google listing performance for the account.
 *
 * Port of Oz Dealer Tools' GBPReport.
 *
 * THE ONLY REPORT WITH A PER-ACCOUNT CREDENTIAL. Google Ads and GA4
 * authenticate as the agency, so their reports either work for every account or
 * none. Business Profile insights are readable only by a Google identity that
 * manages the listing — the dealership's, not ours — so each account carries
 * its own grant and this page has a setup state the others don't.
 *
 * Connecting is staff-only; reading is client-visible. The connect panel is
 * rendered for MANAGEMENT_ROLES only, and the routes behind it enforce the same
 * thing independently.
 */

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { BuildingStorefrontIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useTheme } from '@/contexts/theme-context';
import { DashboardToolbar } from '@/components/filters/dashboard-toolbar';
import { DEFAULT_DATE_RANGE } from '@/lib/date-ranges';
import { PageHeader } from '@/components/page-header';
import { MANAGEMENT_ROLES, type UserRole } from '@/lib/roles';
import {
  EmptyState,
  resolveBounds,
  ALL_TIME_FLOOR,
  type CustomDateRange,
  type DateRangeKey,
} from '../ads/_components/shared';
import { GbpReport } from './_components/gbp-report';
import { GbpConnectPanel } from './_components/gbp-connect-panel';

export default function ReportingBusinessProfilePage() {
  const { accountKey, accountData, isGroup } = useAccount();
  const { theme } = useTheme();
  const { data: session } = useSession();
  const isDark = theme === 'dark';

  const role = session?.user?.role as UserRole | undefined;
  const canManage = !!role && MANAGEMENT_ROLES.includes(role);

  const [rangeKey, setRangeKey] = useState<DateRangeKey>(DEFAULT_DATE_RANGE);
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);
  const { from, to } = resolveBounds(rangeKey, customRange);

  // Bumped when the connection or location changes, so the report refetches
  // instead of showing the "not connected" state after a successful connect.
  const [refreshKey, setRefreshKey] = useState(0);

  // The OAuth callback bounces back here with a result. Surface it once, then
  // strip it from the URL so a refresh doesn't replay the banner.
  const [flash, setFlash] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('gbp_error');
    const ok = params.get('gbp_connected');
    if (!err && !ok) return;

    setFlash(
      err
        ? { tone: 'error', text: err }
        : { tone: 'ok', text: 'Google connected. Choose which location this account reports on.' },
    );
    if (ok) setRefreshKey((k) => k + 1);

    params.delete('gbp_error');
    params.delete('gbp_connected');
    const qs = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, []);

  const scopeLabel = accountKey && !isGroup ? accountData?.dealer || accountKey : 'select an account';

  return (
    <>
      <PageHeader
        icon={BuildingStorefrontIcon}
        title="Business Profile"
        subtitle={`How people find and act on your Google listing — ${scopeLabel}.`}
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

      {flash && (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-xs ${
            flash.tone === 'error'
              ? 'border-red-500/20 bg-red-500/5 text-[var(--muted-foreground)]'
              : 'border-emerald-500/20 bg-emerald-500/5 text-[var(--muted-foreground)]'
          }`}
        >
          {flash.text}
        </div>
      )}

      {isGroup || !accountKey ? (
        <EmptyState
          icon={BuildingStorefrontIcon}
          title="Pick an account"
          body="Choose a single sub-account from the top bar to see its Business Profile performance."
        />
      ) : (
        <>
          {canManage && (
            <div className="mt-8">
              <GbpConnectPanel
                accountKey={accountKey}
                onChanged={() => setRefreshKey((k) => k + 1)}
              />
            </div>
          )}
          <GbpReport
            accountKey={accountKey}
            from={from}
            to={to}
            isDark={isDark}
            canManage={canManage}
            refreshKey={refreshKey}
          />
        </>
      )}
    </>
  );
}
