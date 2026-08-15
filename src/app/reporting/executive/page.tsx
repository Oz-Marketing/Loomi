'use client';

/**
 * Executive Dashboard — every channel, every rooftop, one page.
 *
 * Port of Oz Dealer Tools' `reports/executive-dashboard`.
 *
 * ── HOW IT DIFFERS FROM THE OTHER TWO DASHBOARDS ────────────────────────────
 * Reporting now has three, and they are not variations on each other:
 *
 *   Marketing Overview (`/reporting`, one account) — how is THIS store doing.
 *   Portfolio dashboard (`/reporting`, group scope)  — the book of business,
 *     with saved layouts and widgets.
 *   Executive Dashboard (here)                       — one channel at a time,
 *     every sub-account side by side, so an outlier is visible as a ROW.
 *
 * The portfolio dashboard answers "how are we doing overall"; this answers
 * "which store is the problem". That is why it is per-sub-account rows rather than
 * aggregate tiles, and why it stayed a separate page rather than becoming a
 * mode of the other — the same split ODT had.
 *
 * ── WHO SEES IT ─────────────────────────────────────────────────────────────
 * ODT gated this to super admins and org owners/admins in more than one org.
 * The equivalent here: management roles, and only when the user can see more
 * than one account — a one-account comparison is just the report.
 *
 * ── RATES ARE RECOMPUTED, NEVER AVERAGED ────────────────────────────────────
 * Every rate metric is `kind:'rate'`, so `aggregateMetric` divides summed
 * numerator by summed denominator. Averaging per-rooftop rates would let a
 * store with four repair orders move the group's answer rate as far as one with
 * four hundred.
 */

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { PresentationChartLineIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { DashboardToolbar } from '@/components/filters/dashboard-toolbar';
import { DEFAULT_DATE_RANGE } from '@/lib/date-ranges';
import { PageHeader } from '@/components/page-header';
import { MANAGEMENT_ROLES, type UserRole } from '@/lib/roles';
import {
  EmptyState,
  Muted,
  resolveBounds,
  ALL_TIME_FLOOR,
  type CustomDateRange,
  type DateRangeKey,
} from '../ads/_components/shared';
import { OrgReportRollup } from '../_components/org-report-rollup';
import { EXECUTIVE_ROLLUPS } from '../_components/rollup-configs';

export default function ReportingExecutivePage() {
  const { accounts, accountsLoaded, scopedAccountKeys, isGroup } = useAccount();
  const { data: session, status } = useSession();

  const role = session?.user?.role as UserRole | undefined;
  const canManage = !!role && MANAGEMENT_ROLES.includes(role);

  const [rangeKey, setRangeKey] = useState<DateRangeKey>(DEFAULT_DATE_RANGE);
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);
  const { from, to } = resolveBounds(rangeKey, customRange);

  const dealers = Object.fromEntries(
    Object.entries(accounts).map(([k, a]) => [k, a.dealer || k]),
  );

  // Compare EVERY account the user can see, not whichever one happens to be
  // selected in the top bar. `scopedAccountKeys` resolves a leaf account to
  // just itself, so keying off it collapsed this page to a single row in the
  // normal case — the one state a comparison view is useless in.
  //
  // A group selection is the exception worth honouring: someone who has scoped
  // to Young Automotive Group means that subtree, not the whole book.
  const keys = isGroup ? scopedAccountKeys : Object.keys(accounts);

  return (
    <>
      <PageHeader
        icon={PresentationChartLineIcon}
        title="Executive dashboard"
        subtitle={`Every channel across ${keys.length} sub-account${keys.length === 1 ? '' : 's'}.`}
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

      {status === 'loading' || !accountsLoaded ? (
        <div className="mt-8 h-40 animate-pulse rounded-2xl bg-[var(--muted)]" />
      ) : !canManage ? (
        <EmptyState
          icon={PresentationChartLineIcon}
          title="Staff only"
          body="The executive dashboard compares every sub-account side by side. Your own account's reports are in the sidebar."
        />
      ) : keys.length < 2 ? (
        <EmptyState
          icon={PresentationChartLineIcon}
          title="Needs more than one sub-account"
          body="Only one sub-account is visible to you, so there is nothing to compare. The individual reports in the sidebar cover it in more detail."
        />
      ) : (
        <div className="mt-8 space-y-10">
          <Muted>
            Each block is one channel across every sub-account. Totals recompute rates from the
            summed parts, so a small store can&rsquo;t swing a group average. A sub-account with no
            data for a channel is shown as not configured rather than as a zero.
          </Muted>

          {EXECUTIVE_ROLLUPS.map((config) => (
            <div key={config.label}>
              <h2 className="mb-3 text-sm font-semibold tracking-tight">
                {config.label}
                {config.supportsDates === false && (
                  <span className="ml-2 text-[11px] font-normal text-[var(--muted-foreground)]">
                    — current year, not the range above
                  </span>
                )}
              </h2>
              <OrgReportRollup
                config={config}
                accountKeys={keys}
                dealers={dealers}
                from={from}
                to={to}
                compareTo="none"
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
