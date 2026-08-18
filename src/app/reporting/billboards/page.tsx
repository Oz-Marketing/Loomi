'use client';

/**
 * Billboards — out-of-home inventory for one sub-account.
 *
 * Port of Oz Dealer Tools' BillboardReport.
 *
 * ── NO DATE RANGE ───────────────────────────────────────────────────────────
 * Every other report on this nav answers "how did we do over a period". This
 * one answers "what is up right now, and what comes down next" — a board is a
 * standing asset, not an event stream, so a date picker here would only let
 * someone filter their own current inventory out of view.
 *
 * The map reuses the Customer Heatmap's projection (no API key, no tiles, no
 * outbound requests from the PDF exporter's headless Chromium) — reasoning in
 * ../heatmap/page.tsx and docs/odt-reporting-migration.md.
 */

import { MapPinIcon } from '@heroicons/react/24/outline';
import { useAccount } from '@/contexts/account-context';
import { useTheme } from '@/contexts/theme-context';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '../ads/_components/shared';
import { BillboardReport } from './_components/billboard-report';

export default function ReportingBillboardsPage() {
  const { accountKey, accountData, isGroup } = useAccount();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const scopeLabel =
    accountKey && !isGroup ? accountData?.dealer || accountKey : 'select an account';

  return (
    <>
      <PageHeader
        icon={MapPinIcon}
        title="Billboards"
        subtitle={`Out-of-home boards, locations and renewal dates — ${scopeLabel}.`}
      />

      {isGroup || !accountKey ? (
        <EmptyState
          icon={MapPinIcon}
          title="Pick an account"
          body="Choose a single account from the top bar to see its boards. Boards shared from a parent account appear alongside the account's own."
        />
      ) : (
        <BillboardReport accountKey={accountKey} isDark={isDark} />
      )}
    </>
  );
}
