'use client';

/**
 * Ad Meeting — the pre-meeting deliverable.
 *
 * Port of Oz Dealer Tools' AdMeetingReport. ODT rendered its own dashboard on
 * top of a fan-out to every other report; Loomi already has those pages, so
 * this is the thing that was actually missing — one reviewable artifact
 * covering every channel, with a written analysis, exported as a PDF.
 *
 * STAFF ONLY. This is drafted and reviewed before a client sees it, and each
 * analysis costs Opus tokens — so the page is hidden from the `client` role and
 * the analysis route enforces the same independently. It is deliberately absent
 * from the reporting sidebar for the same reason: it is a staff workflow, not a
 * report a dealer browses to.
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
  resolveBounds,
  ALL_TIME_FLOOR,
  type CustomDateRange,
  type DateRangeKey,
} from '../ads/_components/shared';
import { AdMeetingBuilder } from './_components/ad-meeting-builder';

export default function ReportingAdMeetingPage() {
  const { accountKey, accountData, isGroup } = useAccount();
  const { data: session, status } = useSession();

  const role = session?.user?.role as UserRole | undefined;
  const canManage = !!role && MANAGEMENT_ROLES.includes(role);

  const [rangeKey, setRangeKey] = useState<DateRangeKey>(DEFAULT_DATE_RANGE);
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);
  const { from, to } = resolveBounds(rangeKey, customRange);

  const dealer = accountData?.dealer || accountKey || '';

  return (
    <>
      <PageHeader
        icon={PresentationChartLineIcon}
        title="Ad meeting"
        subtitle={`Every channel for one account, assembled into a single reviewable document — ${
          accountKey && !isGroup ? dealer : 'select an account'
        }.`}
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

      {status === 'loading' ? (
        <div className="mt-8 h-40 animate-pulse rounded-2xl bg-[var(--muted)]" />
      ) : !canManage ? (
        <EmptyState
          icon={PresentationChartLineIcon}
          title="Staff only"
          body="The meeting document is prepared by your account team. Ask them for the latest one — every report it draws from is available to you individually in the sidebar."
        />
      ) : isGroup || !accountKey ? (
        <EmptyState
          icon={PresentationChartLineIcon}
          title="Pick an account"
          body="Choose a single account from the top bar to build its meeting document."
        />
      ) : (
        <AdMeetingBuilder accountKey={accountKey} dealer={dealer} from={from} to={to} />
      )}
    </>
  );
}
