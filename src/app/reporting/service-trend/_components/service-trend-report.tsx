'use client';

/**
 * Service Trend body. Fetches /api/reporting/service-trend and renders repair
 * order counts and revenue split by pay type.
 *
 * Powersports ROs carry no customer/warranty/internal breakdown at the source,
 * so their revenue arrives as `unsplitPay` and is charted as its own band.
 * Rendering three zero segments instead would read as "billed nothing".
 */

import useSWR from 'swr';
import {
  ExclamationTriangleIcon,
  WrenchScrewdriverIcon,
  UserIcon,
  ShieldCheckIcon,
  BuildingOffice2Icon,
  BanknotesIcon,
  ReceiptPercentIcon,
  ChartBarIcon,
  DocumentTextIcon,
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

interface ServiceMonth {
  month: string;
  label: string;
  roCount: number;
  customerPay: number;
  warrantyPay: number;
  internalPay: number;
  unsplitPay: number;
  totalRevenue: number;
  avgRoValue: number;
}
interface ServiceSummary {
  roCount: number;
  customerPay: number;
  warrantyPay: number;
  internalPay: number;
  unsplitPay: number;
  totalRevenue: number;
  avgRoValue: number;
  splitCoverage: number;
}
interface ServiceData {
  dealer: string;
  startDate: string;
  endDate: string;
  months: ServiceMonth[];
  summary: ServiceSummary;
}

const share = (part: number, whole: number) => (whole > 0 ? pctText((part / whole) * 100) : '—');

export function ServiceTrendReport({
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
  const { data, error, isLoading } = useSWR<ServiceData, Error & { code?: string }>(
    `/api/reporting/service-trend?accountKey=${encodeURIComponent(accountKey)}&start_date=${from}&end_date=${to}`,
    fetcher,
  );

  if (isLoading) return <LoadingState />;
  if (error) {
    return (
      <EmptyState
        icon={ExclamationTriangleIcon}
        title="Couldn't load the service trend"
        body={error.message}
        tone="error"
      />
    );
  }
  if (!data) return null;

  const s = data.summary;

  if (!s.roCount) {
    return (
      <EmptyState
        icon={WrenchScrewdriverIcon}
        title="No repair orders in this range"
        body="Nothing has been recorded for this account over the selected dates. Service arrives on the nightly Oz Reports sync, and older records are repaired by the Sunday sweep."
      />
    );
  }

  const categories = data.months.map((m) => m.label);
  const hasSplit = s.customerPay + s.warrantyPay + s.internalPay > 0;
  const hasUnsplit = s.unsplitPay > 0;

  // Only band what the source actually distinguishes. An all-powersports
  // account gets one "Not broken out" band; a mixed range gets both.
  const revenueSeries = [
    ...(hasSplit
      ? [
          { name: 'Customer pay', data: data.months.map((m) => m.customerPay) },
          { name: 'Warranty', data: data.months.map((m) => m.warrantyPay) },
          { name: 'Internal', data: data.months.map((m) => m.internalPay) },
        ]
      : []),
    ...(hasUnsplit
      ? [{ name: 'Not broken out', data: data.months.map((m) => m.unsplitPay) }]
      : []),
  ];

  return (
    <div className="mt-8 space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={WrenchScrewdriverIcon} label="Repair orders" value={num(s.roCount)} tone="primary" />
        <Kpi icon={BanknotesIcon} label="Revenue" value={usd0(s.totalRevenue)} tone="violet" />
        <Kpi icon={ReceiptPercentIcon} label="Avg per RO" value={usd0(s.avgRoValue)} tone="zinc" />
        <Kpi
          icon={UserIcon}
          label="Customer pay"
          value={usd0(s.customerPay)}
          secondary={share(s.customerPay, s.totalRevenue)}
          tone="emerald"
        />
        <Kpi
          icon={ShieldCheckIcon}
          label="Warranty"
          value={usd0(s.warrantyPay)}
          secondary={share(s.warrantyPay, s.totalRevenue)}
          tone="sky"
        />
        <Kpi
          icon={BuildingOffice2Icon}
          label="Internal"
          value={usd0(s.internalPay)}
          secondary={share(s.internalPay, s.totalRevenue)}
          tone="amber"
        />
      </div>

      {hasUnsplit && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <Muted>
            {usd0(s.unsplitPay)} of this range&rsquo;s revenue ({pctText((1 - s.splitCoverage) * 100)}
            ) has no pay-type breakdown. Powersports repair orders arrive as a single total, so they
            are counted in Revenue but not in Customer pay, Warranty, or Internal.
          </Muted>
        </div>
      )}

      <Section
        title="Repair orders by month"
        subtitle={`${prettyDate(data.startDate)} – ${prettyDate(data.endDate)}`}
        icon={ChartBarIcon}
      >
        <MonthlyStackChart
          categories={categories}
          series={[{ name: 'Repair orders', data: data.months.map((m) => m.roCount) }]}
          isDark={isDark}
          showLegend={false}
        />
      </Section>

      <Section title="Revenue by pay type" subtitle="Stacked monthly totals" icon={BanknotesIcon}>
        <MonthlyStackChart categories={categories} series={revenueSeries} isDark={isDark} money />
      </Section>

      <Section title="Average RO value" subtitle="All pay types" icon={ReceiptPercentIcon}>
        <MonthlyLineChart
          categories={categories}
          name="Avg RO"
          data={data.months.map((m) => m.avgRoValue)}
          isDark={isDark}
        />
      </Section>

      <Section title="Monthly detail" icon={DocumentTextIcon}>
        <DataTable
          head={
            hasUnsplit
              ? ['Month', 'ROs', 'Customer', 'Warranty', 'Internal', 'Not broken out', 'Revenue', 'Avg RO']
              : ['Month', 'ROs', 'Customer', 'Warranty', 'Internal', 'Revenue', 'Avg RO']
          }
          rows={data.months.map((m) => [
            m.label,
            num(m.roCount),
            usd0(m.customerPay),
            usd0(m.warrantyPay),
            usd0(m.internalPay),
            ...(hasUnsplit ? [usd0(m.unsplitPay)] : []),
            usd0(m.totalRevenue),
            usd0(m.avgRoValue),
          ])}
          maxRows={12}
        />
      </Section>
    </div>
  );
}
