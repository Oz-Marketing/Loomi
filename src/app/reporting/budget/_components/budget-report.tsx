'use client';

/**
 * Budget report body — the client-facing view of the ledger.
 *
 * MARGIN NEVER APPEARS HERE. The API returns a projection with cost, revenue
 * and spend targets already stripped (lib/reporting/budget-view.ts); this
 * component must not reintroduce them by, say, dividing spend by budget and
 * calling it efficiency. If a number would let a dealer infer Oz's markup, it
 * does not belong on this page.
 *
 * Wording follows the project's naming rule — "Contract", not "Agreement";
 * "Planned", not "Committed"; "Unscheduled", not "pool".
 */

import useSWR from 'swr';
import {
  ExclamationTriangleIcon,
  BanknotesIcon,
  ClipboardDocumentCheckIcon,
  CalendarDaysIcon,
  InboxIcon,
  CreditCardIcon,
  ScaleIcon,
  ChartBarIcon,
  TableCellsIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import {
  fetcher,
  usd0,
  pctText,
  Kpi,
  Section,
  Muted,
  EmptyState,
  LoadingState,
  DataTable,
} from '../../ads/_components/shared';
import { MonthlyStackChart, RankedBarChart } from '../../_components/dealer-charts';

interface ChannelRow {
  channel: string;
  label: string;
  category: string;
  amount: number;
  actual: number | null;
  share: number;
}
interface PeriodRow {
  period: string;
  label: string;
  amount: number;
  /** Null = nothing recorded. NOT the same as zero — see budget-view.ts. */
  actual: number | null;
  settled: boolean;
  actualRecorded: boolean;
}
interface BudgetData {
  dealer: string;
  accountKey: string;
  year: number;
  contractTotal: number | null;
  planned: number;
  scheduled: number;
  unscheduled: number;
  spent: number | null;
  unplanned: number | null;
  overPlanned: boolean;
  byChannel: ChannelRow[];
  byPeriod: PeriodRow[];
  contracts: { name: string; commitment: number | null }[];
  unclassifiedAmount: number;
}

export function BudgetReport({
  accountKey,
  year,
  isDark,
}: {
  accountKey: string;
  year: number;
  isDark: boolean;
}) {
  const { data, error, isLoading } = useSWR<BudgetData, Error & { code?: string }>(
    `/api/reporting/budget?accountKey=${encodeURIComponent(accountKey)}&year=${year}`,
    fetcher,
  );

  if (isLoading) return <LoadingState />;
  if (error) {
    return (
      <EmptyState
        icon={ExclamationTriangleIcon}
        title="Couldn't load the budget"
        body={error.message}
        tone="error"
      />
    );
  }
  if (!data) return null;

  if (!data.planned && !data.contractTotal) {
    return (
      <EmptyState
        icon={BanknotesIcon}
        title={`No budget on file for ${data.year}`}
        body="Nothing has been recorded against this account for the selected year. Budget lines arrive from Oz Reports, and a handful of accounts aren't mapped across yet."
      />
    );
  }

  const remaining =
    data.contractTotal == null || data.spent == null ? null : data.contractTotal - data.spent;
  const categories = data.byPeriod.map((p) => p.label);
  // Only plot a Spent series once something has actually been recorded —
  // otherwise it is a flat zero line implying the account spent nothing.
  const anyRecorded = data.byPeriod.some((p) => p.actualRecorded);
  /** Money, or an em dash when the figure was never recorded. */
  const money = (v: number | null) => (v == null ? '—' : usd0(v));

  return (
    <div className="mt-8 space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi
          icon={DocumentTextIcon}
          label="Contract"
          value={data.contractTotal == null ? '—' : usd0(data.contractTotal)}
          secondary={
            data.contracts.length
              ? data.contracts.map((c) => c.name).join(', ')
              : 'No contract on file'
          }
          tone="primary"
        />
        <Kpi
          icon={ClipboardDocumentCheckIcon}
          label="Planned"
          value={usd0(data.planned)}
          secondary={
            data.contractTotal
              ? `${pctText((data.planned / data.contractTotal) * 100)} of contract`
              : undefined
          }
          tone="emerald"
        />
        <Kpi
          icon={CalendarDaysIcon}
          label="Scheduled"
          value={usd0(data.scheduled)}
          secondary="Has a month and a channel"
          tone="sky"
        />
        <Kpi
          icon={InboxIcon}
          label="Unscheduled"
          value={usd0(data.unscheduled)}
          secondary="Not yet assigned"
          tone="amber"
        />
        <Kpi
          icon={CreditCardIcon}
          label="Spent"
          value={money(data.spent)}
          secondary={data.spent == null ? 'Not recorded yet' : undefined}
          tone="violet"
        />
        <Kpi
          icon={ScaleIcon}
          label="Remaining"
          value={money(remaining)}
          secondary={
            data.contractTotal == null
              ? 'Needs a contract total'
              : data.spent == null
                ? 'Needs recorded spend'
                : 'Contract less spend'
          }
          tone="zinc"
        />
      </div>

      {data.overPlanned && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <Muted>
            Planned budget exceeds the contract total by{' '}
            {usd0(data.planned - (data.contractTotal ?? 0))}. That is not necessarily wrong — extra
            work gets added through the year — but it means the contract figure is no longer the
            ceiling.
          </Muted>
        </div>
      )}

      {data.unscheduled > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 px-4 py-3">
          <Muted>
            {usd0(data.unscheduled)} is committed to this account but not yet assigned to a month or
            a channel, so it appears in Planned but in none of the charts below. The channel and
            month totals will not add up to Planned until it is.
          </Muted>
        </div>
      )}

      <Section
        title="Budget by month"
        subtitle={anyRecorded ? 'Planned against recorded spend' : 'Planned'}
        icon={ChartBarIcon}
      >
        {data.byPeriod.length ? (
          <MonthlyStackChart
            categories={categories}
            series={
              anyRecorded
                ? [
                    { name: 'Planned', data: data.byPeriod.map((p) => p.amount) },
                    { name: 'Spent', data: data.byPeriod.map((p) => p.actual ?? 0) },
                  ]
                : [{ name: 'Planned', data: data.byPeriod.map((p) => p.amount) }]
            }
            isDark={isDark}
            money
            // Planned and Spent are competing measures of the same month —
            // stacking them would invent a total nobody means.
            stacked={false}
            showLegend={anyRecorded}
          />
        ) : (
          <Muted>No budget has been assigned to a month yet.</Muted>
        )}
      </Section>

      <Section title="Budget by channel" subtitle="Planned" icon={BanknotesIcon}>
        {data.byChannel.length ? (
          <RankedBarChart
            items={data.byChannel.map((c) => ({ label: c.label, value: c.amount }))}
            isDark={isDark}
            money
            valueLabel="Planned"
          />
        ) : (
          <Muted>No budget has been assigned to a channel yet.</Muted>
        )}
      </Section>

      {data.byPeriod.length > 0 && (
        <Section title="Month detail" icon={TableCellsIcon}>
          <DataTable
            head={['Month', 'Planned', 'Spent', 'Variance', 'Status']}
            rows={data.byPeriod.map((p) => [
              p.label,
              usd0(p.amount),
              money(p.actual),
              // No recorded actual means no variance to state. Showing
              // -$21,000 because the figure is missing would be a lie.
              p.actual == null ? '—' : usd0(p.actual - p.amount),
              p.settled ? (p.actualRecorded ? 'Closed' : 'Closed, no spend recorded') : 'Open',
            ])}
            maxRows={12}
          />
          <div className="mt-3">
            <Muted>
              An open month has spend still to be recorded, so its variance is not final. A month
              marked &ldquo;closed, no spend recorded&rdquo; was settled without anyone entering a
              figure — that is a gap in the ledger, not a month where nothing was spent.
            </Muted>
          </div>
        </Section>
      )}

      {data.byChannel.length > 0 && (
        <Section title="Channel detail" icon={TableCellsIcon}>
          <DataTable
            head={['Channel', 'Category', 'Planned', 'Share', 'Spent']}
            rows={data.byChannel.map((c) => [
              c.label,
              c.category,
              usd0(c.amount),
              pctText(c.share * 100),
              money(c.actual),
            ])}
            maxRows={15}
          />
        </Section>
      )}
    </div>
  );
}
