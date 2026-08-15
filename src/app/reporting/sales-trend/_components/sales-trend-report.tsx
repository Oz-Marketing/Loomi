'use client';

/**
 * Sales Trend body. Fetches /api/reporting/sales-trend and renders unit and
 * revenue mix by month.
 *
 * "Revenue" here is what the customer paid (out-the-door / unit sold price),
 * NOT dealer gross — the Oz Reports bridge doesn't carry the gross columns.
 * The KPI says so out loud; don't quietly rename it.
 */

import useSWR from 'swr';
import {
  ExclamationTriangleIcon,
  TruckIcon,
  SparklesIcon,
  ArchiveBoxIcon,
  DocumentTextIcon,
  BanknotesIcon,
  TagIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline';
import {
  fetcher,
  num,
  usd0,
  pctText,
  prettyDate,
  Kpi,
  Section,
  Muted,
  EmptyState,
  LoadingState,
  DataTable,
} from '../../ads/_components/shared';
import { MonthlyStackChart, MonthlyLineChart } from '../../_components/dealer-charts';

interface SalesMonth {
  month: string;
  label: string;
  newUnits: number;
  usedUnits: number;
  leaseUnits: number;
  otherUnits: number;
  totalUnits: number;
  newRevenue: number;
  usedRevenue: number;
  leaseRevenue: number;
  otherRevenue: number;
  totalRevenue: number;
  avgPrice: number;
}
interface SalesSummary {
  newUnits: number;
  usedUnits: number;
  leaseUnits: number;
  otherUnits: number;
  totalUnits: number;
  newRevenue: number;
  usedRevenue: number;
  leaseRevenue: number;
  otherRevenue: number;
  totalRevenue: number;
  avgPrice: number;
  avgApr: number | null;
  aprCoverage: number;
}
interface SalesData {
  dealer: string;
  startDate: string;
  endDate: string;
  months: SalesMonth[];
  summary: SalesSummary;
}

const share = (part: number, whole: number) => (whole > 0 ? pctText((part / whole) * 100) : '—');

export function SalesTrendReport({
  accountKey,
  from,
  to,
  isDark,
}: {
  accountKey: string;
  from: string;
  to: string;
  isDark: boolean;
}) {
  const { data, error, isLoading } = useSWR<SalesData, Error & { code?: string }>(
    `/api/reporting/sales-trend?accountKey=${encodeURIComponent(accountKey)}&start_date=${from}&end_date=${to}`,
    fetcher,
  );

  if (isLoading) return <LoadingState />;
  if (error) {
    return (
      <EmptyState
        icon={ExclamationTriangleIcon}
        title="Couldn't load the sales trend"
        body={error.message}
        tone="error"
      />
    );
  }
  if (!data) return null;

  const s = data.summary;

  if (!s.totalUnits) {
    return (
      <EmptyState
        icon={TruckIcon}
        title="No deals in this range"
        body="Nothing has been recorded for this account over the selected dates. Sales arrive on the nightly Oz Reports sync, and older records are repaired by the Sunday sweep."
      />
    );
  }

  const categories = data.months.map((m) => m.label);
  // A bucket that is empty across the whole range gets no legend row — an
  // always-zero series is noise. Kept per-bucket rather than dropping any zero
  // series, so a quarter with no leases still shows the lease row it usually has.
  const hasOther = data.months.some((m) => m.otherUnits > 0);

  const unitSeries = [
    { name: 'New', data: data.months.map((m) => m.newUnits) },
    { name: 'Used', data: data.months.map((m) => m.usedUnits) },
    { name: 'Lease', data: data.months.map((m) => m.leaseUnits) },
    ...(hasOther ? [{ name: 'Other', data: data.months.map((m) => m.otherUnits) }] : []),
  ];
  const revenueSeries = [
    { name: 'New', data: data.months.map((m) => m.newRevenue) },
    { name: 'Used', data: data.months.map((m) => m.usedRevenue) },
    { name: 'Lease', data: data.months.map((m) => m.leaseRevenue) },
    ...(hasOther ? [{ name: 'Other', data: data.months.map((m) => m.otherRevenue) }] : []),
  ];

  const aprLabel =
    s.avgApr === null
      ? 'No APR reported'
      : `${s.avgApr.toFixed(2)}% avg APR${s.aprCoverage < 0.9 ? ` (${pctText(s.aprCoverage * 100)} of deals)` : ''}`;

  return (
    <div className="mt-8 space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={TruckIcon} label="Units" value={num(s.totalUnits)} tone="primary" />
        <Kpi
          icon={SparklesIcon}
          label="New"
          value={num(s.newUnits)}
          secondary={share(s.newUnits, s.totalUnits)}
          tone="emerald"
        />
        <Kpi
          icon={ArchiveBoxIcon}
          label="Used"
          value={num(s.usedUnits)}
          secondary={share(s.usedUnits, s.totalUnits)}
          tone="sky"
        />
        <Kpi
          icon={DocumentTextIcon}
          label="Lease"
          value={num(s.leaseUnits)}
          secondary={share(s.leaseUnits, s.totalUnits)}
          tone="amber"
        />
        <Kpi
          icon={BanknotesIcon}
          label="Revenue"
          value={usd0(s.totalRevenue)}
          secondary="Customer price, not gross"
          tone="violet"
        />
        <Kpi
          icon={TagIcon}
          label="Avg per unit"
          value={usd0(s.avgPrice)}
          secondary={aprLabel}
          tone="zinc"
        />
      </div>

      <Section
        title="Units by month"
        subtitle={`${prettyDate(data.startDate)} – ${prettyDate(data.endDate)}`}
        icon={ChartBarIcon}
      >
        <MonthlyStackChart categories={categories} series={unitSeries} isDark={isDark} />
      </Section>

      <Section title="Revenue by month" subtitle="Customer transaction price" icon={BanknotesIcon}>
        <MonthlyStackChart categories={categories} series={revenueSeries} isDark={isDark} money />
      </Section>

      <Section title="Average price per unit" subtitle="All deal types" icon={TagIcon}>
        <MonthlyLineChart
          categories={categories}
          name="Avg price"
          data={data.months.map((m) => m.avgPrice)}
          isDark={isDark}
        />
      </Section>

      <Section title="Monthly detail" icon={DocumentTextIcon}>
        <DataTable
          head={
            hasOther
              ? ['Month', 'New', 'Used', 'Lease', 'Other', 'Units', 'Revenue', 'Avg price']
              : ['Month', 'New', 'Used', 'Lease', 'Units', 'Revenue', 'Avg price']
          }
          rows={data.months.map((m) => [
            m.label,
            num(m.newUnits),
            num(m.usedUnits),
            num(m.leaseUnits),
            ...(hasOther ? [num(m.otherUnits)] : []),
            num(m.totalUnits),
            usd0(m.totalRevenue),
            usd0(m.avgPrice),
          ])}
          maxRows={12}
        />
        {hasOther && (
          <div className="mt-3">
            <Muted>
              &ldquo;Other&rdquo; is deals whose type didn&rsquo;t match new, used, or lease at the
              source — wholesale and fleet mostly. They&rsquo;re counted in the totals rather than
              dropped, so the mix always reconciles.
            </Muted>
          </div>
        )}
      </Section>
    </div>
  );
}
